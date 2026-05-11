import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { meshContract } from "@repo/api-contracts";
import { requireAuth, requireInternalMesh } from "@/core/modules/auth/orpc/middlewares";
import { CoreEventSyncService } from "@/core/modules/events/services/core-event-sync.service";
import { SystemMeshTopologyService } from "@/core/modules/mesh/services/system-mesh-topology/orchestrator/system-mesh-topology.service";
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

    @Implement(meshContract.getLocalNode)
    getLocalNode() {
        return implement(meshContract.getLocalNode)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(() => {
                return this.meshTopologyService.getLocalNode();
            });
    }

    @Implement(meshContract.getNodeMetrics)
    getNodeMetrics() {
        return implement(meshContract.getNodeMetrics)
            .use(requireInternalMesh())
            .handler(async () => {
                return this.systemMetricsService.getSnapshot();
            });
    }

    @Implement(meshContract.listPeers)
    listPeers() {
        return implement(meshContract.listPeers)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(() => {
                return this.meshTopologyService.listPeers();
            });
    }

    @Implement(meshContract.listPeerSessions)
    listPeerSessions() {
        return implement(meshContract.listPeerSessions)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(() => {
                return this.meshTopologyService.listPeerSessions();
            });
    }

    @Implement(meshContract.listEventStreams)
    listEventStreams() {
        return implement(meshContract.listEventStreams)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(async ({ input }) => {
                return this.coreEventSyncService.listStreams(input.query);
            });
    }

    @Implement(meshContract.findEventStreamById)
    findEventStreamById() {
        return implement(meshContract.findEventStreamById)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(async ({ input }) => {
                return this.coreEventSyncService.getStreamById(input.params.id);
            });
    }

    @Implement(meshContract.subscribeEventStream)
    subscribeEventStream() {
        return implement(meshContract.subscribeEventStream)
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

    @Implement(meshContract.planStreamRoute)
    planStreamRoute() {
        return implement(meshContract.planStreamRoute)
            .use(requireAuth())
            .use(requireInternalMesh())
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
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(({ input }) => {
                return this.meshTopologyService.connectPeer(input);
            });
    }

    @Implement(meshContract.disconnectPeer)
    disconnectPeer() {
        return implement(meshContract.disconnectPeer)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(({ input }) => {
                return this.meshTopologyService.disconnectPeer(input.params.sessionId, input.body);
            });
    }

    @Implement(meshContract.heartbeatPeer)
    heartbeatPeer() {
        return implement(meshContract.heartbeatPeer)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(({ input }) => {
                return this.meshTopologyService.heartbeatPeer(input.params.sessionId, input.body);
            });
    }

    @Implement(meshContract.membershipSnapshot)
    membershipSnapshot() {
        return implement(meshContract.membershipSnapshot)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(({ context }) => {
                return this.meshTopologyService.getMembershipSnapshot({
                    organizationId: this.resolveOrganizationScope(null, context),
                });
            });
    }

    @Implement(meshContract.reconcileMembership)
    reconcileMembership() {
        return implement(meshContract.reconcileMembership)
            .use(requireAuth())
            .use(requireInternalMesh())
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

    @Implement(meshContract.streamEvents)
    streamEvents() {
        return implement(meshContract.streamEvents)
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

    @Implement(meshContract.publishControlEnvelope)
    publishControlEnvelope() {
        return implement(meshContract.publishControlEnvelope)
            .use(requireAuth())
            .use(requireInternalMesh())
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
            .use(requireInternalMesh())
            .handler(({ input }) => {
                return this.meshTopologyService.observeSession(input);
            });
    }

    @Implement(meshContract.lookupResource)
    lookupResource() {
        return implement(meshContract.lookupResource)
            .use(requireAuth())
            .use(requireInternalMesh())
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
            .use(requireAuth())
            .use(requireInternalMesh())
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
            .use(requireAuth())
            .use(requireInternalMesh())
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

    @Implement(meshContract.consumeJoinGrant)
    consumeJoinGrant() {
        return implement(meshContract.consumeJoinGrant)
            .use(requireInternalMesh())
            .handler(async ({ input }) => {
                return this.meshTopologyService.consumeJoinGrant(input);
            });
    }

    @Implement(meshContract.registerNode)
    registerNode() {
        return implement(meshContract.registerNode)
            .use(requireInternalMesh())
            .handler(async ({ input }) => {
                return this.meshTopologyService.registerNodeInCluster(input);
            });
    }

    @Implement(meshContract.revokeJoinGrant)
    revokeJoinGrant() {
        return implement(meshContract.revokeJoinGrant)
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

    @Implement(meshContract.trustKeyringStatus)
    trustKeyringStatus() {
        return implement(meshContract.trustKeyringStatus)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(() => {
                return this.meshTopologyService.getTrustKeyringStatus();
            });
    }

    @Implement(meshContract.trustKeyringSecrets)
    trustKeyringSecrets() {
        return implement(meshContract.trustKeyringSecrets)
            .use(requireInternalMesh())
            .handler(() => {
                return this.meshTopologyService.getTrustKeyringSecrets();
            });
    }

    @Implement(meshContract.trustKeyringRotate)
    trustKeyringRotate() {
        return implement(meshContract.trustKeyringRotate)
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

    @Implement(meshContract.trustKeyringConvergenceStatus)
    trustKeyringConvergenceStatus() {
        return implement(meshContract.trustKeyringConvergenceStatus)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(() => {
                return this.meshTopologyService.getTrustKeyringConvergenceStatus();
            });
    }

    @Implement(meshContract.trustStrictReadiness)
    trustStrictReadiness() {
        return implement(meshContract.trustStrictReadiness)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(() => {
                return this.meshTopologyService.getTrustStrictReadiness();
            });
    }

    @Implement(meshContract.trustStrictModeSet)
    trustStrictModeSet() {
        return implement(meshContract.trustStrictModeSet)
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

    @Implement(meshContract.trustStrictRolloutPlan)
    trustStrictRolloutPlan() {
        return implement(meshContract.trustStrictRolloutPlan)
            .use(requireAuth())
            .use(requireInternalMesh())
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
