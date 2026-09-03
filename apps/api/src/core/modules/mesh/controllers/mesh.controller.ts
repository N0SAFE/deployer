import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { meshContract, meshInternalContract } from "@repo/api-contracts";
import type { MeshDuplexStreamOutput } from "@repo/contracts-entities";
import { Observable } from "rxjs";
import { observableToAsyncIterable, asyncIterableToObservable } from "@/core/utils/observable.utils";
import { requireAuth, requireMesh } from "@/core/modules/auth/orpc/middlewares";
import { AllowAnonymous } from "@/core/modules/auth/decorators/decorators";
import { CoreEventSyncService } from "@/core/modules/events/services/core-event-sync.service";
import { SystemMeshTopologyService } from "@/core/modules/mesh/services/system-mesh-topology/orchestrator/system-mesh-topology.service";
import { SystemMetricsService } from "@/core/modules/system-metrics/services/system-metrics.service";
import { EnvService } from "@/config/env/env.service";
import { NodeConfigRepository } from "@/core/modules/setup/repositories/node-config.repository";
import { signPeerServiceToken } from "@repo/auth/mesh";
import * as crypto from "node:crypto";
import { Client } from "pg";

/**
 * Mesh Controller — serves the mesh control-plane.
 *
 * Two surfaces:
 *  - `meshContract` (PUBLIC): information + management for authenticated
 *    dashboard users (peers, sessions, trust, node config, streams). All
 *    handlers use `requireAuth()` (a logged-in user session).
 *  - `meshInternalContract` (PRIVATE): mesh-to-mesh transport endpoints
 *    that may ONLY be called inside the mesh. All handlers use
 *    `requireMesh()` (peer service token / internal key).
 *
 * The catch-all resource dispatcher (`POST /mesh/:entityKey/:methodName`) is
 * implemented separately by `MeshResourceController`.
 */
@Controller()
export class MeshController {
    constructor(
        private readonly meshTopologyService: SystemMeshTopologyService,
        private readonly coreEventSyncService: CoreEventSyncService,
        private readonly systemMetricsService: SystemMetricsService,
        private readonly envService: EnvService,
        private readonly nodeConfigRepository: NodeConfigRepository,
    ) {}

    // ─── Auth context helpers ──────────────────────────────────────────────


    private resolveAuthActor(context: unknown): { userId: string | null; role: string | null } {
        const authContext =
            context && typeof context === "object" && "auth" in context
                ? (context as { auth?: { user?: { id?: unknown; role?: unknown } | null } }).auth
                : undefined;

        const userId = authContext?.user?.id;
        const role = authContext?.user?.role;

        return {
            userId: typeof userId === "string" && userId.length > 0 ? userId : null,
            role: typeof role === "string" && role.length > 0 ? role : null,
        };
    }

    private resolveAdvertisedHost(): string | null {
        const candidate = this.envService.get("APP_URL")?.toString().trim()
            ?? this.envService.get("NEXT_PUBLIC_APP_URL")?.toString().trim();
        if (!candidate) {
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
            const localNode = this.meshTopologyService.getLocalNode();
            return {
                ok: true as const,
                version: localNode.version,
                advertisedHost: this.resolveAdvertisedHost(),
            };
        });
    }

    // ─── PUBLIC: node + peers + sessions (requireAuth) ────────────────────

    @Implement(meshContract.getLocalNode)
    getLocalNode() {
        return implement(meshContract.getLocalNode)
            .use(requireAuth())
            .handler(() => {
                return this.meshTopologyService.getLocalNode();
            });
    }

    @Implement(meshContract.getNodeMetrics)
    getNodeMetrics() {
        return implement(meshContract.getNodeMetrics)
            .use(requireAuth())
            .handler(async () => {
                return this.systemMetricsService.getSnapshot();
            });
    }

    @Implement(meshContract.listPeers)
    listPeers() {
        return implement(meshContract.listPeers)
            .use(requireAuth())
            .handler(() => {
                return this.meshTopologyService.listPeers();
            });
    }

    @Implement(meshContract.listPeerSessions)
    listPeerSessions() {
        return implement(meshContract.listPeerSessions)
            .use(requireAuth())
            .handler(() => {
                return this.meshTopologyService.listPeerSessions();
            });
    }

    @Implement(meshContract.connectPeer)
    connectPeer() {
        return implement(meshContract.connectPeer)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.meshTopologyService.connectPeer(input);
            });
    }

    @Implement(meshContract.disconnectPeer)
    disconnectPeer() {
        return implement(meshContract.disconnectPeer)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.meshTopologyService.disconnectPeer(input.params.sessionId, input.body);
            });
    }

    @Implement(meshContract.membershipSnapshot)
    membershipSnapshot() {
        return implement(meshContract.membershipSnapshot)
            .use(requireAuth())
            .handler(({ context }) => {
                return this.meshTopologyService.getMembershipSnapshot();
            });
    }

    @Implement(meshContract.reconcileMembership)
    reconcileMembership() {
        return implement(meshContract.reconcileMembership)
            .use(requireAuth())
            .handler(({ input, context }) => {
                return this.meshTopologyService.reconcileMembership({
                    ...input,
                });
            });
    }

    // ─── PUBLIC: streams (requireAuth) ────────────────────────────────────

    @Implement(meshContract.streamTopology)
    streamTopology() {
        return implement(meshContract.streamTopology)
            .use(requireAuth())
            .handler(({ input, context }) => {
                return this.meshTopologyService.observeTopology({
                    replay: input.query.replay,
                    replayLimit: input.query.replayLimit,
                    includeEdges: input.query.includeEdges,
                    includeNodes: input.query.includeNodes,
                });
            });
    }

    @Implement(meshContract.streamEvents)
    streamEvents() {
        return implement(meshContract.streamEvents)
            .use(requireAuth())
            .handler(({ input, context }) => {
                return this.meshTopologyService.observeRuntimeEvents({
                    replay: input.query.replay,
                    replayLimit: input.query.replayLimit,
                });
            });
    }

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

    @Implement(meshContract.planStreamRoute)
    planStreamRoute() {
        return implement(meshContract.planStreamRoute)
            .use(requireAuth())
            .handler(({ input, context }) => {
                return this.meshTopologyService.planStreamRoute({
                    ...input,
                });
            });
    }

    // ─── PUBLIC: resources (requireAuth) ──────────────────────────────────

    @Implement(meshContract.lookupResource)
    lookupResource() {
        return implement(meshContract.lookupResource)
            .use(requireAuth())
            .handler(({ input, context }) => {
                return this.meshTopologyService.lookupResource({
                    ...input,
                });
            });
    }

    @Implement(meshContract.upsertResourceIndex)
    upsertResourceIndex() {
        return implement(meshContract.upsertResourceIndex)
            .use(requireAuth())
            .handler(({ input, context }) => {
                return this.meshTopologyService.upsertResourceIndex({
                    ...input,
                });
            });
    }

    // ─── PUBLIC: enrollment grants (requireAuth — admin actor) ────────────

    @Implement(meshContract.issueJoinGrant)
    issueJoinGrant() {
        return implement(meshContract.issueJoinGrant)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const actor = this.resolveAuthActor(context);
                return this.meshTopologyService.issueJoinGrant({
                    ...input,
                    issuedByUserId: actor.userId ?? "unknown",
                    issuedByRole: actor.role,
                });
            });
    }

    @Implement(meshContract.revokeJoinGrant)
    revokeJoinGrant() {
        return implement(meshContract.revokeJoinGrant)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const actor = this.resolveAuthActor(context);
                return this.meshTopologyService.revokeJoinGrant({
                    ...input,
                    revokedByUserId: actor.userId ?? "unknown",
                    revokedByRole: actor.role,
                });
            });
    }

    // ─── PUBLIC: trust keyring + strict mode (requireAuth) ────────────────

    @Implement(meshContract.trustKeyringStatus)
    trustKeyringStatus() {
        return implement(meshContract.trustKeyringStatus)
            .use(requireAuth())
            .handler(() => {
                return this.meshTopologyService.getTrustKeyringStatus();
            });
    }

    @Implement(meshContract.trustKeyringSecrets)
    trustKeyringSecrets() {
        return implement(meshContract.trustKeyringSecrets)
            .use(requireAuth())
            .handler(() => {
                return this.meshTopologyService.getTrustKeyringSecrets();
            });
    }

    @Implement(meshContract.trustKeyringRotate)
    trustKeyringRotate() {
        return implement(meshContract.trustKeyringRotate)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const actor = this.resolveAuthActor(context);
                return this.meshTopologyService.rotateTrustKey({
                    ...input,
                    rotatedByRole: actor.role,
                });
            });
    }

    @Implement(meshContract.trustKeyringConvergenceStatus)
    trustKeyringConvergenceStatus() {
        return implement(meshContract.trustKeyringConvergenceStatus)
            .use(requireAuth())
            .handler(() => {
                return this.meshTopologyService.getTrustKeyringConvergenceStatus();
            });
    }

    @Implement(meshContract.trustStrictReadiness)
    trustStrictReadiness() {
        return implement(meshContract.trustStrictReadiness)
            .use(requireAuth())
            .handler(() => {
                return this.meshTopologyService.getTrustStrictReadiness();
            });
    }

    @Implement(meshContract.trustStrictModeSet)
    trustStrictModeSet() {
        return implement(meshContract.trustStrictModeSet)
            .use(requireAuth())
            .handler(({ input, context }) => {
                const actor = this.resolveAuthActor(context);
                return this.meshTopologyService.setTrustStrictMode({
                    ...input,
                    setByRole: actor.role,
                });
            });
    }

    @Implement(meshContract.trustStrictRolloutPlan)
    trustStrictRolloutPlan() {
        return implement(meshContract.trustStrictRolloutPlan)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.meshTopologyService.getTrustStrictRolloutPlan({
                    waveSize: input.query?.waveSize,
                });
            });
    }

    @Implement(meshContract.trustStrictRollback)
    trustStrictRollback() {
        return implement(meshContract.trustStrictRollback)
            .use(requireAuth())
            .handler(({ input, context }) => {
                const actor = this.resolveAuthActor(context);
                return this.meshTopologyService.rollbackTrustStrictMode({
                    ...input,
                    setByRole: actor.role,
                });
            });
    }

    // ─── PUBLIC: node configuration (requireAuth) ─────────────────────────

    @Implement(meshContract.getNodeConfig)
    getNodeConfig() {
        return implement(meshContract.getNodeConfig)
            .use(requireAuth())
            .handler(() => {
                const row = this.nodeConfigRepository.find();
                const localNode = this.meshTopologyService.getLocalNode();

                return {
                    nodeId: row?.nodeId ?? localNode.nodeId,
                    strategy: (row?.strategy ?? "local") as "local" | "remote",
                    meshUrlsSnapshot: row?.meshUrlsSnapshot ?? [],
                    databaseUrl: row?.databaseUrl ?? null,
                    configuredAt: row?.configuredAt ?? null,
                    updatedAt: row?.updatedAt ?? new Date().toISOString(),
                    meshSharedSecretUpdatedAt: row?.meshSharedSecretUpdatedAt ?? null,
                    region: localNode.region ?? null,
                    zone: localNode.zone ?? null,
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
            .handler(({ input }) => {
                const now = new Date().toISOString();
                const existing = this.nodeConfigRepository.find();
                const updated = this.nodeConfigRepository.upsert({
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
                });

                const localNode = this.meshTopologyService.getLocalNode();

                return {
                    success: true,
                    config: {
                        nodeId: updated.nodeId,
                        strategy: updated.strategy as "local" | "remote",
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
            .handler(() => {
                const newSecret = crypto.randomBytes(32).toString("hex");
                const now = new Date().toISOString();
                const existing = this.nodeConfigRepository.find();

                this.nodeConfigRepository.upsert({
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
                });

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
    @Implement(meshContract.heartbeatPeer)
    heartbeatPeer() {
        return implement(meshContract.heartbeatPeer)
            .use(requireMesh())
            .handler(({ input }) => {
                return this.meshTopologyService.heartbeatPeer(input.params.sessionId, input.body);
            });
    }

    @Implement(meshInternalContract.publishControlEnvelope)
    publishControlEnvelope() {
        return implement(meshInternalContract.publishControlEnvelope)
            .use(requireMesh())
            .handler(({ input, context }) => {
                return this.meshTopologyService.publishControlEnvelope({
                    ...input,
                });
            });
    }

    @Implement(meshInternalContract.streamSession)
    streamSession() {
        return implement(meshInternalContract.streamSession)
            .use(requireMesh())
            .handler((({ input }) => {
                // ORPC delivers the duplex body as an Observable; the
                // topology service expects an AsyncIterable. Convert.
                const inputIterable =
                    input instanceof Observable
                        ? observableToAsyncIterable(input as never)
                        : input;
                // The service returns an AsyncIterable; ORPC expects an
                // Observable body, so convert the result back, pinning the
                // element type to the contract's duplex output schema.
                return asyncIterableToObservable<MeshDuplexStreamOutput>(
                    this.meshTopologyService.streamSession(inputIterable as never),
                );
            }) as never);
    }

    @Implement(meshInternalContract.planQueuePartition)
    planQueuePartition() {
        return implement(meshInternalContract.planQueuePartition)
            .use(requireMesh())
            .handler(({ input, context }) => {
                return this.meshTopologyService.planQueuePartitionOwnership({
                    ...input,
                });
            });
    }

    @Implement(meshInternalContract.registerNode)
    registerNode() {
        return implement(meshInternalContract.registerNode)
            .use(requireMesh())
            .handler(async ({ input }) => {
                return this.meshTopologyService.registerNodeInCluster(input);
            });
    }

    @Implement(meshInternalContract.consumeJoinGrant)
    @AllowAnonymous()
    consumeJoinGrant() {
        return implement(meshInternalContract.consumeJoinGrant)
            .handler(async ({ input }) => {
                const result = await this.meshTopologyService.consumeJoinGrant(input);

                const meshSharedSecret =
                    this.nodeConfigRepository.getMeshSharedSecret()
                    ?? this.envService.get("MESH_STREAM_SHARED_SECRET")?.toString().trim()
                    ?? process.env.MESH_STREAM_SHARED_SECRET?.trim()
                    ?? null;

                if (!meshSharedSecret) {
                    return {
                        ...result,
                        peerServiceToken: null,
                        peerServiceTokenExpiresAt: null,
                        meshSharedSecret: null,
                    };
                }

                const issued = signPeerServiceToken(meshSharedSecret, result.nodeId);

                return {
                    ...result,
                    peerServiceToken: issued.token,
                    peerServiceTokenExpiresAt: issued.expiresAt,
                    meshSharedSecret,
                };
            });
    }
}
