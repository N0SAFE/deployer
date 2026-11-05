import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { os } from '@orpc/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

import { openWebSocketConnection, pooledLink } from '@deployer/mesh-client'
import { attachMeshWebSocket } from '@deployer/mesh-server'
import { MESH_WEBSOCKET_PATH } from '@deployer/node-agent-contracts'

import {
    NODE_AGENT,
    type NodeAgent,
} from '../../modules/docker/domains/containers/mesh/docker-node-mesh'
import { LOCAL_NODE_OPERATIONS } from '../../modules/docker/domains/containers/mesh/local-node-operations'

import { joinRuntimeMesh } from './join-runtime-mesh'

import type { INestApplication } from '@nestjs/common'
import type { ClientContext } from '@orpc/client'

const SWARM_SECRET = 'the-swarm-secret-only-the-agent-knows'

type Registration = {
    service: string
    replicaId: string
    address: string
    keys: string[]
}

/** The agent of this node, on a unix socket: it records registrations and vouches only for the swarm's credential. */
async function fakeAgent(directory: string) {
    const registrations: Registration[] = []
    const socketPath = join(directory, 'agent.sock')
    const server = createServer()
    const gateway = attachMeshWebSocket({
        server,
        path: MESH_WEBSOCKET_PATH,
        router: {
            directory: {
                register: os
                    .input(
                        z.object({
                            service: z.string(),
                            replicaId: z.string(),
                            address: z.string(),
                            load: z.number(),
                            keys: z.array(z.string()),
                            ttlMs: z.number(),
                        })
                    )
                    .handler(({ input }) => {
                        registrations.push(input)
                        return input
                    }),
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
        registrations,
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

const containers = (ids: string[]) => ({
    data: ids.map((id) => ({ id })),
    meta: { total: ids.length, limit: 500, offset: 0, hasMore: false },
})

describe('joinRuntimeMesh', () => {
    let directory: string
    let agent: Awaited<ReturnType<typeof fakeAgent>>
    let server: Server
    const stops: (() => Promise<void>)[] = []

    beforeEach(async () => {
        directory = mkdtempSync(join(tmpdir(), 'runtime-mesh-'))
        agent = await fakeAgent(directory)
        server = createServer()
        await new Promise<void>((resolve) =>
            server.listen(0, '127.0.0.1', resolve)
        )
    })

    afterEach(async () => {
        for (const stop of stops.splice(0)) await stop()
        delete process.env.NODE_AGENT_SOCKET
        delete process.env.MESH_ADVERTISE_URL
        await agent.close()
        await new Promise<void>((resolve) =>
            server.close(() => {
                resolve()
            })
        )
        rmSync(directory, { recursive: true, force: true })
    })

    let holder: NodeAgent
    const appWith = (local: unknown) => {
        holder = { link: undefined, selfReplicaId: 'runtime-test' }
        return {
            get: (token: unknown) =>
                token === LOCAL_NODE_OPERATIONS
                    ? local
                    : token === NODE_AGENT
                      ? holder
                      : undefined,
            getHttpServer: () => server,
        } as unknown as INestApplication
    }

    it('runs without the mesh when the node has no agent, as it always did', () => {
        process.env.NODE_AGENT_SOCKET = join(directory, 'no-such-agent.sock')

        expect(joinRuntimeMesh(appWith({}))).toBeUndefined()
    })

    it("registers with the node's agent, announcing every container on the node as a key it holds", async () => {
        process.env.NODE_AGENT_SOCKET = agent.socketPath
        process.env.MESH_ADVERTISE_URL = 'ws://runtime-host:3105/mesh/ws'
        const local = {
            listContainers: vi.fn().mockResolvedValue(containers(['c1', 'c2'])),
        }

        const membership = joinRuntimeMesh(appWith(local))
        stops.push(() => membership?.stop() ?? Promise.resolve())

        await vi.waitFor(
            () => {
                expect(agent.registrations.length).toBeGreaterThan(0)
            },
            { timeout: 8_000 }
        )
        expect(agent.registrations[0]).toMatchObject({
            service: 'runtime',
            address: 'ws://runtime-host:3105/mesh/ws',
            keys: ['c1', 'c2'],
        })
        expect(agent.registrations[0]?.replicaId).toMatch(/^runtime-/)
    })

    it('gives the docker callers the link to the agent once it has joined, and not before', () => {
        process.env.NODE_AGENT_SOCKET = agent.socketPath
        const app = appWith({
            listContainers: vi.fn().mockResolvedValue(containers([])),
        })
        expect(holder.link).toBeUndefined()

        const membership = joinRuntimeMesh(app)
        stops.push(() => membership?.stop() ?? Promise.resolve())

        expect(holder.link).toBe(membership?.agent)
    })

    it('keeps beating when the engine cannot be listed, announcing nothing for that round', async () => {
        process.env.NODE_AGENT_SOCKET = agent.socketPath
        const local = {
            listContainers: vi
                .fn()
                .mockRejectedValue(new Error('docker is down')),
        }

        const membership = joinRuntimeMesh(appWith(local))
        stops.push(() => membership?.stop() ?? Promise.resolve())

        await vi.waitFor(
            () => {
                expect(agent.registrations.length).toBeGreaterThan(0)
            },
            { timeout: 8_000 }
        )
        expect(agent.registrations[0]?.keys).toEqual([])
    })

    it("serves the node router to a peer the agent vouches for, answering from the node's own engine", async () => {
        process.env.NODE_AGENT_SOCKET = agent.socketPath
        const local = {
            listContainers: vi.fn().mockResolvedValue(containers([])),
            getLocalDockerDaemonId: vi.fn().mockResolvedValue('daemon-7'),
        }
        const membership = joinRuntimeMesh(appWith(local))
        stops.push(() => membership?.stop() ?? Promise.resolve())
        const address = `ws://127.0.0.1:${String((server.address() as { port: number }).port)}${MESH_WEBSOCKET_PATH}`
        const caller = pooledLink<ClientContext>({
            target: address,
            maxConnections: 1,
            multiplex: 4,
            idleMs: 1_000,
            open: () =>
                Promise.resolve(
                    openWebSocketConnection({
                        url: `${address}?credential=${SWARM_SECRET}`,
                        reconnectDelayMs: 20,
                    })
                ),
        })
        stops.push(() => caller.closeAll())

        const page = await caller.call(
            ['mesh', 'node', 'containers', 'list'],
            { limit: 20, offset: 0 },
            { context: {} }
        )

        expect(page).toMatchObject({ daemonId: 'daemon-7', data: [] })
    })

    it('refuses a peer the agent does not vouch for', async () => {
        process.env.NODE_AGENT_SOCKET = agent.socketPath
        const membership = joinRuntimeMesh(
            appWith({ listContainers: () => Promise.resolve(containers([])) })
        )
        stops.push(() => membership?.stop() ?? Promise.resolve())
        const address = `ws://127.0.0.1:${String((server.address() as { port: number }).port)}${MESH_WEBSOCKET_PATH}`
        const stranger = pooledLink<ClientContext>({
            target: address,
            maxConnections: 1,
            multiplex: 4,
            idleMs: 1_000,
            open: () =>
                Promise.resolve(
                    openWebSocketConnection({
                        url: `${address}?credential=guess`,
                        reconnectDelayMs: 20,
                    })
                ),
        })
        stops.push(() => stranger.closeAll())

        await expect(
            stranger.call(
                ['mesh', 'node', 'containers', 'list'],
                { limit: 20, offset: 0 },
                { context: {} }
            )
        ).rejects.toBeDefined()
    })
})
