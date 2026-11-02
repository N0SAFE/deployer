import * as crypto from "node:crypto";

import { Controller, Inject } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { Client } from "pg";

import { runPromiseUnwrapped } from "@deployer/effect-core";
import { meshContract } from "@deployer/fleet-contracts";
import { NodeConfigRepository, type NodeConfigRepositoryShape } from "@deployer/node-state"
import { SystemMetrics, type SystemMetricsShape } from "@deployer/system-metrics";

import { EnvService } from "../../../../config/env/env.module";
import { DEPLOYER_VERSION } from "../../../utils/deployer-version";
import { AllowAnonymous } from "../../auth/decorators/decorators";
import { requireAuth } from "../../auth/orpc/middlewares";
import { CoreEventSyncService } from "../../events/services/core-event-sync.service";





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
        private readonly coreEventSyncService: CoreEventSyncService,
        @Inject(SystemMetrics) private readonly systemMetrics: SystemMetricsShape,
        private readonly envService: EnvService,
        @Inject(NodeConfigRepository) private readonly nodeConfigRepository: NodeConfigRepositoryShape,
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
        };
    }

    private resolveAdvertisedHost(): string | null {
        const appUrl = this.envService.get("APP_URL")?.trim() ?? "";
        const candidate = appUrl.length > 0 ? appUrl : (this.envService.get("NEXT_PUBLIC_APP_URL")?.trim() ?? "");
        if (candidate.length === 0) {
            return null;
        }
        try {
            const parsed = new URL(candidate);
            return parsed.toString();
        } catch {
            return null;
        }
    }

    // ─── PUBLIC: ping (unauthenticated) ───────────────────────────────────

    @Implement(meshContract.ping)
    @AllowAnonymous()
    ping() {
        return implement(meshContract.ping).handler(() => {
            const localNode = this.localNodeInfo();
            return {
                ok: true as const,
                version: localNode.version,
                advertisedHost: this.resolveAdvertisedHost(),
            };
        });
    }

    // ─── PUBLIC: node + peers + sessions (requireAuth) ────────────────────


    @Implement(meshContract.getNodeMetrics)
    getNodeMetrics() {
        return implement(meshContract.getNodeMetrics)
            .use(requireAuth())
            .handler(async () => {
                return runPromiseUnwrapped(this.systemMetrics.snapshot());
            });
    }



    // ─── PUBLIC: streams (requireAuth) ────────────────────────────────────


    @Implement(meshContract.listEventStreams)
    listEventStreams() {
        return implement(meshContract.listEventStreams)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.coreEventSyncService.listStreams(input.query);
            });
    }

    @Implement(meshContract.findEventStreamById)
    findEventStreamById() {
        return implement(meshContract.findEventStreamById)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.coreEventSyncService.getStreamById(input.params.id);
            });
    }

    @Implement(meshContract.subscribeEventStream)
    subscribeEventStream() {
        return implement(meshContract.subscribeEventStream)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.coreEventSyncService.streamSync({
                    id: input.params.id,
                    replay: input.query.replay,
                    replayLimit: input.query.replayLimit,
                });
            });
    }


    // ─── PUBLIC: resources (requireAuth) ──────────────────────────────────


    // ─── PUBLIC: enrollment grants (requireAuth — admin actor) ────────────



    // ─── PUBLIC: trust keyring + strict mode (requireAuth) ────────────────









    // ─── PUBLIC: node configuration (requireAuth) ─────────────────────────

    @Implement(meshContract.getNodeConfig)
    getNodeConfig() {
        return implement(meshContract.getNodeConfig)
            .use(requireAuth())
            .handler(async () => {
                const row = await runPromiseUnwrapped(this.nodeConfigRepository.find());
                const localNode = this.localNodeInfo();

                return {
                    nodeId: row?.nodeId ?? localNode.nodeId,
                    strategy: (row?.strategy ?? "local"),
                    meshUrlsSnapshot: row?.meshUrlsSnapshot ?? [],
                    databaseUrl: row?.databaseUrl ?? null,
                    configuredAt: row?.configuredAt ?? null,
                    updatedAt: row?.updatedAt ?? new Date().toISOString(),
                    meshSharedSecretUpdatedAt: row?.meshSharedSecretUpdatedAt ?? null,
                    region: localNode.region,
                    zone: localNode.zone,
                    roles: localNode.roles ?? null,
                    version: localNode.version ?? null,
                    routingMode: localNode.routingMode ?? null,
                    consistencyMode: localNode.consistencyMode ?? null,
                    lifecycleState: localNode.lifecycleState ?? null,
                    startedAt: localNode.startedAt ?? null,
                    lastSeenAt: localNode.lastSeenAt ?? null,
                };
            });
    }

    @Implement(meshContract.updateNodeConfig)
    updateNodeConfig() {
        return implement(meshContract.updateNodeConfig)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const now = new Date().toISOString();
                const existing = await runPromiseUnwrapped(this.nodeConfigRepository.find());
                const updated = await runPromiseUnwrapped(this.nodeConfigRepository.upsert({
                    nodeId: input.nodeId ?? existing?.nodeId ?? crypto.randomUUID(),
                    strategy: input.strategy ?? existing?.strategy ?? "local",
                    meshUrlsSnapshot: input.meshUrlsSnapshot ?? existing?.meshUrlsSnapshot ?? [],
                    databaseUrl: input.databaseUrl !== undefined ? input.databaseUrl : (existing?.databaseUrl ?? null),
                    databaseProvisioning: existing?.databaseProvisioning ?? null,
                    configuredAt: existing?.configuredAt ?? null,
                    updatedAt: now,
                    peerServiceToken: existing?.peerServiceToken ?? null,
                    peerServiceTokenExpiresAt: existing?.peerServiceTokenExpiresAt ?? null,
                    meshSharedSecret: existing?.meshSharedSecret ?? null,
                    meshSharedSecretUpdatedAt: existing?.meshSharedSecretUpdatedAt ?? null,
                }));

                const localNode = this.localNodeInfo();

                return {
                    success: true,
                    config: {
                        nodeId: updated.nodeId,
                        strategy: updated.strategy,
                        meshUrlsSnapshot: updated.meshUrlsSnapshot ?? [],
                        databaseUrl: updated.databaseUrl ?? null,
                        configuredAt: updated.configuredAt ?? null,
                        updatedAt: updated.updatedAt,
                        meshSharedSecretUpdatedAt: updated.meshSharedSecretUpdatedAt ?? null,
                        region: localNode.region ?? null,
                        zone: localNode.zone ?? null,
                        roles: localNode.roles ?? null,
                        version: localNode.version ?? null,
                        routingMode: localNode.routingMode ?? null,
                        consistencyMode: localNode.consistencyMode ?? null,
                        lifecycleState: localNode.lifecycleState ?? null,
                        startedAt: localNode.startedAt ?? null,
                        lastSeenAt: localNode.lastSeenAt ?? null,
                    },
                };
            });
    }

    @Implement(meshContract.regenerateNodeConfigSecret)
    regenerateNodeConfigSecret() {
        return implement(meshContract.regenerateNodeConfigSecret)
            .use(requireAuth())
            .handler(async () => {
                const newSecret = crypto.randomBytes(32).toString("hex");
                const now = new Date().toISOString();
                const existing = await runPromiseUnwrapped(this.nodeConfigRepository.find());

                await runPromiseUnwrapped(this.nodeConfigRepository.upsert({
                    nodeId: existing?.nodeId ?? crypto.randomUUID(),
                    strategy: existing?.strategy ?? "local",
                    meshUrlsSnapshot: existing?.meshUrlsSnapshot ?? [],
                    databaseUrl: existing?.databaseUrl ?? null,
                    databaseProvisioning: existing?.databaseProvisioning ?? null,
                    configuredAt: existing?.configuredAt ?? null,
                    updatedAt: now,
                    peerServiceToken: existing?.peerServiceToken ?? null,
                    peerServiceTokenExpiresAt: existing?.peerServiceTokenExpiresAt ?? null,
                    meshSharedSecret: newSecret,
                    meshSharedSecretUpdatedAt: now,
                }));

                return {
                    success: true,
                    meshSharedSecret: newSecret,
                    rotatedAt: now,
                };
            });
    }

    @Implement(meshContract.testNodeConfigDb)
    testNodeConfigDb() {
        return implement(meshContract.testNodeConfigDb)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const client = new Client({
                    connectionString: input.databaseUrl,
                    connectionTimeoutMillis: 5_000,
                });

                try {
                    await client.connect();
                    const result = await client.query<{ exists: boolean }>(
                        `SELECT EXISTS (
                            SELECT 1 FROM information_schema.tables
                            WHERE table_schema = 'public' AND table_name = 'user'
                        ) AS exists`,
                    );
                    const tableExists = result.rows[0]?.exists ?? false;
                    if (!tableExists) {
                        return { connected: true, isNewDatabase: true, error: null };
                    }
                    const countResult = await client.query<{ count: string }>(
                        `SELECT COUNT(*) FROM "user" LIMIT 1`,
                    );
                    const userCount = parseInt(countResult.rows[0]?.count ?? "0", 10);
                    return {
                        connected: true,
                        isNewDatabase: userCount === 0,
                        error: null,
                    };
                } catch (error) {
                    const message = error instanceof Error ? error.message : "Unknown connection error";
                    return { connected: false, isNewDatabase: null, error: message };
                } finally {
                    await client.end().catch(() => undefined);
                }
            });
    }

    // ========================================================================
    // PRIVATE — mesh-to-mesh transport (requireMesh)
    // ========================================================================

    // Heartbeat is a mesh-to-mesh transport op. It stays on the public
    // contract (the web client's endpoints.ts declares it) but is guarded
    // with requireMesh() because only peers should be able to heartbeat.






}
