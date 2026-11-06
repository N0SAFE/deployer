/**
 * NodeStateModule — the API's registration of the node-state repositories.
 *
 * `NodeConfigRepository` and the cluster-node repositories were reachable only by importing the whole
 * `SetupModule` (a feature module that also wires the wizard controller), which closed a cycle:
 *
 *     MeshCoreModule → SetupModule → CoreInitializationModule → SwarmCoreModule
 *                                                              → MeshCoreModule
 *
 * The repositories have no such dependency: they read the LOCAL SQLite database (`node_config`,
 * `cluster_node`, `cluster_nodes`), a file next to the API that exists from the first millisecond of
 * boot, before setup and before the global Postgres. So they live in their own `@Global()` module that
 * anyone can import without pulling in the setup feature: swarm, mesh and setup all consume node state
 * and none of them has to know about each other.
 *
 * The providers ARE the Effect repositories from `@deployer/node-state`, provided under the package's
 * own tags; callers inject the tag and run the Effect they need.
 */
import { Effect } from 'effect'

import {
    createGlobalModule,
    effectHostProvider,
    serviceLifecycle,
} from '@deployer/nest-effect'
import {
    ClusterNodeInventoryRepository,
    ClusterNodeRepository,
    LocalDatabase,
    NodeConfigRepository,
    makeAgentFirstNodeConfigRepository,
    makeClusterNodeInventoryRepository,
    makeClusterNodeRepository,
    platformSecretRingOf,
    type LocalDatabaseShape,
    type NodeConfigRepositoryShape,
} from '@deployer/node-state'

import {
    bindEncryptionRoot,
    legacyRootFrom,
    type SealingRing,
} from '../../../config/drizzle/schema-codecs'
import {
    MeshSecret,
    PlatformSecret,
    type PlatformSecretShape,
} from '../auth/orpc/secrets'
import { LocalDatabaseModule } from '../database/local/local-database.module'

import { agentNodeRecords } from './agent-node-records'
import {
    NodeConfigSnapshot,
    type NodeConfigSnapshotShape,
} from './node-config.snapshot'

const repositories = [
    {
        provide: NodeConfigRepository,
        useFactory: (db: LocalDatabaseShape) =>
            makeAgentFirstNodeConfigRepository(db, agentNodeRecords()),
        inject: [LocalDatabase],
    },
    // The mesh shared secret is THIS node's, generated on its first boot and handed to nodes that join (`node_config`). It is not
    // an environment variable: a missing or unreadable row is "not configured", which the mesh middleware refuses.
    {
        provide: MeshSecret,
        useFactory: (nodeConfig: NodeConfigRepositoryShape) => ({
            get: () =>
                nodeConfig
                    .getMeshSharedSecret()
                    .pipe(Effect.catch(() => Effect.succeed(null))),
        }),
        inject: [NodeConfigRepository],
    },
    // The platform secret is generated here on first use and stored in the same row, so every service of the node signs and
    // verifies with one value. Unconfigured (no row yet) is "no secret", which the system-actor middleware refuses.
    //
    // It is also the root the column codecs seal under: ensured once at boot, then read synchronously from the snapshot (a drizzle
    // codec cannot wait). An upgraded install adopts the root it already used (`legacyRootFrom`) instead of minting one its
    // stored ciphertext does not open under.
    {
        provide: PlatformSecret,
        useFactory: async (
            nodeConfig: NodeConfigRepositoryShape,
            snapshot: NodeConfigSnapshotShape
        ): Promise<PlatformSecretShape> => {
            let ensured: SealingRing | null = null
            const ring = (): Effect.Effect<SealingRing | null> =>
                nodeConfig
                    .ensurePlatformSecret(
                        legacyRootFrom({
                            DEPLOYER_ROOT_SECRET: process.env.DEPLOYER_ROOT_SECRET,
                            AUTH_SECRET: process.env.AUTH_SECRET,
                        })
                    )
                    .pipe(
                        Effect.andThen(nodeConfig.platformSecretRing()),
                        Effect.tap((current) => {
                            ensured = current
                            return Effect.void
                        }),
                        Effect.catch(() => Effect.succeed(null))
                    )
            // The snapshot is the fresher view (it follows a rotation or an adoption within its refresh); what was ensured at boot
            // covers the moment before its first load.
            bindEncryptionRoot(
                () => platformSecretRingOf(snapshot.current()) ?? ensured
            )
            await Effect.runPromise(ring())
            return {
                get: () => Effect.map(ring(), (current) => current?.value ?? null),
                accepted: () =>
                    Effect.map(ring(), (current) =>
                        current === null
                            ? []
                            : [
                                  current.value,
                                  ...current.previous.map((entry) => entry.value),
                              ]
                    ),
            }
        },
        inject: [NodeConfigRepository, NodeConfigSnapshot],
    },
    {
        provide: ClusterNodeRepository,
        useFactory: (db: LocalDatabaseShape) => makeClusterNodeRepository(db),
        inject: [LocalDatabase],
    },
    {
        provide: ClusterNodeInventoryRepository,
        useFactory: (db: LocalDatabaseShape) =>
            makeClusterNodeInventoryRepository(db),
        inject: [LocalDatabase],
    },
    // Synchronous cache of the config row for the seams that cannot do I/O (the pg pool's per-connect
    // URL resolver, the global-db supervisor's synchronous config callbacks).
    NodeConfigSnapshot.provider,
    serviceLifecycle(NodeConfigSnapshot),
    effectHostProvider(),
]

export const NodeStateModule = createGlobalModule({
    imports: [LocalDatabaseModule],
    providers: repositories,
    exports: [
        NodeConfigRepository,
        NodeConfigSnapshot,
        MeshSecret,
        PlatformSecret,
        ClusterNodeRepository,
        ClusterNodeInventoryRepository,
    ],
})
