import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type ClientContext, ORPCError } from '@orpc/client'
import { eventIterator, oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'
import { OpenAPIHandler } from '@orpc/openapi/node'
import { implement, os } from '@orpc/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as z from 'zod'

import {
    contractId,
    openWebSocketConnection,
    pooledLink,
} from '@deployer/mesh-client'
import { attachMeshWebSocket } from '@deployer/mesh-server'
import { MESH_WEBSOCKET_PATH } from '@deployer/node-agent-contracts'

import { joinServiceMesh } from './join-service-mesh'

import type { AddressInfo } from 'node:net'

const SWARM_SECRET = 'the-swarm-secret-only-the-agent-knows'

/** A contract with what services really have: a path parameter, a date, a typed error, a header the caller sets, a stream. */
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

/** The service as it really is: its controllers behind an HTTP server, with no idea the mesh exists. */
const service = implement(contract).router({
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

async function fakeAgent(directory: string) {
    const socketPath = join(directory, 'agent.sock')
    const server = createServer()
    const gateway = attachMeshWebSocket({
        server,
        path: MESH_WEBSOCKET_PATH,
        router: {
            directory: {
                register: os.input(z.any()).handler(({ input }) => input),
            },
            access: {
                verify: os
                    .input(
                        z.object({
                            presented: z.string(),
                            replicaId: z.string(),
                        })
                    )
                    .handler(({ input }) => ({
                        ok: input.presented === SWARM_SECRET,
                    })),
            },
        } as never,
        verify: () => true,
        context: () => ({}),
    })
    await new Promise<void>((resolve) => server.listen(socketPath, resolve))
    return {
        socketPath,
        close: async () => {
            await gateway.close()
            await new Promise<void>((resolve) =>
                server.close(() => {
                    resolve()
                })
            )
        },
    }
}

describe('joinServiceMesh', () => {
    let directory: string
    let agent: Awaited<ReturnType<typeof fakeAgent>>
    let http: Server
    let origin: string
    let stop: () => Promise<void>

    beforeEach(async () => {
        directory = mkdtempSync(join(tmpdir(), 'service-mesh-'))
        agent = await fakeAgent(directory)

        const handler = new OpenAPIHandler(service)
        http = createServer((request, response) => {
            void handler
                .handle(request, response, {
                    context: { cookie: request.headers.cookie ?? '' },
                })
                .then((result) => {
                    if (!result.matched) response.writeHead(404).end()
                })
        })
        await new Promise<void>((resolve) =>
            http.listen(0, '127.0.0.1', resolve)
        )
        const port = (http.address() as AddressInfo).port
        origin = `http://127.0.0.1:${String(port)}`

        const membership = joinServiceMesh({
            service: 'items',
            replicaId: 'items-1',
            server: http,
            contracts: [contract as never],
            loopbackOrigin: origin,
            agentSocketPath: agent.socketPath,
            advertiseUrl: `ws://127.0.0.1:${String(port)}${MESH_WEBSOCKET_PATH}`,
        })
        stop = async () => {
            await membership.stop()
        }
    })

    afterEach(async () => {
        await stop()
        await new Promise<void>((resolve) =>
            http.close(() => {
                resolve()
            })
        )
        await agent.close()
        rmSync(directory, { recursive: true, force: true })
    })

    /** A caller that is vouched for by the agent, reaching the replica's mesh websocket. */
    const caller = () => {
        const address = `ws://127.0.0.1:${String((http.address() as AddressInfo).port)}${MESH_WEBSOCKET_PATH}`
        return pooledLink<ClientContext>({
            target: address,
            maxConnections: 1,
            multiplex: 8,
            idleMs: 1_000,
            open: () =>
                Promise.resolve(
                    openWebSocketConnection({
                        url: `${address}?credential=${SWARM_SECRET}`,
                        reconnectDelayMs: 10,
                    })
                ),
        })
    }
    const id = contractId(contract)

    it("answers a call the way the service's own HTTP surface does, dates included", async () => {
        const link = caller()

        const item = await link.call(
            [id, 'items', 'findById'],
            { id: 'i-1' },
            { context: { headers: {} } }
        )

        expect(item).toEqual({
            id: 'i-1',
            createdAt: new Date('2026-10-29T12:00:00.000Z'),
        })
        await link.closeAll()
    })

    it("carries the caller's credentials to the service, which authenticates them as if they came to it directly", async () => {
        const link = caller()

        const [alice, bob] = await Promise.all([
            link.call([id, 'whoami'], undefined, {
                context: { headers: { cookie: 'session=alice' } },
            }),
            link.call([id, 'whoami'], undefined, {
                context: { headers: { cookie: 'session=bob' } },
            }),
        ])

        expect([alice, bob]).toEqual([
            { cookie: 'session=alice' },
            { cookie: 'session=bob' },
        ])
        await link.closeAll()
    })

    it("keeps the service's typed errors, with their code and data", async () => {
        const link = caller()

        const failure = await link
            .call(
                [id, 'items', 'findById'],
                { id: 'missing' },
                { context: { headers: {} } }
            )
            .catch((error: unknown) => error)

        expect(failure).toBeInstanceOf(ORPCError)
        expect(failure).toMatchObject({
            code: 'NOT_FOUND',
            data: { id: 'missing' },
        })
        await link.closeAll()
    })

    it('keeps an event stream a stream', async () => {
        const link = caller()

        const stream = (await link.call([id, 'ticks'], undefined, {
            context: { headers: {} },
        })) as AsyncIterable<number>
        const received: number[] = []
        for await (const tick of stream) received.push(tick)

        expect(received).toEqual([1, 2, 3])
        await link.closeAll()
    })

    it('refuses a peer the agent does not vouch for', async () => {
        const address = `ws://127.0.0.1:${String((http.address() as AddressInfo).port)}${MESH_WEBSOCKET_PATH}`
        const stranger = pooledLink<ClientContext>({
            target: address,
            maxConnections: 1,
            multiplex: 8,
            idleMs: 1_000,
            open: () =>
                Promise.resolve(
                    openWebSocketConnection({
                        url: `${address}?credential=guess`,
                        reconnectDelayMs: 10,
                    })
                ),
        })

        await expect(
            stranger.call([id, 'whoami'], undefined, {
                context: { headers: {} },
            })
        ).rejects.toBeDefined()
        await stranger.closeAll()
    })
})
