import { Effect } from 'effect'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { agentLink, createMeshClient } from '@deployer/mesh-client'
import { type nodeAgentContract } from '@deployer/node-agent-contracts'

import { type BootedAgent, bootAgent, peerClient, removeDataDir } from './boot-agent'

import type { ContractRouterClient } from '@orpc/contract'

type NodeAgentClient = ContractRouterClient<typeof nodeAgentContract>

const SWARM_SECRET = 'platform-secret-rotation-spec-secret-32-chars'
const NODE_A = '0192f5c1-8f3b-4f2e-9a4d-2b7c1d3e5f61'
const NODE_B = '0192f5c1-8f3b-4f2e-9a4d-2b7c1d3e5f62'
const FIRST = 'first-generation-platform-secret-0123456789'

/**
 * A rotation across two real agents over real sockets: the unit specs cover each piece, this proves they work together. A
 * node rotates, the other pulls the new generation on its own gossip round, the fleet view shows both current, and retiring the
 * old generation reaches the node that did not order it.
 */
describe('platform secret rotation across two agents', () => {
    const running: BootedAgent[] = []
    const dirs: string[] = []

    afterAll(async () => {
        await Promise.all(running.map((agent) => agent.stop().catch(() => undefined)))
        dirs.forEach(removeDataDir)
    })

    /** What a service on the node may ask: state and the fleet view. */
    const local = (agent: BootedAgent) =>
        createMeshClient<NodeAgentClient>(agentLink(agent.transport.localSocketPath))
    /** What the operator may do: configure the node, rotate and retire. A service container does not hold this socket. */
    const admin = (agent: BootedAgent) =>
        createMeshClient<NodeAgentClient>(agentLink(agent.transport.adminSocketPath))

    async function boot(pin: { nodeId: string; seeds?: string[] }): Promise<BootedAgent> {
        const agent = await bootAgent({ pin: { ...pin, secret: SWARM_SECRET } })
        running.push(agent)
        dirs.push(agent.dataDir)
        return agent
    }

    /** A node as setup leaves it: configured, holding generation 1 of the platform secret. */
    const configure = (agent: BootedAgent, nodeId: string) =>
        Effect.runPromise(
            admin(agent).node.configure({
                nodeId,
                strategy: 'local',
                platformSecret: FIRST,
                platformSecretGeneration: 1,
            })
        )

    it('spreads a rotation to the other node, shows both current, and retires the old generation on both', async () => {
        const a = await boot({ nodeId: 'node-a' })
        const b = await boot({ nodeId: 'node-b', seeds: [a.ws] })
        await configure(a, NODE_A)
        await configure(b, NODE_B)

        // The two agents know each other before anything is rotated.
        await vi.waitFor(async () => {
            const view = await Effect.runPromise(peerClient(a, SWARM_SECRET).roster.view({}))
            expect(view.agents.some((agent) => agent.nodeId === 'node-b')).toBe(true)
        })

        // Rotate on A.
        const rotated = await Effect.runPromise(admin(a).node.rotatePlatformSecret({}))
        expect(rotated).toEqual({ generation: 2 })

        // B pulls it on its own gossip round, keeping generation 1 as an earlier one.
        await vi.waitFor(async () => {
            const state = await Effect.runPromise(local(b).node.state({}))
            expect(state.config?.platformSecretGeneration).toBe(2)
        })
        const onA = (await Effect.runPromise(local(a).node.state({}))).config
        const onB = (await Effect.runPromise(local(b).node.state({}))).config
        expect(onB?.platformSecret).toBe(onA?.platformSecret)
        expect(onB?.platformSecret).not.toBe(FIRST)
        expect(onB?.platformSecretPrevious).toEqual([{ generation: 1, value: FIRST }])

        // The fleet's picture: both on the same generation, both still accepting the old one.
        await vi.waitFor(async () => {
            const fleet = await Effect.runPromise(local(a).node.fleetSecrets({}))
            const platform = fleet.adoption.find((entry) => entry.id === 'platform')
            expect(platform?.currentGeneration).toBe(2)
            expect(platform?.nodes.map((node) => node.status)).toEqual(['current', 'current'])
            expect(fleet.nodes.every((node) => node.reachable)).toBe(true)
            expect(
                fleet.nodes.flatMap((node) => node.secrets.find((s) => s.id === 'platform')?.earlierGenerations ?? [])
            ).toEqual([1, 1])
        })

        // A service on the node can read the picture but cannot rotate or retire: those are not on its door.
        await expect(
            Effect.runPromise(local(a).node.rotatePlatformSecret({}))
        ).rejects.toBeDefined()

        // No value ever travels in the fleet view.
        const fleet = await Effect.runPromise(local(a).node.fleetSecrets({}))
        expect(JSON.stringify(fleet)).not.toContain(FIRST)
        expect(JSON.stringify(fleet)).not.toContain(onA?.platformSecret ?? 'unreachable')

        // The current generation cannot be retired.
        await expect(
            Effect.runPromise(admin(a).node.retirePlatformSecret({ generation: 2 }))
        ).rejects.toMatchObject({ message: expect.stringContaining('current generation') })

        // Retiring generation 1 from A reaches B too.
        const retired = await Effect.runPromise(admin(a).node.retirePlatformSecret({ generation: 1 }))
        expect(retired.generation).toBe(2)
        expect(retired.reached).toContain('node-b')
        expect(retired.unreachable).toEqual([])
        for (const agent of [a, b]) {
            const config = (await Effect.runPromise(local(agent).node.state({}))).config
            expect(config?.platformSecretPrevious).toEqual([])
            expect(config?.platformSecretGeneration).toBe(2)
        }
    })
})
