import { Cause, Effect, Exit, Scope } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ClusterSnapshot } from '@deployer/contracts-entities'
import { LOCAL_MIGRATIONS_DIR } from '@deployer/nest-schema/migrations'

import { makeLocalDatabase } from '../database/local-database'

import { makeClusterNodeInventoryRepository } from './cluster-node-inventory.repository'
import { makeClusterNodeRepository } from './cluster-node.repository'
import { toEngineNodeRow } from './engine-node-row'
import {
    makeAgentFirstNodeConfigRepository,
    makeNodeConfigRepository,
    type NewNodeConfigRow,
    type NodeConfigRow,
} from './node-config.repository'

async function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
    const exit = await Effect.runPromiseExit(effect)
    if (Exit.isSuccess(exit)) return exit.value
    throw Cause.squash(exit.cause)
}

const snapshot = (term: number): ClusterSnapshot => ({
    clusterId: 'cluster-abc',
    clusterName: null,
    localNodeState: 'active',
    controlAvailable: true,
    nodeCount: 3,
    managerCount: 3,
    localNode: {
        nodeId: 'n1',
        hostname: 'node-1',
        swarmRole: 'manager',
        platformRole: 'both',
        isMaster: true,
        isIngress: true,
        availability: 'active',
        capacity: { nanoCpus: 4_000_000_000, memoryBytes: 8_589_934_592 },
        labels: { 'deployer.ingress': 'true' },
        lastHeartbeatAt: '2026-09-04T00:00:00Z',
    },
    master: {
        nodeId: 'n1',
        term,
        electedAt: '2026-09-04T00:00:00Z',
        heartbeatAt: '2026-09-04T00:00:00Z',
        reason: 'raft_leader',
    },
    membership: {
        nodeId: 'n1',
        state: 'active',
        joinedAt: '2026-09-04T00:00:00Z',
    },
})

let scope: Scope.Closeable
let database: Awaited<ReturnType<typeof open>>

const open = () =>
    run(
        Effect.gen(function* () {
            scope = yield* Scope.make()
            return yield* makeLocalDatabase({
                databasePath: ':memory:',
                migrationsDir: LOCAL_MIGRATIONS_DIR,
            }).pipe(Scope.provide(scope))
        })
    )

beforeEach(async () => {
    database = await open()
})

afterEach(async () => {
    await run(Scope.close(scope, Exit.void))
})

describe('LocalDatabase', () => {
    it('applies the migrations to a fresh database and records them', () => {
        const tables = database.client
            .query("SELECT name FROM sqlite_master WHERE type = 'table'")
            .all() as { name: string }[]

        expect(tables.map((table) => table.name)).toEqual(
            expect.arrayContaining([
                'node_config',
                'cluster_node',
                'cluster_nodes',
                'local_migrations',
            ])
        )
    })

    it('turns a failing query into a LocalDatabaseError naming the operation', async () => {
        await expect(
            run(
                database.use('bad query', (db) => {
                    db.run('select * from nope')
                })
            )
        ).rejects.toMatchObject({
            _tag: 'LocalDatabaseError',
            operation: 'bad query',
        })
    })
})

describe('NodeConfigRepository', () => {
    it('has no config until one is written, then returns what was upserted', async () => {
        const repository = makeNodeConfigRepository(database)
        expect(await run(repository.find())).toBeNull()

        const written = await run(
            repository.upsert({
                nodeId: 'n1',
                strategy: 'local',
                meshUrlsSnapshot: ['http://a'],
            } as never)
        )

        expect(written.meshUrlsSnapshot).toEqual(['http://a'])
        expect((await run(repository.find()))?.meshUrlsSnapshot).toEqual([
            'http://a',
        ])
    })

    it('merges mesh peers without duplicates, and does nothing before there is a row', async () => {
        const repository = makeNodeConfigRepository(database)
        expect(await run(repository.updateMeshPeers(['http://x']))).toBeNull()
        await run(
            repository.upsert({
                nodeId: 'n1',
                strategy: 'local',
                meshUrlsSnapshot: ['http://a'],
            } as never)
        )

        const merged = await run(
            repository.updateMeshPeers(['http://a', 'http://b'])
        )

        expect(merged?.meshUrlsSnapshot).toEqual(['http://a', 'http://b'])
    })
})

const AGENT_ROW: NodeConfigRow = {
    id: 1,
    nodeId: 'agent-node',
    strategy: 'local',
    setupState: 'setup_done',
    deployerVersion: '1.2.3',
    upgradedAtVersion: null,
    meshUrlsSnapshot: ['http://agent'],
    databaseUrl: 'postgres://agent',
    databaseProvisioning: 'local',
    configuredAt: '2026-10-30T10:00:00.000Z',
    peerServiceToken: null,
    peerServiceTokenExpiresAt: null,
    updatedAt: '2026-10-30T10:00:00.000Z',
    meshSharedSecret: 'agent-secret',
    meshSharedSecretUpdatedAt: null,
    platformSecret: null,
    platformSecretUpdatedAt: null,
    platformSecretGeneration: 1,
    platformSecretPrevious: null,
    scanConfig: null,
    postSetupFlags: null,
    swarmConfig: null,
}

const localRows = () => database.client.query('SELECT * FROM node_config').all()

describe('AgentFirstNodeConfigRepository', () => {
    it("answers from the agent's record and never touches the local file", async () => {
        const writes: NewNodeConfigRow[] = []
        const repository = makeAgentFirstNodeConfigRepository(database, {
            read: () => Effect.succeed(AGENT_ROW),
            write: (row) => {
                writes.push(row)
                return Effect.succeed({ ...AGENT_ROW, ...row, id: 1 })
            },
        })

        expect(await run(repository.find())).toEqual(AGENT_ROW)
        expect(await run(repository.getMeshSharedSecret())).toBe('agent-secret')

        const written = await run(
            repository.upsert({ nodeId: 'written', strategy: 'local' } as never)
        )

        expect(written.nodeId).toBe('written')
        expect(writes).toHaveLength(1)
        expect(localRows()).toEqual([])
    })

    it('falls back to the local file when the record store has no answer', async () => {
        await run(
            makeNodeConfigRepository(database).upsert({
                nodeId: 'file-node',
                strategy: 'local',
                updatedAt: '2026-10-30T10:00:00.000Z',
            })
        )
        const repository = makeAgentFirstNodeConfigRepository(database, {
            read: () => Effect.succeed(null),
            write: () => Effect.succeed(null),
        })

        expect((await run(repository.find()))?.nodeId).toBe('file-node')
        expect(
            (
                await run(
                    repository.upsert({
                        nodeId: 'file-2',
                        strategy: 'local',
                    } as never)
                )
            ).nodeId
        ).toBe('file-2')
        expect((await run(repository.find()))?.nodeId).toBe('file-2')
    })

    it('merges mesh peers through the record store, deduplicated', async () => {
        const writes: NewNodeConfigRow[] = []
        const repository = makeAgentFirstNodeConfigRepository(database, {
            read: () => Effect.succeed(AGENT_ROW),
            write: (row) => {
                writes.push(row)
                return Effect.succeed({ ...AGENT_ROW, ...row, id: 1 })
            },
        })

        const merged = await run(
            repository.updateMeshPeers(['http://agent', 'http://new'])
        )

        expect(merged?.meshUrlsSnapshot).toEqual(['http://agent', 'http://new'])
        expect(writes[0]?.meshUrlsSnapshot).toEqual([
            'http://agent',
            'http://new',
        ])
        expect(localRows()).toEqual([])
    })
})

describe('platform secret', () => {
    const seed = () =>
        makeNodeConfigRepository(database).upsert({
            nodeId: 'n1',
            strategy: 'local',
            updatedAt: '2026-10-30T10:00:00.000Z',
        })

    it('is not invented before the node has a config row', async () => {
        const repository = makeNodeConfigRepository(database)
        expect(await run(repository.ensurePlatformSecret())).toBeNull()
        expect(await run(repository.getPlatformSecret())).toBeNull()
    })

    it('is generated once, then stays the same across reads and a restart', async () => {
        await run(seed())
        const repository = makeNodeConfigRepository(database)
        const first = await run(repository.ensurePlatformSecret())

        expect(first).toMatch(/^[0-9a-f]{64}$/)
        expect(await run(repository.ensurePlatformSecret())).toBe(first)
        expect(await run(makeNodeConfigRepository(database).getPlatformSecret())).toBe(first)
    })

    it('adopts the secret an upgraded node already lived under, once', async () => {
        await run(seed())
        const repository = makeNodeConfigRepository(database)

        expect(await run(repository.ensurePlatformSecret('old-root-secret'))).toBe(
            'old-root-secret'
        )
        expect(await run(repository.ensurePlatformSecret('another-one'))).toBe(
            'old-root-secret'
        )
    })

    it('keeps a secret the node received instead of replacing it', async () => {
        await run(seed())
        const repository = makeNodeConfigRepository(database)
        const row = await run(repository.find())
        if (row === null) throw new Error('seeded row missing')
        const { id: _id, ...rest } = row
        await run(repository.upsert({ ...rest, platformSecret: 'from-the-mesh' }))

        expect(await run(repository.ensurePlatformSecret())).toBe('from-the-mesh')
    })
})

describe('platform secret ring', () => {
    const configured = async () => {
        await run(
            makeNodeConfigRepository(database).upsert({
                nodeId: 'n1',
                strategy: 'local',
                updatedAt: '2026-10-30T10:00:00.000Z',
            })
        )
        return makeNodeConfigRepository(database)
    }

    it('starts at generation 1 with nothing earlier', async () => {
        const repository = await configured()
        const value = await run(repository.ensurePlatformSecret())

        expect(await run(repository.platformSecretRing())).toEqual({
            generation: 1,
            value,
            previous: [],
        })
    })

    it('rotates to a new current value and keeps the old one accepted, newest first', async () => {
        const repository = await configured()
        const first = await run(repository.ensurePlatformSecret())

        const second = await run(repository.rotatePlatformSecret())
        const third = await run(repository.rotatePlatformSecret())

        expect(second?.generation).toBe(2)
        expect(second?.value).not.toBe(first)
        expect(third).toMatchObject({ generation: 3 })
        expect(third?.previous).toEqual([
            { generation: 2, value: second?.value },
            { generation: 1, value: first },
        ])
    })

    it('has nothing to rotate before the node holds a secret', async () => {
        const repository = await configured()
        expect(await run(repository.rotatePlatformSecret())).toBeNull()
    })

    it('retires an earlier generation on request, and never the current one', async () => {
        const repository = await configured()
        await run(repository.ensurePlatformSecret())
        await run(repository.rotatePlatformSecret())
        const rotated = await run(repository.rotatePlatformSecret())

        const retired = await run(repository.retirePlatformSecret(1))
        expect(retired?.previous.map((entry) => entry.generation)).toEqual([2])

        const attempt = await run(repository.retirePlatformSecret(rotated?.generation ?? 0))
        expect(attempt?.generation).toBe(3)
        expect(attempt?.previous.map((entry) => entry.generation)).toEqual([2])
    })

    it('adopts a higher generation from a peer, keeping its own earlier ones, and never goes back', async () => {
        const repository = await configured()
        const own = await run(repository.ensurePlatformSecret())

        const changed = await run(
            repository.adoptPlatformSecretRing({
                generation: 3,
                value: 'peer-current',
                previous: [{ generation: 2, value: 'peer-two' }],
            })
        )
        expect(changed).toBe(true)
        expect(await run(repository.platformSecretRing())).toEqual({
            generation: 3,
            value: 'peer-current',
            previous: [
                { generation: 2, value: 'peer-two' },
                { generation: 1, value: own },
            ],
        })

        expect(
            await run(
                repository.adoptPlatformSecretRing({ generation: 2, value: 'old', previous: [] })
            )
        ).toBe(false)
        expect((await run(repository.platformSecretRing()))?.generation).toBe(3)
    })

    it('does not resolve two nodes on the same generation with different values: it leaves them as they are', async () => {
        const repository = await configured()
        const own = await run(repository.ensurePlatformSecret())

        const changed = await run(
            repository.adoptPlatformSecretRing({ generation: 1, value: 'someone-elses', previous: [] })
        )

        expect(changed).toBe(false)
        expect((await run(repository.platformSecretRing()))?.value).toBe(own)
    })

    it('a peer cannot overwrite an earlier generation this node already holds', async () => {
        const repository = await configured()
        await run(repository.ensurePlatformSecret())
        const second = await run(repository.rotatePlatformSecret())

        await run(
            repository.adoptPlatformSecretRing({
                generation: 3,
                value: 'peer-current',
                previous: [{ generation: 2, value: 'peer-claims-two-is-this' }],
            })
        )

        const ring = await run(repository.platformSecretRing())
        expect(ring?.previous.find((entry) => entry.generation === 2)?.value).toBe(
            second?.value
        )
    })
})

describe('ClusterNodeRepository', () => {
    it('stores a snapshot, with the join tokens passed explicitly', async () => {
        const repository = makeClusterNodeRepository(database)

        const row = await run(
            repository.upsertFromSnapshot(snapshot(4), {
                worker: 'worker-token-1',
                manager: 'manager-token-1',
            })
        )

        expect(row).toEqual(
            expect.objectContaining({
                clusterId: 'cluster-abc',
                masterTerm: 4,
                joinTokenWorker: 'worker-token-1',
            })
        )
    })

    it('leaves the tokens null when none are passed', async () => {
        const repository = makeClusterNodeRepository(database)

        const row = await run(repository.upsertFromSnapshot(snapshot(4)))

        expect(row.joinTokenWorker).toBeNull()
        expect(row.joinTokenManager).toBeNull()
    })

    it('lets exactly one claimant win a term, and refuses a stale one', async () => {
        const repository = makeClusterNodeRepository(database)
        await run(repository.upsertFromSnapshot(snapshot(4)))

        expect(await run(repository.claimMaster('n2', 4, 'failover'))).toBe(
            true
        )
        expect(await run(repository.claimMaster('n3', 4, 'failover'))).toBe(
            false
        )
        expect(await run(repository.find())).toEqual(
            expect.objectContaining({ masterNodeId: 'n2', masterTerm: 5 })
        )
    })

    it('records election history and refreshes the heartbeat', async () => {
        const repository = makeClusterNodeRepository(database)
        await run(repository.upsertFromSnapshot(snapshot(1)))

        await run(repository.recordMasterHistory('n1', 2, 'failover', 120))
        await run(repository.touchMasterHeartbeat())

        const history = database.client
            .query('SELECT node_id, term FROM cluster_master_history')
            .all()
        expect(history).toEqual([{ node_id: 'n1', term: 2 }])
    })
})

describe('ClusterNodeInventoryRepository', () => {
    const engineNode = (nodeId: string) => ({
        nodeId,
        hostname: `host-${nodeId}`,
        swarmRole: 'worker' as const,
        platformRole: 'worker' as const,
        isLeader: false,
        isIngress: false,
        availability: 'active' as const,
        state: 'ready' as const,
        nanoCpus: null,
        memoryBytes: null,
        labels: {},
    })

    it('upserts nodes and marks the ones missing from a sweep as down', async () => {
        const repository = makeClusterNodeInventoryRepository(database)
        await run(repository.upsertFromEngine(engineNode('a')))
        await run(repository.upsertFromEngine(engineNode('b')))

        expect(await run(repository.markMissingNodeDown(['a']))).toBe(1)

        const states = Object.fromEntries(
            (await run(repository.list())).map((row) => [row.nodeId, row.state])
        )
        expect(states).toEqual({ a: 'active', b: 'down' })
    })

    it('is empty, not an error, when listed before the schema exists', async () => {
        database.client.run('DROP TABLE cluster_nodes')

        expect(
            await run(makeClusterNodeInventoryRepository(database).list())
        ).toEqual([])
    })
})

describe('toEngineNodeRow', () => {
    const node = (status: string, availability: string) => ({
        ID: 'node-1',
        Spec: { Labels: {}, Availability: availability },
        Description: { Hostname: 'node-1' },
        Status: { State: status },
        ManagerStatus: null,
    })

    it("surfaces the engine's own ready state", () => {
        expect(toEngineNodeRow(node('ready', 'active') as never)).toMatchObject(
            { state: 'ready', availability: 'active' }
        )
    })

    it('surfaces an engine-down node instead of assuming it is active', () => {
        expect(toEngineNodeRow(node('down', 'active') as never)).toMatchObject({
            state: 'down',
        })
        expect(toEngineNodeRow(node('unknown', 'active') as never).state).toBe(
            'unknown'
        )
    })

    it('keeps drain availability alongside the engine state', () => {
        expect(toEngineNodeRow(node('ready', 'drain') as never)).toMatchObject({
            state: 'ready',
            availability: 'drain',
        })
    })

    it('persists a ready node as active and an engine-down node as down', async () => {
        const repository = makeClusterNodeInventoryRepository(database)
        const ready = toEngineNodeRow(node('ready', 'active') as never)
        const down = { ...ready, nodeId: 'node-2', state: 'down' as const }

        await run(repository.upsertFromEngine(ready))
        await run(repository.upsertFromEngine(down))

        const states = Object.fromEntries(
            (await run(repository.list())).map((row) => [row.nodeId, row.state])
        )
        expect(states).toEqual({ 'node-1': 'active', 'node-2': 'down' })
    })
})
