import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { deploymentContract } from "@repo/api-contracts";
import type { PlatformRole } from "@repo/auth";
import { DeploymentService } from "../services/deployment.service";
import { authMiddleware, requireAuth, requireMesh, requirePlatformRole } from "@/core/modules/auth/orpc/middlewares";
import { DeploymentStreamOrchestratorService } from "../mesh/services/deployment-stream-orchestrator.service";

@Controller()
export class DeploymentController {
    private static readonly DEPLOYMENT_CONTROL_PLATFORM_ROLES: readonly PlatformRole[] = [
        "superAdmin",
        "admin",
        "operator",
    ];

    constructor(
        private readonly deploymentService: DeploymentService,
        private readonly deploymentStreamOrchestratorService: DeploymentStreamOrchestratorService,
    ) {}

    private resolvePlatformRole(context: unknown): PlatformRole | null {
        const authContext =
            context && typeof context === "object" && "auth" in context
                ? (context as { auth?: { user?: { role?: unknown } | null } }).auth
                : undefined;

        const role = authContext?.user?.role;
        return typeof role === "string" &&
            DeploymentController.DEPLOYMENT_CONTROL_PLATFORM_ROLES.includes(role as PlatformRole)
            ? (role as PlatformRole)
            : null;
    }


    @Implement(deploymentContract.list)
    list() {
        return implement(deploymentContract.list)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.deploymentService.listDeployments(input.query);
            });
    }

    @Implement(deploymentContract.listServicePreviews)
    listServicePreviews() {
        return implement(deploymentContract.listServicePreviews)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.deploymentService.listServicePreviews(input.params.serviceId);
            });
    }

    @Implement(deploymentContract.promoteServicePreview)
    promoteServicePreview() {
        return implement(deploymentContract.promoteServicePreview)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const userId = (context.auth as { user?: { id?: string } }).user?.id ?? "";
                const platformRole = this.resolvePlatformRole(context);
                return this.deploymentService.promoteServicePreview(
                    input.params.serviceId,
                    input.body.previewName,
                    userId,
                    platformRole,
                );
            });
    }

    @Implement(deploymentContract.findById)
    findById() {
        return implement(deploymentContract.findById)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.deploymentService.getDeploymentById(input.params.id);
            });
    }

    @Implement(deploymentContract.trigger)
    trigger() {
        return implement(deploymentContract.trigger)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const userId = context.auth.user.id;
                const actorPlatformRole = this.resolvePlatformRole(context);
                const deployment = await this.deploymentService.triggerDeployment(
                    input,
                    userId,
                    actorPlatformRole,
                );
                return {
                    deploymentId: deployment.id,
                    status: deployment.status,
                    message: "Deployment queued successfully",
                };
            });
    }

    @Implement(deploymentContract.uploadBundle)
    uploadBundle() {
        return implement(deploymentContract.uploadBundle)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const uploaded = await this.deploymentService.uploadBundle({
                    file: input.file,
                    fileName: input.fileName,
                });

                return uploaded;
            });
    }

    @Implement(deploymentContract.cancel)
    cancel() {
        return implement(deploymentContract.cancel)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const actorPlatformRole = this.resolvePlatformRole(context);
                const result = await this.deploymentService.cancelDeployment(
                    input.params.id,
                    context.auth.user.id,
                    input.body?.reason,
                    actorPlatformRole,
                );
                return {
                    success: true,
                    message: "Deployment cancelled successfully",
                    deploymentId: result.deploymentId,
                    cancelledAt: result.cancelledAt,
                };
            });
    }

    @Implement(deploymentContract.rollback)
    rollback() {
        return implement(deploymentContract.rollback)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const actorPlatformRole = this.resolvePlatformRole(context);
                const rollback = await this.deploymentService.rollbackDeployment(
                    input.params.id,
                    input.body.targetDeploymentId,
                    context.auth.user.id,
                    input.body.reason,
                    actorPlatformRole,
                );
                return {
                    rollbackDeploymentId: rollback.id,
                    message: "Rollback deployment queued successfully",
                };
            });
    }

    @Implement(deploymentContract.getLogs)
    getLogs() {
        return implement(deploymentContract.getLogs)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.deploymentService.getDeploymentLogs(
                    input.params.id,
                    input.query.limit,
                    input.query.offset,
                    {
                        level: input.query.level,
                        phase: input.query.phase,
                        step: input.query.step,
                    },
                    {
                        includeRetrySummary: input.query.includeRetrySummary,
                    },
                );
            });
    }

    @Implement(deploymentContract.retry)
    retry() {
        return implement(deploymentContract.retry)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const userId = context.auth.user.id;
                const actorPlatformRole = this.resolvePlatformRole(context);
                const retry = await this.deploymentService.retryDeployment(
                    input.params.id,
                    userId,
                    actorPlatformRole,
                );
                return {
                    retryDeploymentId: retry.id,
                    message: "Retry deployment queued successfully",
                };
            });
    }

    @Implement(deploymentContract.getRollbackHistory)
    getRollbackHistory() {
        return implement(deploymentContract.getRollbackHistory)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.deploymentService.getRollbackHistory(input.params.id);
            });
    }

    @Implement(deploymentContract.stream)
    stream() {
        return implement(deploymentContract.stream)
            .use(requireAuth())
            .handler(({ input, context }) => {
                return this.deploymentStreamOrchestratorService.openDeploymentStream({
                    deploymentId: input.params.id,
                    replay: input.query.replay,
                    replayLimit: input.query.replayLimit,
                    context,
                });
            });
    }

    @Implement(deploymentContract.streamInternal)
    streamInternal() {
        const deploymentService = this.deploymentService;

        return implement(deploymentContract.streamInternal)
            .use(requireMesh())
            .use(requireAuth())
            .handler(({ input }) => {
                return deploymentService.streamDeploymentEvents({
                    deploymentId: input.params.id,
                    replay: input.query.replay,
                    replayLimit: input.query.replayLimit,
                });
            });
    }

    @Implement(deploymentContract.streamService)
    streamService() {
        const deploymentService = this.deploymentService;

        return implement(deploymentContract.streamService)
            .use(requireAuth())
            .handler(({ input }) => {
                return deploymentService.streamServiceEvents({
                    serviceId: input.params.serviceId,
                    replay: input.query.replay,
                    replayLimit: input.query.replayLimit,
                });
            });
    }

    @Implement(deploymentContract.streamQuery)
    streamQuery() {
        const deploymentService = this.deploymentService;

        return implement(deploymentContract.streamQuery)
            .use(requireAuth())
            .handler(({ input }) => {
                return deploymentService.streamQueryEvents({
                    deploymentId: input.query.deploymentId,
                    serviceId: input.query.serviceId,
                    projectId: input.query.projectId,
                    aggregateId: input.query.aggregateId,
                    eventType: input.query.eventType,
                    since: input.query.since?.toISOString(),
                    cursor: input.query.cursor,
                    replay: input.query.replay,
                    replayLimit: input.query.replayLimit,
                });
            });
    }

    @Implement(deploymentContract.streamsList)
    streamsList() {
        return implement(deploymentContract.streamsList)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.deploymentService.listStreamDefinitions(input.query);
            });
    }

    @Implement(deploymentContract.streamFindById)
    streamFindById() {
        return implement(deploymentContract.streamFindById)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.deploymentService.getStreamDefinitionById(input.params.id);
            });
    }

    @Implement(deploymentContract.getTemplateProvenance)
    getTemplateProvenance() {
        return implement(deploymentContract.getTemplateProvenance)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.getTemplateProvenance(input.params.id);
            });
    }

    @Implement(deploymentContract.upsertTemplateProvenance)
    upsertTemplateProvenance() {
        return implement(deploymentContract.upsertTemplateProvenance)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.upsertTemplateProvenance(input.params.id, input.body);
            });
    }

    @Implement(deploymentContract.getTemplateProvenanceByRun)
    getTemplateProvenanceByRun() {
        return implement(deploymentContract.getTemplateProvenanceByRun)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.getTemplateProvenanceByRun(input.params.runId);
            });
    }

    @Implement(deploymentContract.createCompiledPlanSnapshot)
    createCompiledPlanSnapshot() {
        return implement(deploymentContract.createCompiledPlanSnapshot)
            .use(authMiddleware())
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.createCompiledPlanSnapshot(input.params.id, input.body);
            });
    }

    @Implement(deploymentContract.listCompiledPlanSnapshots)
    listCompiledPlanSnapshots() {
        return implement(deploymentContract.listCompiledPlanSnapshots)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.listCompiledPlanSnapshots(input.params.id);
            });
    }

    @Implement(deploymentContract.getCompiledPlanSnapshot)
    getCompiledPlanSnapshot() {
        return implement(deploymentContract.getCompiledPlanSnapshot)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.getCompiledPlanSnapshot(input.params.snapshotId);
            });
    }

    @Implement(deploymentContract.getCompiledPlanSnapshotByRun)
    getCompiledPlanSnapshotByRun() {
        return implement(deploymentContract.getCompiledPlanSnapshotByRun)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.getCompiledPlanSnapshotByRun(input.params.runId);
            });
    }

    @Implement(deploymentContract.compilePlan)
    compilePlan() {
        return implement(deploymentContract.compilePlan)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.compilePlan(input);
            });
    }

    @Implement(deploymentContract.compilePlanPreview)
    compilePlanPreview() {
        return implement(deploymentContract.compilePlanPreview)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.compilePlan(input);
            });
    }

    @Implement(deploymentContract.compileRollbackEdges)
    compileRollbackEdges() {
        return implement(deploymentContract.compileRollbackEdges)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.compileRollbackEdges(input);
            });
    }

    @Implement(deploymentContract.queueEnqueueJob)
    queueEnqueueJob() {
        return implement(deploymentContract.queueEnqueueJob)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentService.enqueueQueueJob(input);
            });
    }

    @Implement(deploymentContract.queueClaimJobs)
    queueClaimJobs() {
        return implement(deploymentContract.queueClaimJobs)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentService.claimQueueJobs(input);
            });
    }

    @Implement(deploymentContract.queueHeartbeatJob)
    queueHeartbeatJob() {
        return implement(deploymentContract.queueHeartbeatJob)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentService.heartbeatQueueJob(input.params.jobId, input.body);
            });
    }

    @Implement(deploymentContract.queueCompleteJob)
    queueCompleteJob() {
        return implement(deploymentContract.queueCompleteJob)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentService.completeQueueJob(input.params.jobId, input.body);
            });
    }

    @Implement(deploymentContract.queueFailJob)
    queueFailJob() {
        return implement(deploymentContract.queueFailJob)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentService.failQueueJob(input.params.jobId, input.body);
            });
    }

    @Implement(deploymentContract.queueFindJobById)
    queueFindJobById() {
        return implement(deploymentContract.queueFindJobById)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.findQueueJobById(input.params.jobId);
            });
    }

    @Implement(deploymentContract.queueListJobs)
    queueListJobs() {
        return implement(deploymentContract.queueListJobs)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.listQueueJobs(input.query);
            });
    }

    @Implement(deploymentContract.queueListDeadLetterJobs)
    queueListDeadLetterJobs() {
        return implement(deploymentContract.queueListDeadLetterJobs)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.listDeadLetterJobs(input.query);
            });
    }

    @Implement(deploymentContract.queueFindDeadLetterJobById)
    queueFindDeadLetterJobById() {
        return implement(deploymentContract.queueFindDeadLetterJobById)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.findDeadLetterJobById(input.params.deadLetterJobId);
            });
    }

    @Implement(deploymentContract.queueReplayDeadLetterJob)
    queueReplayDeadLetterJob() {
        return implement(deploymentContract.queueReplayDeadLetterJob)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentService.replayDeadLetterJob(input);
            });
    }

    @Implement(deploymentContract.listRetryPolicies)
    listRetryPolicies() {
        return implement(deploymentContract.listRetryPolicies)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.listRetryPolicies(input.query);
            });
    }

    @Implement(deploymentContract.resolveRetryPolicy)
    resolveRetryPolicy() {
        return implement(deploymentContract.resolveRetryPolicy)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.resolveRetryPolicy(input);
            });
    }

    @Implement(deploymentContract.cancelExecution)
    cancelExecution() {
        return implement(deploymentContract.cancelExecution)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentService.cancelExecution(input.params.id, input.body);
            });
    }

    @Implement(deploymentContract.resumeExecution)
    resumeExecution() {
        return implement(deploymentContract.resumeExecution)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentService.resumeExecution(input.params.id, input.body);
            });
    }

    @Implement(deploymentContract.getExecutionCheckpoint)
    getExecutionCheckpoint() {
        return implement(deploymentContract.getExecutionCheckpoint)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.getExecutionCheckpoint(input.params.id);
            });
    }

    @Implement(deploymentContract.getExecutionCheckpointByRun)
    getExecutionCheckpointByRun() {
        return implement(deploymentContract.getExecutionCheckpointByRun)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.getExecutionCheckpointByRun(input.params.runId);
            });
    }

    @Implement(deploymentContract.emitNodeLifecycleEvent)
    emitNodeLifecycleEvent() {
        return implement(deploymentContract.emitNodeLifecycleEvent)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentService.emitNodeLifecycleEvent(input.params.runId, input.body);
            });
    }

    @Implement(deploymentContract.listNodeLifecycleEvents)
    listNodeLifecycleEvents() {
        return implement(deploymentContract.listNodeLifecycleEvents)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.listNodeLifecycleEvents(input.params.runId, input.query);
            });
    }

    @Implement(deploymentContract.streamNodeLifecycleEvents)
    streamNodeLifecycleEvents() {
        return implement(deploymentContract.streamNodeLifecycleEvents)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.streamNodeLifecycleEvents({
                    runId: input.params.runId,
                    fromSequence: input.query.fromSequence,
                    replay: input.query.replay,
                    replayLimit: input.query.replayLimit,
                });
            });
    }

    @Implement(deploymentContract.listPhaseTransitions)
    listPhaseTransitions() {
        return implement(deploymentContract.listPhaseTransitions)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.listPhaseTransitions(input.query ?? {});
            });
    }

    @Implement(deploymentContract.validatePhaseTransition)
    validatePhaseTransition() {
        return implement(deploymentContract.validatePhaseTransition)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.validatePhaseTransition(input);
            });
    }

    @Implement(deploymentContract.applyPhaseTransition)
    applyPhaseTransition() {
        return implement(deploymentContract.applyPhaseTransition)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(async ({ input }) => {
                return this.deploymentService.applyPhaseTransition(input.params.id, input.body);
            });
    }

    @Implement(deploymentContract.delete)
    delete() {
        return implement(deploymentContract.delete)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const actorPlatformRole = this.resolvePlatformRole(context);
                await this.deploymentService.deleteDeployment(
                    input.params.id,
                    context.auth.user.id,
                    actorPlatformRole,
                );
                return { success: true };
            });
    }
}
