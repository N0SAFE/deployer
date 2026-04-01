import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { appContract } from "@repo/api-contracts";
import { requireAuth, requireInternalMesh } from "@/core/modules/auth/orpc/middlewares";
import { CoreEventSyncService } from "@/core/modules/events/services/core-event-sync.service";
import { SystemMeshTopologyService } from "@/core/modules/mesh/services/system-mesh-topology.service";
import { SystemMetricsService } from "@/core/modules/system-metrics/services/system-metrics.service";

@Controller()
export class SystemMeshController {
    constructor(
        private readonly meshTopologyService: SystemMeshTopologyService,
        private readonly coreEventSyncService: CoreEventSyncService,
        private readonly systemMetricsService: SystemMetricsService,
    ) {}

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

    @Implement(appContract.core.mesh.getLocalNode)
    getLocalNode() {
        return implement(appContract.core.mesh.getLocalNode)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(() => {
                return this.meshTopologyService.getLocalNode();
            });
    }

    @Implement(appContract.core.mesh.getNodeMetrics)
    getNodeMetrics() {
        return implement(appContract.core.mesh.getNodeMetrics)
            .use(requireInternalMesh())
            .handler(async () => {
                return this.systemMetricsService.getSnapshot();
            });
    }

    @Implement(appContract.core.mesh.listPeers)
    listPeers() {
        return implement(appContract.core.mesh.listPeers)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(() => {
                return this.meshTopologyService.listPeers();
            });
    }

    @Implement(appContract.core.mesh.listPeerSessions)
    listPeerSessions() {
        return implement(appContract.core.mesh.listPeerSessions)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(() => {
                return this.meshTopologyService.listPeerSessions();
            });
    }

    @Implement(appContract.core.mesh.listEventStreams)
    listEventStreams() {
        return implement(appContract.core.mesh.listEventStreams)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(async ({ input }) => {
                return this.coreEventSyncService.listStreams(input.query);
            });
    }

    @Implement(appContract.core.mesh.findEventStreamById)
    findEventStreamById() {
        return implement(appContract.core.mesh.findEventStreamById)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(async ({ input }) => {
                return this.coreEventSyncService.getStreamById(input.params.id);
            });
    }

    @Implement(appContract.core.mesh.subscribeEventStream)
    subscribeEventStream() {
        return implement(appContract.core.mesh.subscribeEventStream)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(({ input }) => {
                return this.coreEventSyncService.streamSync({
                    id: input.params.id,
                    replay: input.query.replay,
                    replayLimit: input.query.replayLimit,
                });
            });
    }

    @Implement(appContract.core.mesh.planStreamRoute)
    planStreamRoute() {
        return implement(appContract.core.mesh.planStreamRoute)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(({ input, context }) => {
                return this.meshTopologyService.planStreamRoute({
                    ...input,
                    organizationId: this.resolveOrganizationScope(input.organizationId, context),
                });
            });
    }

    @Implement(appContract.core.mesh.connectPeer)
    connectPeer() {
        return implement(appContract.core.mesh.connectPeer)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(({ input }) => {
                return this.meshTopologyService.connectPeer(input);
            });
    }

    @Implement(appContract.core.mesh.disconnectPeer)
    disconnectPeer() {
        return implement(appContract.core.mesh.disconnectPeer)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(({ input }) => {
                return this.meshTopologyService.disconnectPeer(input.params.sessionId, input.body);
            });
    }

    @Implement(appContract.core.mesh.heartbeatPeer)
    heartbeatPeer() {
        return implement(appContract.core.mesh.heartbeatPeer)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(({ input }) => {
                return this.meshTopologyService.heartbeatPeer(input.params.sessionId, input.body);
            });
    }

    @Implement(appContract.core.mesh.membershipSnapshot)
    membershipSnapshot() {
        return implement(appContract.core.mesh.membershipSnapshot)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(({ context }) => {
                return this.meshTopologyService.getMembershipSnapshot({
                    organizationId: this.resolveOrganizationScope(null, context),
                });
            });
    }

    @Implement(appContract.core.mesh.reconcileMembership)
    reconcileMembership() {
        return implement(appContract.core.mesh.reconcileMembership)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(({ input, context }) => {
                return this.meshTopologyService.reconcileMembership({
                    ...input,
                    organizationId: this.resolveOrganizationScope(input.organizationId, context),
                });
            });
    }

    @Implement(appContract.core.mesh.streamTopology)
    streamTopology() {
        return implement(appContract.core.mesh.streamTopology)
            .use(requireAuth())
            .use(requireInternalMesh())
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

    @Implement(appContract.core.mesh.streamEvents)
    streamEvents() {
        return implement(appContract.core.mesh.streamEvents)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(({ input, context }) => {
                return this.meshTopologyService.observeRuntimeEvents({
                    organizationId: this.resolveOrganizationScope(null, context),
                    replay: input.query.replay,
                    replayLimit: input.query.replayLimit,
                });
            });
    }

    @Implement(appContract.core.mesh.publishControlEnvelope)
    publishControlEnvelope() {
        return implement(appContract.core.mesh.publishControlEnvelope)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(({ input, context }) => {
                return this.meshTopologyService.publishControlEnvelope({
                    ...input,
                    organizationId: this.resolveOrganizationScope(input.organizationId, context),
                });
            });
    }

    @Implement(appContract.core.mesh.streamSession)
    streamSession() {
        return implement(appContract.core.mesh.streamSession)
            .use(requireInternalMesh())
            .handler(({ input }) => {
                return this.meshTopologyService.observeSession(input);
            });
    }

    @Implement(appContract.core.mesh.lookupResource)
    lookupResource() {
        return implement(appContract.core.mesh.lookupResource)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(({ input, context }) => {
                return this.meshTopologyService.lookupResource({
                    ...input,
                    organizationId: this.resolveOrganizationScope(input.organizationId, context),
                });
            });
    }

    @Implement(appContract.core.mesh.upsertResourceIndex)
    upsertResourceIndex() {
        return implement(appContract.core.mesh.upsertResourceIndex)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(({ input, context }) => {
                return this.meshTopologyService.upsertResourceIndex({
                    ...input,
                    organizationId: this.resolveOrganizationScope(input.organizationId, context),
                });
            });
    }

    @Implement(appContract.core.mesh.planQueuePartition)
    planQueuePartition() {
        return implement(appContract.core.mesh.planQueuePartition)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(({ input, context }) => {
                return this.meshTopologyService.planQueuePartitionOwnership({
                    ...input,
                    organizationId: this.resolveOrganizationScope(input.organizationId, context),
                });
            });
    }

    @Implement(appContract.core.mesh.issueJoinGrant)
    issueJoinGrant() {
        return implement(appContract.core.mesh.issueJoinGrant)
            .use(requireAuth())
            .use(requireInternalMesh())
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

    @Implement(appContract.core.mesh.consumeJoinGrant)
    consumeJoinGrant() {
        return implement(appContract.core.mesh.consumeJoinGrant)
            .use(requireInternalMesh())
            .handler(async ({ input }) => {
                return this.meshTopologyService.consumeJoinGrant(input);
            });
    }

    @Implement(appContract.core.mesh.registerNode)
    registerNode() {
        return implement(appContract.core.mesh.registerNode)
            .use(requireInternalMesh())
            .handler(async ({ input }) => {
                return this.meshTopologyService.registerNodeInCluster(input);
            });
    }

    @Implement(appContract.core.mesh.revokeJoinGrant)
    revokeJoinGrant() {
        return implement(appContract.core.mesh.revokeJoinGrant)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(async ({ input, context }) => {
                const actor = this.resolveAuthActor(context);
                return this.meshTopologyService.revokeJoinGrant({
                    ...input,
                    revokedByUserId: actor.userId ?? "unknown",
                    revokedByRole: actor.role,
                });
            });
    }

    @Implement(appContract.core.mesh.trustKeyringStatus)
    trustKeyringStatus() {
        return implement(appContract.core.mesh.trustKeyringStatus)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(() => {
                return this.meshTopologyService.getTrustKeyringStatus();
            });
    }

    @Implement(appContract.core.mesh.trustKeyringSecrets)
    trustKeyringSecrets() {
        return implement(appContract.core.mesh.trustKeyringSecrets)
            .use(requireInternalMesh())
            .handler(() => {
                return this.meshTopologyService.getTrustKeyringSecrets();
            });
    }

    @Implement(appContract.core.mesh.trustKeyringRotate)
    trustKeyringRotate() {
        return implement(appContract.core.mesh.trustKeyringRotate)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(async ({ input, context }) => {
                const actor = this.resolveAuthActor(context);
                return this.meshTopologyService.rotateTrustKey({
                    ...input,
                    rotatedByRole: actor.role,
                });
            });
    }

    @Implement(appContract.core.mesh.trustKeyringConvergenceStatus)
    trustKeyringConvergenceStatus() {
        return implement(appContract.core.mesh.trustKeyringConvergenceStatus)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(() => {
                return this.meshTopologyService.getTrustKeyringConvergenceStatus();
            });
    }

    @Implement(appContract.core.mesh.trustStrictReadiness)
    trustStrictReadiness() {
        return implement(appContract.core.mesh.trustStrictReadiness)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(() => {
                return this.meshTopologyService.getTrustStrictReadiness();
            });
    }

    @Implement(appContract.core.mesh.trustStrictModeSet)
    trustStrictModeSet() {
        return implement(appContract.core.mesh.trustStrictModeSet)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(({ input, context }) => {
                const actor = this.resolveAuthActor(context);
                return this.meshTopologyService.setTrustStrictMode({
                    ...input,
                    setByRole: actor.role,
                });
            });
    }

    @Implement(appContract.core.mesh.trustStrictRolloutPlan)
    trustStrictRolloutPlan() {
        return implement(appContract.core.mesh.trustStrictRolloutPlan)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(({ input }) => {
                return this.meshTopologyService.getTrustStrictRolloutPlan({
                    waveSize: input.query?.waveSize,
                });
            });
    }

    @Implement(appContract.core.mesh.trustStrictRollback)
    trustStrictRollback() {
        return implement(appContract.core.mesh.trustStrictRollback)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(({ input, context }) => {
                const actor = this.resolveAuthActor(context);
                return this.meshTopologyService.rollbackTrustStrictMode({
                    ...input,
                    setByRole: actor.role,
                });
            });
    }
}
