import { describe, expect, it } from 'vitest'

import {
    setupMeshJoinInputSchema,
    setupMeshJoinResultSchema,
    setupMeshStatusSchema,
    setupMeshTokenInputSchema,
    setupMeshTokenResultSchema,
} from '@/index'

/**
 * The wizard's mesh entities. They describe a node that may have NO agent and
 * NO swarm, so the assertions are about absence being representable — a schema
 * that required an agent id would make a standalone node unrenderable — and
 * about a refusal carrying a reason the UI can show verbatim.
 */
describe('setup mesh schemas', () => {
    it('parses a standalone node with no agent', () => {
        const parsed = setupMeshStatusSchema.parse({
            available: false,
            agentId: null,
            interfaceUp: false,
            meshAddress: null,
            nodeId: null,
            swarm: null,
        })

        expect(parsed.swarm).toBeNull()
        expect(parsed.agentId).toBeNull()
    })

    it('parses a swarm with peers and their handshake state', () => {
        const parsed = setupMeshStatusSchema.parse({
            available: true,
            agentId: 'node-a',
            interfaceUp: true,
            meshAddress: '10.88.0.2',
            nodeId: 'platform-1',
            swarm: {
                nodes: 2,
                peers: [
                    {
                        nodeId: 'node-b',
                        meshAddress: '10.88.0.3',
                        handshake: true,
                    },
                ],
            },
        })

        expect(parsed.swarm?.nodes).toBe(2)
        expect(parsed.swarm?.peers[0]?.handshake).toBe(true)
    })

    it('rejects a negative node count', () => {
        expect(() =>
            setupMeshStatusSchema.parse({
                available: true,
                agentId: 'node-a',
                interfaceUp: true,
                meshAddress: null,
                nodeId: null,
                swarm: { nodes: -1, peers: [] },
            })
        ).toThrow()
    })

    it('requires a non-empty invite token', () => {
        expect(setupMeshJoinInputSchema.safeParse({ token: '' }).success).toBe(
            false
        )
        expect(
            setupMeshJoinInputSchema.safeParse({ token: 'abc' }).success
        ).toBe(true)
    })

    it('parses both a join and a refusal (joined: false + reason)', () => {
        const joined = setupMeshJoinResultSchema.parse({
            joined: true,
            swarmId: null,
            agents: [{ nodeId: 'node-b', address: '10.88.0.3' }],
            reason: null,
        })
        const refused = setupMeshJoinResultSchema.parse({
            joined: false,
            swarmId: null,
            agents: [],
            reason: 'This invite is not valid for this swarm.',
        })

        expect(joined.agents).toHaveLength(1)
        expect(refused.joined).toBe(false)
        expect(refused.reason).toContain('not valid')
    })

    it('parses token input/output, with an optional positive TTL', () => {
        expect(setupMeshTokenInputSchema.parse({})).toEqual({})
        expect(setupMeshTokenInputSchema.parse({ ttlMs: 60_000 })).toEqual({
            ttlMs: 60_000,
        })
        expect(setupMeshTokenInputSchema.safeParse({ ttlMs: 0 }).success).toBe(
            false
        )

        expect(setupMeshTokenResultSchema.parse({ token: null })).toEqual({
            token: null,
        })
        expect(setupMeshTokenResultSchema.parse({ token: 'invite' })).toEqual({
            token: 'invite',
        })
    })
})
