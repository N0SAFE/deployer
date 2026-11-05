import { createServer, type Server } from 'node:http'

import { ORPCError } from '@orpc/client'
import { type RouterContract, eventIterator, oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'
import { OpenAPIHandler } from '@orpc/openapi/node'
import { implement } from '@orpc/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

import { agentLink, serviceLink } from '@deployer/mesh-client'
import { type MeshMembership, joinServiceMesh } from '@deployer/mesh-service'
import { ServiceClientRegistry } from '@deployer/service-client'

import { type BootedAgent, bootAgent, removeDataDir } from './boot-agent'

import type { AddressInfo } from 'node:net'

/** A contract the way the platform's are: a path parameter, a date, a typed error, the caller's cookie, a stream. */
const contract = {
    items: {
        findById: oc
            .meta(openapi({ method: 'GET', path: '/items/{id}' }))
            .input(z.object({ id: z.string() }))
            .output(z.object({ id: z.string(), createdAt: z.date() }))
            .errors({
                NOT_FOUND: { status: 404, data: z.object({ id: z.string() }) },
            }),
    },
    whoami: oc
        .meta(openapi({ method: 'GET', path: '/whoami' }))
        .output(z.object({ cookie: z.string() })),
    ticks: oc
        .meta(openapi({ method: 'GET', path: '/ticks' }))
        .output(eventIterator(z.number())),
}

const asContract = contract as unknown as RouterContract

/** The service as it really is: its controllers behind an HTTP server, with no idea the mesh exists. */
const router = implement(contract).router({
    items: {
        findById: implement(contract.items.findById).handler(
            ({ input, errors }) => {
                if (input.id === 'missing')
                    throw errors.NOT_FOUND({ data: { id: input.id } })
                return {
                    id: input.id,
                    createdAt: new Date('2026-10-29T12:00:00.000Z'),
                }
            }
        ),
    },
    whoami: implement(contract.whoami).handler(({ context }) => ({
        cookie: (context as { cookie?: string }).cookie ?? '',
    })),
    ticks: implement(contract.ticks).handler(async function* () {
        for (const tick of [1, 2, 3]) {
            await Promise.resolve()
            yield tick
        }
    }),
})

/**
 * The whole path a call takes between two services, on real sockets: a client built by the registry the BFF uses, the
 * agent of its node, a replica's mesh websocket, and the replica's own HTTP surface. Nothing in it is a stand-in for the
 * thing it tests.
 */
describe('service clients over the mesh', () => {
    let agent: BootedAgent
    let http: Server
    let membership: MeshMembership
    let cookie = 'session=alice'
    let registry: ServiceClientRegistry

    beforeAll(async () => {
        agent = await bootAgent()

        const handler = new OpenAPIHandler(router)
        http = createServer((request, response) => {
            void handler
                .handle(request, response, {
                    context: { cookie: request.headers.cookie ?? '' } as never,
                })
                .then((result) => {
                    if (!result.matched) response.writeHead(404).end()
                })
        })
        await new Promise<void>((resolve) =>
            http.listen(0, '127.0.0.1', resolve)
        )
        const port = (http.address() as AddressInfo).port

        membership = joinServiceMesh({
            service: 'items',
            replicaId: 'items-1',
            server: http,
            contracts: [contract as never],
            loopbackOrigin: `http://127.0.0.1:${String(port)}`,
            agentSocketPath: agent.transport.localSocketPath,
            advertiseUrl: `ws://127.0.0.1:${String(port)}/mesh/ws`,
            heartbeatMs: 50,
        })

        // The registry exactly as the BFF builds it when its node has an agent. The origin is never called: it points nowhere.
        const agentToNode = agentLink(agent.transport.localSocketPath)
        registry = new ServiceClientRegistry({
            resolveOrigin: () => 'http://127.0.0.1:1',
            headers: () => ({ cookie }),
            link: (service, boundContract) =>
                serviceLink({
                    agent: agentToNode,
                    service,
                    contract: boundContract,
                    headers: () => ({ cookie }),
                }),
        })
    }, 60_000)

    afterAll(async () => {
        await membership.stop()
        await new Promise<void>((resolve) =>
            http.close(() => {
                resolve()
            })
        )
        await agent.stop()
        removeDataDir(agent.dataDir)
    })

    const items = () =>
        registry.bind('items', asContract).raw as unknown as {
            items: {
                findById: (input: {
                    id: string
                }) => Promise<{ id: string; createdAt: Date }>
            }
            whoami: () => Promise<{ cookie: string }>
            ticks: () => Promise<AsyncIterable<number>>
        }

    it("reaches a replica the agent has learned of, and answers with the service's own result, dates included", async () => {
        await vi.waitFor(
            async () => {
                const item = await items().items.findById({ id: 'i-1' })
                expect(item).toEqual({
                    id: 'i-1',
                    createdAt: new Date('2026-10-29T12:00:00.000Z'),
                })
            },
            { timeout: 8_000 }
        )
    })

    it("makes each caller's credentials reach the service, on the one persistent connection", async () => {
        cookie = 'session=alice'
        const alice = await items().whoami()
        cookie = 'session=bob'
        const bob = await items().whoami()

        expect([alice, bob]).toEqual([
            { cookie: 'session=alice' },
            { cookie: 'session=bob' },
        ])
    })

    it("keeps the service's typed errors, with their code and data", async () => {
        const failure = await items()
            .items.findById({ id: 'missing' })
            .catch((error: unknown) => error)

        expect(failure).toBeInstanceOf(ORPCError)
        expect(failure).toMatchObject({
            code: 'NOT_FOUND',
            data: { id: 'missing' },
        })
    })

    it('keeps an event stream a stream, through the agent', async () => {
        const stream = await items().ticks()
        const received: number[] = []
        for await (const tick of stream) received.push(tick)

        expect(received).toEqual([1, 2, 3])
    })

    it('fails clearly for a service nobody has registered', async () => {
        const unknown = registry.bind('nobody-home', asContract)
            .raw as unknown as { whoami: () => Promise<unknown> }

        await expect(unknown.whoami()).rejects.toMatchObject({
            code: 'NOT_FOUND',
        })
    })
})
