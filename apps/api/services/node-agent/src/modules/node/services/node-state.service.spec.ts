import { DatabaseSync } from 'node:sqlite'

import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { AgentStore, agentStoreOver } from '../../../local/agent-store'
import { NodeIdentity } from '../../mesh/services/node-identity.service'

import { NodeState } from './node-state.service'

/** A node nobody configured yet, with the store of a real (in-memory) database behind it. */
function nodeFixture(nodeId = 'node-a') {
    const store = agentStoreOver(new DatabaseSync(':memory:') as never)
    const provide = <A, E>(
        effect: Effect.Effect<A, E, AgentStore | NodeIdentity>
    ) =>
        effect.pipe(
            Effect.provideService(AgentStore, store),
            Effect.provideService(NodeIdentity, { nodeId })
        )

    return {
        run: <A, E>(effect: Effect.Effect<A, E, AgentStore | NodeIdentity>) =>
            Effect.runPromise(provide(effect)),
        settle: <A, E>(
            effect: Effect.Effect<A, E, AgentStore | NodeIdentity>
        ) =>
            Effect.runPromise(
                provide(effect).pipe(
                    Effect.match({
                        onSuccess: (value) => ({ value }),
                        onFailure: (error) => ({ error }),
                    })
                )
            ),
    }
}

/** The platform node id: chosen by setup (or a CLI), stored in the agent's record, never invented by the agent. */
const PLATFORM_NODE_ID = '0192f5c1-8f3b-4f2e-9a4d-2b7c1d3e5f60'

describe('NodeState', () => {
    it('still reads a record written before the platform secret existed', async () => {
        // The record as an agent wrote it before `platformSecret` existed: the two fields are simply absent.
        const legacy = {
            nodeId: PLATFORM_NODE_ID,
            strategy: 'local',
            setupState: 'setup_done',
            deployerVersion: null,
            upgradedAtVersion: null,
            databaseUrl: null,
            databaseProvisioning: null,
            meshUrlsSnapshot: [],
            swarmConfig: null,
            peerServiceToken: null,
            peerServiceTokenExpiresAt: null,
            meshSharedSecret: 'mesh-value',
            meshSharedSecretUpdatedAt: null,
            scanConfig: null,
            mesh: null,
            postSetupFlags: null,
            configuredAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z',
        }
        // Put the old shape straight into the agent's store, as an upgrade finds it.
        const store = agentStoreOver(new DatabaseSync(':memory:') as never)
        await Effect.runPromise(store.putNodeConfig(JSON.stringify(legacy), Date.now()))
        const state = await Effect.runPromise(
            new NodeState.live().state().pipe(
                Effect.provideService(AgentStore, store),
                Effect.provideService(NodeIdentity, { nodeId: 'n' })
            )
        )
        expect(state.config?.platformSecret).toBeNull()
    })

    it('reports what the node holds without a value', async () => {
        const node = nodeFixture()
        await node.run(
            new NodeState.live().configure({
                nodeId: PLATFORM_NODE_ID,
                strategy: 'local',
                platformSecret: 'platform-value',
            } as never)
        )

        const inventory = await node.run(new NodeState.live().secrets())

        expect(inventory.secrets.find((entry) => entry.id === 'platform')?.fingerprint).toMatch(/^[0-9a-f]{12}$/)
        expect(JSON.stringify(inventory)).not.toContain('platform-value')
    })

    it('reports a running node as unconfigured, with nothing invented', async () => {
        const node = nodeFixture('node-fresh')

        expect(await node.run(new NodeState.live().state())).toEqual({
            agentId: 'node-fresh',
            configured: false,
            config: null,
        })
    })

    it('creates the node by writing its config, and stamps when it was created', async () => {
        const node = nodeFixture()

        const configured = await node.run(
            new NodeState.live().configure({
                nodeId: PLATFORM_NODE_ID,
                strategy: 'local',
                swarmConfig: {
                    mode: 'create',
                    policy: 'auto',
                    advertiseAddr: null,
                    joinToken: null,
                    joinAddrs: [],
                },
            })
        )

        expect(configured).toMatchObject({
            agentId: 'node-a',
            configured: true,
            config: {
                nodeId: PLATFORM_NODE_ID,
                strategy: 'local',
                setupState: 'not_started',
                databaseUrl: null,
                meshUrlsSnapshot: [],
                swarmConfig: { mode: 'create' },
                // Nothing invented at boot: the mesh section is empty until something writes it.
                mesh: null,
            },
        })
        expect(configured.config.configuredAt).toBe(configured.config.updatedAt)
        expect((await node.run(new NodeState.live().state())).config).toEqual(
            configured.config
        )
    })

    it('patches: a named field replaces the stored one and an absent one keeps its value', async () => {
        const node = nodeFixture()
        await node.run(
            new NodeState.live().configure({
                strategy: 'local',
                databaseUrl: 'postgres://db',
            })
        )
        const created = (await node.run(new NodeState.live().state())).config

        const patched = await node.run(
            new NodeState.live().configure({
                setupState: 'setup_done',
                databaseUrl: 'postgres://other',
            })
        )

        expect(patched.config).toMatchObject({
            setupState: 'setup_done',
            databaseUrl: 'postgres://other',
            strategy: 'local',
            nodeId: null,
        })
        // The creation time survives every later write; only the last-write time moves.
        expect(patched.config.configuredAt).toBe(created?.configuredAt)
    })

    it("stores the node's mesh config, and keeps it across a patch that does not name it", async () => {
        const node = nodeFixture()
        const mesh = {
            nodeServerUrl: 'https://node-a.example.com',
            bootstrapPeers: 'wss://peer-a',
            syncIntervalMs: 10_000,
            trustStrictMinAckRatio: '0.75',
            trustStrictMaxAckAgeSeconds: 300,
            trustStrictRolloutWaveSize: 3,
            trustStrictAutoRollback: true,
            controlEnvelopeTrustRequired: true,
        }

        expect((await node.run(new NodeState.live().state())).config).toBeNull()
        const written = await node.run(new NodeState.live().configure({ mesh }))
        expect(written.config.mesh).toEqual(mesh)
        expect(
            (await node.run(new NodeState.live().state())).config?.mesh
        ).toEqual(mesh)

        const patched = await node.run(
            new NodeState.live().configure({ setupState: 'setup_done' })
        )
        expect(patched.config.mesh).toEqual(mesh)
    })

    it('refuses to serve a config it cannot read instead of guessing', async () => {
        const store = agentStoreOver(new DatabaseSync(':memory:') as never)
        await Effect.runPromise(store.putNodeConfig('{ not a config'))

        const outcome = await Effect.runPromise(
            new NodeState.live().state().pipe(
                Effect.provideService(AgentStore, store),
                Effect.provideService(NodeIdentity, { nodeId: 'node-a' }),
                Effect.match({
                    onSuccess: (value) => ({ value }),
                    onFailure: (error) => ({ error }),
                })
            )
        )

        expect(outcome).toMatchObject({
            error: { _tag: 'NodeConfigUnreadable' },
        })
    })
})
