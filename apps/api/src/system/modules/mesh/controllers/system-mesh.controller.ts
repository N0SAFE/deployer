import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { meshContract } from "@repo/api-contracts";
import { requireAuth, requireMesh } from "@/core/modules/auth/orpc/middlewares";
import { CoreEventSyncService } from "@/core/modules/events/services/core-event-sync.service";
import { SystemMeshTopologyService } from "@/core/modules/mesh/services/system-mesh-topology/orchestrator/system-mesh-topology.service";
import { SystemMetricsService } from "@/core/modules/system-metrics/services/system-metrics.service";
import { EnvService } from "@/config/env/env.service";
import { NodeConfigRepository } from "@/core/modules/setup/repositories/node-config.repository";
import { signPeerServiceToken } from "@repo/auth/mesh";
import * as crypto from "node:crypto";
import { Client } from "pg";

@Controller()
export class SystemMeshController {
    constructor(
        private readonly meshTopologyService: SystemMeshTopologyService,
        private readonly coreEventSyncService: CoreEventSyncService,
        private readonly systemMetricsService: SystemMetricsService,
        private readonly envService: EnvService,
        private readonly nodeConfigRepository: NodeConfigRepository,
    ) {}

    /**
     * Derive the URL this node advertises to peers from public config.
     * Preference order:
     *   1. `APP_URL` env (canonical — what the operator set in their config)
     *   2. `NEXT_PUBLIC_APP_URL` env (public web URL — used as a last resort)
     *
     * Returns `null` if neither is set or the value is malformed. We
     * intentionally do NOT fall back to a derived internal IP or to
     * any value that could leak the runtime environment.
     */
    private resolveAdvertisedHost(): string | null {
        const candidate = this.envService.get("APP_URL")?.toString().trim()
            ?? this.envService.get("NEXT_PUBLIC_APP_URL")?.toString().trim();
        if (!candidate) {
            return null;
        }
        try {
            const parsed = new URL(candidate);
            // Re-stringify so we drop any userinfo, fragment, default ports, …
            // — only origin is meaningful for "how do I dial you back".
            return parsed.toString();
        } catch {
            return null;
        }
    }

    private resolveOrganizationScope(
        explicitOrganizationId: string | null | undefined,
        context: unknown,
    ): string | null {
        if (typeof explicitOrganizationId === "string" && explicitOrganizationId.length > 0) {
            return explicitOrganizationId;
        }

        const authContext =
            context && typeof context === "object" && "auth" in context
                ? (context as { auth?: { session?: { activeOrganizationId?: unknown } | null } }).auth
                : undefined;

        const activeOrganizationId = authContext?.session?.activeOrganizationId;
        return typeof activeOrganizationId === "string" && activeOrganizationId.length > 0
            ? activeOrganizationId
            : null;
    }

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

    @Implement(meshContract.ping)
    ping() {
        // INTENTIONAL: no `requireAuth()`, no `requireInternalMesh()`.
        //
        // This is the public, unauthenticated reachability endpoint used by:
        //   - The remote setup wizard (ReachabilityService) — must probe
        //     a peer before the local node has any credentials.
        //   - The bootstrap pre-flight (MeshInitializationService.validateRemoteMesh)
        //     — same constraint, happens before enrollment.
        //
        // The response is intentionally minimal: `ok`, the peer's public
        // `version` string, and the URL this node advertises to the world
        // (derived from public APP_URL, not internal IP). All other
        // topology data is gated behind the authenticated `getLocalNode`
        // route below.
        return implement(meshContract.ping).handler(() => {
            const localNode = this.meshTopologyService.getLocalNode();
            const advertisedHost = this.resolveAdvertisedHost();
            return {
                ok: true as const,
                version: localNode.version,
                advertisedHost,
            };
        });
    }

    @Implement(meshContract.getLocalNode)
    getLocalNode() {
        return implement(meshContract.getLocalNode)
            .use(requireMesh())
            .handler(() => {
                return this.meshTopologyService.getLocalNode();
            });
    }

    @Implement(meshContract.getNodeMetrics)
    getNodeMetrics() {
        return implement(meshContract.getNodeMetrics)
            .use(requireMesh())
            .handler(async () => {
                return this.systemMetricsService.getSnapshot();
            });
    }

    @Implement(meshContract.listPeers)
    listPeers() {
        return implement(meshContract.listPeers)
            .use(requireMesh())
            .handler(() => {
                return this.meshTopologyService.listPeers();
            });
    }

    @Implement(meshContract.listPeerSessions)
    listPeerSessions() {
        return implement(meshContract.listPeerSessions)
            .use(requireMesh())
            .handler(() => {
                return this.meshTopologyService.listPeerSessions();
            });
    }

    @Implement(meshContract.listEventStreams)
    listEventStreams() {
        return implement(meshContract.listEventStreams)
            .use(requireMesh())
            .handler(async ({ input }) => {
                return this.coreEventSyncService.listStreams(input.query);
            });
    }

    @Implement(meshContract.findEventStreamById)
    findEventStreamById() {
        return implement(meshContract.findEventStreamById)
            .use(requireMesh())
            .handler(async ({ input }) => {
                return this.coreEventSyncService.getStreamById(input.params.id);
            });
    }

    @Implement(meshContract.subscribeEventStream)
    subscribeEventStream() {
        return implement(meshContract.subscribeEventStream)
            .use(requireMesh())
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
            .use(requireMesh())
            .handler(({ input, context }) => {
                return this.meshTopologyService.planStreamRoute({
                    ...input,
                    organizationId: this.resolveOrganizationScope(input.organizationId, context),
                });
            });
    }

    @Implement(meshContract.connectPeer)
    connectPeer() {
        return implement(meshContract.connectPeer)
            .use(requireMesh())
            .handler(({ input }) => {
                return this.meshTopologyService.connectPeer(input);
            });
    }

    @Implement(meshContract.disconnectPeer)
    disconnectPeer() {
        return implement(meshContract.disconnectPeer)
            .use(requireMesh())
            .handler(({ input }) => {
                return this.meshTopologyService.disconnectPeer(input.params.sessionId, input.body);
            });
    }

    @Implement(meshContract.heartbeatPeer)
    heartbeatPeer() {
        return implement(meshContract.heartbeatPeer)
            .use(requireMesh())
            .handler(({ input }) => {
                return this.meshTopologyService.heartbeatPeer(input.params.sessionId, input.body);
            });
    }

    @Implement(meshContract.membershipSnapshot)
    membershipSnapshot() {
        return implement(meshContract.membershipSnapshot)
            .use(requireMesh())
            .handler(({ context }) => {
                return this.meshTopologyService.getMembershipSnapshot({
                    organizationId: this.resolveOrganizationScope(null, context),
                });
            });
    }

    @Implement(meshContract.reconcileMembership)
    reconcileMembership() {
        return implement(meshContract.reconcileMembership)
            .use(requireMesh())
            .handler(({ input, context }) => {
                return this.meshTopologyService.reconcileMembership({
                    ...input,
                    organizationId: this.resolveOrganizationScope(input.organizationId, context),
                });
            });
    }

    @Implement(meshContract.streamTopology)
    streamTopology() {
        return implement(meshContract.streamTopology)
            .use(requireMesh())
            .handler(({ input, context }) => {
                return this.meshTopologyService.observeTopology({
                    organizationId: this.resolveOrganizationScope(null, context),
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
            .use(requireMesh())
            .handler(({ input, context }) => {
                return this.meshTopologyService.observeRuntimeEvents({
                    organizationId: this.resolveOrganizationScope(null, context),
                    replay: input.query.replay,
                    replayLimit: input.query.replayLimit,
                });
            });
    }

    @Implement(meshContract.publishControlEnvelope)
    publishControlEnvelope() {
        return implement(meshContract.publishControlEnvelope)
            .use(requireMesh())
            .handler(({ input, context }) => {
                return this.meshTopologyService.publishControlEnvelope({
                    ...input,
                    organizationId: this.resolveOrganizationScope(input.organizationId, context),
                });
            });
    }

    @Implement(meshContract.streamSession)
    streamSession() {
        return implement(meshContract.streamSession)
            .use(requireMesh())
            .handler(({ input }) => {
                return this.meshTopologyService.streamSession(input);
            });
    }

    @Implement(meshContract.lookupResource)
    lookupResource() {
        return implement(meshContract.lookupResource)
            .use(requireMesh())
            .handler(({ input, context }) => {
                return this.meshTopologyService.lookupResource({
                    ...input,
                    organizationId: this.resolveOrganizationScope(input.organizationId, context),
                });
            });
    }

    @Implement(meshContract.upsertResourceIndex)
    upsertResourceIndex() {
        return implement(meshContract.upsertResourceIndex)
            .use(requireMesh())
            .handler(({ input, context }) => {
                return this.meshTopologyService.upsertResourceIndex({
                    ...input,
                    organizationId: this.resolveOrganizationScope(input.organizationId, context),
                });
            });
    }

    @Implement(meshContract.planQueuePartition)
    planQueuePartition() {
        return implement(meshContract.planQueuePartition)
            .use(requireMesh())
            .handler(({ input, context }) => {
                return this.meshTopologyService.planQueuePartitionOwnership({
                    ...input,
                    organizationId: this.resolveOrganizationScope(input.organizationId, context),
                });
            });
    }

    @Implement(meshContract.issueJoinGrant)
    issueJoinGrant() {
        return implement(meshContract.issueJoinGrant)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const actor = this.resolveAuthActor(context);
                return this.meshTopologyService.issueJoinGrant({
                    ...input,
                    organizationId: this.resolveOrganizationScope(input.organizationId, context),
                    issuedByUserId: actor.userId ?? "unknown",
                    issuedByRole: actor.role,
                });
            });
    }

    @Implement(meshContract.consumeJoinGrant)
    consumeJoinGrant() {
        return implement(meshContract.consumeJoinGrant)
            .handler(async ({ input }) => {
                const result = await this.meshTopologyService.consumeJoinGrant(input);

                // ── 1. Resolve the shared secret ──────────────────────────
                // Prefer the local DB (dynamic secret set at setup time),
                // fall back to env var for backward compat with pre-migration
                // deployments where the env var is the only source of truth.
                const meshSharedSecret =
                    this.nodeConfigRepository.getMeshSharedSecret()
                    ?? this.envService.get("MESH_STREAM_SHARED_SECRET")?.toString().trim()
                    ?? process.env.MESH_STREAM_SHARED_SECRET?.trim()
                    ?? null;

                if (!meshSharedSecret) {
                    // No shared secret configured — this node cannot issue
                    // peer service tokens. Return the grant result without
                    // a token; the joining node will need to obtain the
                    // secret through an out-of-band channel.
                    return {
                        ...result,
                        peerServiceToken: null,
                        peerServiceTokenExpiresAt: null,
                        meshSharedSecret: null,
                    };
                }

                // ── 2. Issue a peer service token ─────────────────────────
                const issued = signPeerServiceToken(meshSharedSecret, result.nodeId);

                return {
                    ...result,
                    peerServiceToken: issued.token,
                    peerServiceTokenExpiresAt: issued.expiresAt,
                    meshSharedSecret,
                };
            });
    }

    @Implement(meshContract.registerNode)
    registerNode() {
        return implement(meshContract.registerNode)
            .use(requireMesh())
            .handler(async ({ input }) => {
                return this.meshTopologyService.registerNodeInCluster(input);
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

    // ─── Node Configuration ────────────────────────────────────────────────

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
                const updated = this.nodeConfigRepository.upsert({
                    nodeId: input.nodeId ?? this.nodeConfigRepository.find()?.nodeId ?? crypto.randomUUID(),
                    strategy: input.strategy ?? this.nodeConfigRepository.find()?.strategy ?? "local",
                    meshUrlsSnapshot: input.meshUrlsSnapshot ?? this.nodeConfigRepository.find()?.meshUrlsSnapshot ?? [],
                    databaseUrl: input.databaseUrl !== undefined ? input.databaseUrl : (this.nodeConfigRepository.find()?.databaseUrl ?? null),
                    configuredAt: this.nodeConfigRepository.find()?.configuredAt ?? null,
                    updatedAt: now,
                    peerServiceToken: this.nodeConfigRepository.find()?.peerServiceToken ?? null,
                    peerServiceTokenExpiresAt: this.nodeConfigRepository.find()?.peerServiceTokenExpiresAt ?? null,
                    meshSharedSecret: this.nodeConfigRepository.find()?.meshSharedSecret ?? null,
                    meshSharedSecretUpdatedAt: this.nodeConfigRepository.find()?.meshSharedSecretUpdatedAt ?? null,
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
                    // Check if this is a fresh database
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
}
