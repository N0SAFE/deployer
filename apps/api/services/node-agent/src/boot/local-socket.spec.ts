import { createServer, type Server } from 'node:http'

import { os } from '@orpc/server'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
    createMeshClient,
    grantFollowingLink,
    openWebSocketConnection,
    pooledLink,
    relayLink,
} from '@deployer/mesh-client'
import { type MeshMembership, joinMesh } from '@deployer/mesh-service'
import {
    MESH_WEBSOCKET_PATH,
    type nodeAgentContract,
} from '@deployer/node-agent-contracts'

import { type BootedAgent, bootAgent, removeDataDir } from './boot-agent'

import type { ClientContext } from '@orpc/client'
import type { ContractRouterClient } from '@orpc/contract'
import type { AddressInfo } from 'node:net'

type NodeAgentClient = ContractRouterClient<typeof nodeAgentContract>

/**
 * A service that never holds the swarm's credential, on a real agent, over real sockets.
 *
 * The replica reaches its agent through the agent's unix socket and registers there. Callers on the node reach the
 * agent the same way. The agent reaches the replica over the network with the swarm's credential, and the replica asks
 * the agent whether to trust it: the secret exists only in the agent's own store.
 */
describe("a service on the node, through the agent's local socket", () => {
    let agent: BootedAgent
    let replicaServer: Server
    let membership: MeshMembership
    let replicaWs: string

    const local = (path: string) =>
        pooledLink<ClientContext>({
            target: path,
            maxConnections: 1,
            multiplex: 8,
            idleMs: 1_000,
            open: () =>
                Promise.resolve(
                    openWebSocketConnection({
                        url: `ws://agent${MESH_WEBSOCKET_PATH}`,
                        socketPath: path,
                        reconnectDelayMs: 20,
                    })
                ),
        })

    beforeAll(async () => {
        agent = await bootAgent()

        replicaServer = createServer()
        await new Promise<void>((resolve) =>
            replicaServer.listen(0, '127.0.0.1', resolve)
        )
        replicaWs = `ws://127.0.0.1:${String((replicaServer.address() as AddressInfo).port)}${MESH_WEBSOCKET_PATH}`

        // This is everything a service needs: where its agent's socket is. No secret, no agent URL.
        membership = joinMesh({
            service: 'runtime',
            replicaId: 'runtime-1',
            server: replicaServer,
            router: {
                logs: {
                    list: os.handler(() => ({
                        lines: 3,
                        servedBy: 'runtime-1',
                    })),
                },
            } as never,
            context: () => ({}),
            agentSocketPath: agent.transport.localSocketPath,
            advertiseUrl: replicaWs,
            keys: () => ['stream-1'],
            heartbeatMs: 50,
        })
    }, 60_000)

    afterAll(async () => {
        await membership.stop()
        await new Promise<void>((resolve) =>
            replicaServer.close(() => {
                resolve()
            })
        )
        await agent.stop()
        removeDataDir(agent.dataDir)
    })

    it('is registered with its agent, with the keys it holds, by registering through the socket alone', async () => {
        const caller = createMeshClient<NodeAgentClient>(
            local(agent.transport.localSocketPath)
        )

        await vi.waitFor(async () => {
            const resolution = await Effect.runPromise(
                caller.directory.resolve({
                    service: 'runtime',
                    key: 'stream-1',
                })
            )
            expect(resolution).toMatchObject({
                reason: 'key-holder',
                replica: { replicaId: 'runtime-1', address: replicaWs },
            })
        })
    })

    it('answers a caller that talks to the agent through the socket, with no credential on either side', async () => {
        const caller = local(agent.transport.localSocketPath)

        // The replica registers by heartbeat, so wait for the directory to answer a key lookup before relaying.
        await vi.waitFor(async () => {
            const answer = await relayLink({
                agent: caller,
                target: { service: 'runtime', key: 'stream-1' },
            }).call(['logs', 'list'], {}, { context: {} })
            expect(answer).toEqual({ lines: 3, servedBy: 'runtime-1' })
        })
        await caller.closeAll()
    })

    it('lets a caller go straight to the replica on a grant, which the replica checks with its agent', async () => {
        const caller = local(agent.transport.localSocketPath)
        const link = grantFollowingLink({
            agent: relayLink({
                agent: caller,
                target: { service: 'runtime', key: 'stream-1', heavy: true },
            }),
            direct: (grant) =>
                pooledLink<ClientContext>({
                    target: grant.replicaId,
                    maxConnections: 1,
                    multiplex: 4,
                    idleMs: 1_000,
                    open: () =>
                        Promise.resolve(
                            openWebSocketConnection({
                                url: `${grant.address}?credential=${grant.token}`,
                                reconnectDelayMs: 20,
                            })
                        ),
                }),
        })

        await vi.waitFor(async () => {
            await expect(
                link.call(['logs', 'list'], {}, { context: {} })
            ).resolves.toEqual({ lines: 3, servedBy: 'runtime-1' })
        })
        await caller.closeAll()
    })

    it('refuses a stranger at the replica: the agent does not vouch for a guess', async () => {
        const stranger = pooledLink<ClientContext>({
            target: replicaWs,
            maxConnections: 1,
            multiplex: 4,
            idleMs: 1_000,
            open: () =>
                Promise.resolve(
                    openWebSocketConnection({
                        url: `${replicaWs}?credential=guess`,
                        reconnectDelayMs: 10,
                    })
                ),
        })

        await expect(
            stranger.call(['logs', 'list'], {}, { context: {} })
        ).rejects.toBeDefined()
        await stranger.closeAll()
    })
})
