import * as crypto from 'node:crypto'

import { Controller, Inject } from '@nestjs/common'
import { Implement } from '@orpc/nest'
import { Client } from 'pg'

import { runPromiseUnwrapped } from '@deployer/effect-core'
import { meshContract } from '@deployer/fleet-contracts'
import { procedure } from '@deployer/nest-effect'
import {
    NodeConfigRepository,
    type NodeConfigRepositoryShape,
} from '@deployer/node-state'
import {
    SystemMetrics,
    type SystemMetricsShape,
} from '@deployer/system-metrics'

import { EnvService } from '../../../../config/env/env.module'
import { DEPLOYER_VERSION } from '../../../utils/deployer-version'
import { requireAuth } from '../../auth/orpc/middlewares'
import {
    CoreEventSyncService,
    type CoreEventSyncServiceShape,
} from '../../events/services/core-event-sync.service'

/**
 * Mesh Controller — what is left of the old mesh control plane: the ping, the node's metrics, the event streams and the
 * node configuration. The nodes, replicas and join tokens are served by fleet's `MeshViewController`, and a joining
 * node is enrolled by its `EnrollmentController`. All handlers but the ping use `requireAuth()`.
 *
 * The catch-all resource dispatcher (`POST /mesh/:entityKey/:methodName`) is
 * implemented separately by `MeshResourceController`.
 */
@Controller()
export class MeshController {
    constructor(
        @Inject(CoreEventSyncService)
        private readonly coreEventSyncService: CoreEventSyncServiceShape,
        @Inject(SystemMetrics)
        private readonly systemMetrics: SystemMetricsShape,
        private readonly envService: EnvService,
        @Inject(NodeConfigRepository)
        private readonly nodeConfigRepository: NodeConfigRepositoryShape
    ) {}

    /**
     * What this node says about itself. The platform measures nothing else: the version is the build's, and the node's
     * id is the one setup persisted (an unconfigured node has none, so it gets a throwaway one for this answer).
     */
    private localNodeInfo() {
        return {
            nodeId: crypto.randomUUID(),
            version: DEPLOYER_VERSION,
            region: null,
            zone: null,
            roles: null,
            routingMode: null,
            consistencyMode: null,
            lifecycleState: null,
            startedAt: null,
            lastSeenAt: null,
        }
    }

    /** A key `EnvService` types as `string` but answers `undefined` for when unset at runtime. */
    private optionalEnv(
        key: 'APP_URL' | 'NEXT_PUBLIC_APP_URL'
    ): string | undefined {
        return this.envService.get(key)
    }

    private resolveAdvertisedHost(): string | null {
        const appUrl = this.optionalEnv('APP_URL')?.trim() ?? ''
        const candidate =
            appUrl.length > 0
                ? appUrl
                : (this.optionalEnv('NEXT_PUBLIC_APP_URL')?.trim() ?? '')
        if (candidate.length === 0) {
            return null
        }
        try {
            const parsed = new URL(candidate)
            return parsed.toString()
        } catch {
            return null
        }
    }

    // ─── PUBLIC: ping (unauthenticated) ───────────────────────────────────

    @Implement(meshContract.ping)
    ping() {
        return procedure(meshContract.ping).handler(() => {
            const localNode = this.localNodeInfo()
            return {
                ok: true as const,
                version: localNode.version,
                advertisedHost: this.resolveAdvertisedHost(),
            }
        })
    }

    // ─── PUBLIC: node + peers + sessions (requireAuth) ────────────────────

    @Implement(meshContract.getNodeMetrics)
    getNodeMetrics() {
        return procedure(meshContract.getNodeMetrics)
            .use(requireAuth())
            .handler(async () => {
                return runPromiseUnwrapped(this.systemMetrics.snapshot())
            })
    }

    // ─── PUBLIC: streams (requireAuth) ────────────────────────────────────

    @Implement(meshContract.listEventStreams)
    listEventStreams() {
        return procedure(meshContract.listEventStreams)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const sync = yield* CoreEventSyncService
                return yield* sync.listStreams(input.query)
            })
    }

    @Implement(meshContract.findEventStreamById)
    findEventStreamById() {
        return procedure(meshContract.findEventStreamById)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const sync = yield* CoreEventSyncService
                return yield* sync.getStreamById(input.params.id)
            })
    }

    @Implement(meshContract.subscribeEventStream)
    subscribeEventStream() {
        return procedure(meshContract.subscribeEventStream)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.coreEventSyncService.streamSync({
                    id: input.params.id,
                    replay: input.query.replay,
                    replayLimit: input.query.replayLimit,
                })
            })
    }

    // ─── PUBLIC: resources (requireAuth) ──────────────────────────────────

    // ─── PUBLIC: enrollment grants (requireAuth — admin actor) ────────────

    // ─── PUBLIC: trust keyring + strict mode (requireAuth) ────────────────

    // ─── PUBLIC: node configuration (requireAuth) ─────────────────────────

    @Implement(meshContract.getNodeConfig)
    getNodeConfig() {
        return procedure(meshContract.getNodeConfig)
            .use(requireAuth())
            .handler(async () => {
                const row = await runPromiseUnwrapped(
                    this.nodeConfigRepository.find()
                )
                const localNode = this.localNodeInfo()

                return {
                    nodeId: row?.nodeId ?? localNode.nodeId,
                    strategy: row?.strategy ?? 'local',
                    meshUrlsSnapshot: row?.meshUrlsSnapshot ?? [],
                    databaseUrl: row?.databaseUrl ?? null,
                    configuredAt: row?.configuredAt ?? null,
                    updatedAt: row?.updatedAt ?? new Date().toISOString(),
                    meshSharedSecretUpdatedAt:
                        row?.meshSharedSecretUpdatedAt ?? null,
                    region: localNode.region,
                    zone: localNode.zone,
                    roles: localNode.roles,
                    version: localNode.version,
                    routingMode: localNode.routingMode,
                    consistencyMode: localNode.consistencyMode,
                    lifecycleState: localNode.lifecycleState,
                    startedAt: localNode.startedAt,
                    lastSeenAt: localNode.lastSeenAt,
                }
            })
    }

    @Implement(meshContract.updateNodeConfig)
    updateNodeConfig() {
        return procedure(meshContract.updateNodeConfig)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const now = new Date().toISOString()
                const existing = await runPromiseUnwrapped(
                    this.nodeConfigRepository.find()
                )
                const updated = await runPromiseUnwrapped(
                    this.nodeConfigRepository.upsert({
                        nodeId:
                            input.nodeId ??
                            existing?.nodeId ??
                            crypto.randomUUID(),
                        strategy:
                            input.strategy ?? existing?.strategy ?? 'local',
                        meshUrlsSnapshot:
                            input.meshUrlsSnapshot ??
                            existing?.meshUrlsSnapshot ??
                            [],
                        databaseUrl:
                            input.databaseUrl !== undefined
                                ? input.databaseUrl
                                : (existing?.databaseUrl ?? null),
                        databaseProvisioning:
                            existing?.databaseProvisioning ?? null,
                        configuredAt: existing?.configuredAt ?? null,
                        updatedAt: now,
                        peerServiceToken: existing?.peerServiceToken ?? null,
                        peerServiceTokenExpiresAt:
                            existing?.peerServiceTokenExpiresAt ?? null,
                        meshSharedSecret: existing?.meshSharedSecret ?? null,
                        meshSharedSecretUpdatedAt:
                            existing?.meshSharedSecretUpdatedAt ?? null,
                    })
                )

                const localNode = this.localNodeInfo()

                return {
                    success: true,
                    config: {
                        nodeId: updated.nodeId,
                        strategy: updated.strategy,
                        meshUrlsSnapshot: updated.meshUrlsSnapshot ?? [],
                        databaseUrl: updated.databaseUrl,
                        configuredAt: updated.configuredAt,
                        updatedAt: updated.updatedAt,
                        meshSharedSecretUpdatedAt:
                            updated.meshSharedSecretUpdatedAt,
                        region: localNode.region,
                        zone: localNode.zone,
                        roles: localNode.roles,
                        version: localNode.version,
                        routingMode: localNode.routingMode,
                        consistencyMode: localNode.consistencyMode,
                        lifecycleState: localNode.lifecycleState,
                        startedAt: localNode.startedAt,
                        lastSeenAt: localNode.lastSeenAt,
                    },
                }
            })
    }

    @Implement(meshContract.regenerateNodeConfigSecret)
    regenerateNodeConfigSecret() {
        return procedure(meshContract.regenerateNodeConfigSecret)
            .use(requireAuth())
            .handler(async () => {
                const newSecret = crypto.randomBytes(32).toString('hex')
                const now = new Date().toISOString()
                const existing = await runPromiseUnwrapped(
                    this.nodeConfigRepository.find()
                )

                await runPromiseUnwrapped(
                    this.nodeConfigRepository.upsert({
                        nodeId: existing?.nodeId ?? crypto.randomUUID(),
                        strategy: existing?.strategy ?? 'local',
                        meshUrlsSnapshot: existing?.meshUrlsSnapshot ?? [],
                        databaseUrl: existing?.databaseUrl ?? null,
                        databaseProvisioning:
                            existing?.databaseProvisioning ?? null,
                        configuredAt: existing?.configuredAt ?? null,
                        updatedAt: now,
                        peerServiceToken: existing?.peerServiceToken ?? null,
                        peerServiceTokenExpiresAt:
                            existing?.peerServiceTokenExpiresAt ?? null,
                        meshSharedSecret: newSecret,
                        meshSharedSecretUpdatedAt: now,
                    })
                )

                return {
                    success: true,
                    meshSharedSecret: newSecret,
                    rotatedAt: now,
                }
            })
    }

    @Implement(meshContract.testNodeConfigDb)
    testNodeConfigDb() {
        return procedure(meshContract.testNodeConfigDb)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const client = new Client({
                    connectionString: input.databaseUrl,
                    connectionTimeoutMillis: 5_000,
                })

                try {
                    await client.connect()
                    const result = await client.query<{ exists: boolean }>(
                        `SELECT EXISTS (
                            SELECT 1 FROM information_schema.tables
                            WHERE table_schema = 'public' AND table_name = 'user'
                        ) AS exists`
                    )
                    const tableExists = result.rows[0]?.exists ?? false
                    if (!tableExists) {
                        return {
                            connected: true,
                            isNewDatabase: true,
                            error: null,
                        }
                    }
                    const countResult = await client.query<{ count: string }>(
                        `SELECT COUNT(*) FROM "user" LIMIT 1`
                    )
                    const userCount = parseInt(
                        countResult.rows[0]?.count ?? '0',
                        10
                    )
                    return {
                        connected: true,
                        isNewDatabase: userCount === 0,
                        error: null,
                    }
                } catch (error) {
                    const message =
                        error instanceof Error
                            ? error.message
                            : 'Unknown connection error'
                    return {
                        connected: false,
                        isNewDatabase: null,
                        error: message,
                    }
                } finally {
                    await client.end().catch(() => undefined)
                }
            })
    }

    // ========================================================================
    // PRIVATE — mesh-to-mesh transport (requireMesh)
    // ========================================================================

    // Heartbeat is a mesh-to-mesh transport op. It stays on the public
    // contract (the web client's endpoints.ts declares it) but is guarded
    // with requireMesh() because only peers should be able to heartbeat.
}
