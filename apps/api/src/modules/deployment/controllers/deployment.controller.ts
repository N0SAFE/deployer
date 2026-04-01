import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { appContract } from "@repo/api-contracts";
import type { PlatformRole } from "@repo/auth";
import { DeploymentService } from "../services/deployment.service";
import { requireAuth, requireInternalMesh, requirePlatformRole } from "@/core/modules/auth/orpc/middlewares";
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


    @Implement(appContract.deployment.list)
    list() {
        return implement(appContract.deployment.list)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.deploymentService.listDeployments(input.query);
            });
    }

    @Implement(appContract.deployment.findById)
    findById() {
        return implement(appContract.deployment.findById)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.deploymentService.getDeploymentById(input.params.id);
            });
    }

    @Implement(appContract.deployment.trigger)
    trigger() {
        return implement(appContract.deployment.trigger)
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

    @Implement(appContract.deployment.uploadBundle)
    uploadBundle() {
        return implement(appContract.deployment.uploadBundle)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const uploaded = await this.deploymentService.uploadBundle({
                    file: input.file,
                    fileName: input.fileName,
                });

                return uploaded;
            });
    }

    @Implement(appContract.deployment.cancel)
    cancel() {
        return implement(appContract.deployment.cancel)
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

    @Implement(appContract.deployment.rollback)
    rollback() {
        return implement(appContract.deployment.rollback)
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

    @Implement(appContract.deployment.getLogs)
    getLogs() {
        return implement(appContract.deployment.getLogs)
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

    @Implement(appContract.deployment.retry)
    retry() {
        return implement(appContract.deployment.retry)
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

    @Implement(appContract.deployment.getRollbackHistory)
    getRollbackHistory() {
        return implement(appContract.deployment.getRollbackHistory)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.deploymentService.getRollbackHistory(input.params.id);
            });
    }

    @Implement(appContract.deployment.stream)
    stream() {
        return implement(appContract.deployment.stream)
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

    @Implement(appContract.deployment.streamInternal)
    streamInternal() {
        const deploymentService = this.deploymentService;

        return implement(appContract.deployment.streamInternal)
            .use(requireAuth())
            .use(requireInternalMesh())
            .handler(({ input }) => {
                return deploymentService.streamDeploymentEvents({
                    deploymentId: input.params.id,
                    replay: input.query.replay,
                    replayLimit: input.query.replayLimit,
                });
            });
    }

    @Implement(appContract.deployment.streamService)
    streamService() {
        const deploymentService = this.deploymentService;

        return implement(appContract.deployment.streamService)
            .use(requireAuth())
            .handler(({ input }) => {
                return deploymentService.streamServiceEvents({
                    serviceId: input.params.serviceId,
                    replay: input.query.replay,
                    replayLimit: input.query.replayLimit,
                });
            });
    }

    @Implement(appContract.deployment.streamQuery)
    streamQuery() {
        const deploymentService = this.deploymentService;

        return implement(appContract.deployment.streamQuery)
            .use(requireAuth())
            .handler(({ input }) => {
                return deploymentService.streamQueryEvents({
                    deploymentId: input.query.deploymentId,
                    serviceId: input.query.serviceId,
                    projectId: input.query.projectId,
                    aggregateId: input.query.aggregateId,
                    eventType: input.query.eventType,
                    since: input.query.since,
                    cursor: input.query.cursor,
                    replay: input.query.replay,
                    replayLimit: input.query.replayLimit,
                });
            });
    }

    @Implement(appContract.deployment.streamsList)
    streamsList() {
        return implement(appContract.deployment.streamsList)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.deploymentService.listStreamDefinitions(input.query);
            });
    }

    @Implement(appContract.deployment.streamFindById)
    streamFindById() {
        return implement(appContract.deployment.streamFindById)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.deploymentService.getStreamDefinitionById(input.params.id);
            });
    }

    @Implement(appContract.deployment.getTemplateProvenance)
    getTemplateProvenance() {
        return implement(appContract.deployment.getTemplateProvenance)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.getTemplateProvenance(input.params.id);
            });
    }

    @Implement(appContract.deployment.upsertTemplateProvenance)
    upsertTemplateProvenance() {
        return implement(appContract.deployment.upsertTemplateProvenance)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.upsertTemplateProvenance(input.params.id, input.body);
            });
    }

    @Implement(appContract.deployment.getTemplateProvenanceByRun)
    getTemplateProvenanceByRun() {
        return implement(appContract.deployment.getTemplateProvenanceByRun)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.getTemplateProvenanceByRun(input.params.runId);
            });
    }

    @Implement(appContract.deployment.createCompiledPlanSnapshot)
    createCompiledPlanSnapshot() {
        return implement(appContract.deployment.createCompiledPlanSnapshot)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.createCompiledPlanSnapshot(input.params.id, input.body);
            });
    }

    @Implement(appContract.deployment.listCompiledPlanSnapshots)
    listCompiledPlanSnapshots() {
        return implement(appContract.deployment.listCompiledPlanSnapshots)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.listCompiledPlanSnapshots(input.params.id);
            });
    }

    @Implement(appContract.deployment.getCompiledPlanSnapshot)
    getCompiledPlanSnapshot() {
        return implement(appContract.deployment.getCompiledPlanSnapshot)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.getCompiledPlanSnapshot(input.params.snapshotId);
            });
    }

    @Implement(appContract.deployment.getCompiledPlanSnapshotByRun)
    getCompiledPlanSnapshotByRun() {
        return implement(appContract.deployment.getCompiledPlanSnapshotByRun)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.getCompiledPlanSnapshotByRun(input.params.runId);
            });
    }

    @Implement(appContract.deployment.compilePlan)
    compilePlan() {
        return implement(appContract.deployment.compilePlan)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.compilePlan(input);
            });
    }

    @Implement(appContract.deployment.compilePlanPreview)
    compilePlanPreview() {
        return implement(appContract.deployment.compilePlanPreview)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.compilePlan(input);
            });
    }

    @Implement(appContract.deployment.compileRollbackEdges)
    compileRollbackEdges() {
        return implement(appContract.deployment.compileRollbackEdges)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.compileRollbackEdges(input);
            });
    }

    @Implement(appContract.deployment.queueEnqueueJob)
    queueEnqueueJob() {
        return implement(appContract.deployment.queueEnqueueJob)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentService.enqueueQueueJob(input);
            });
    }

    @Implement(appContract.deployment.queueClaimJobs)
    queueClaimJobs() {
        return implement(appContract.deployment.queueClaimJobs)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentService.claimQueueJobs(input);
            });
    }

    @Implement(appContract.deployment.queueHeartbeatJob)
    queueHeartbeatJob() {
        return implement(appContract.deployment.queueHeartbeatJob)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentService.heartbeatQueueJob(input.params.jobId, input.body);
            });
    }

    @Implement(appContract.deployment.queueCompleteJob)
    queueCompleteJob() {
        return implement(appContract.deployment.queueCompleteJob)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentService.completeQueueJob(input.params.jobId, input.body);
            });
    }

    @Implement(appContract.deployment.queueFailJob)
    queueFailJob() {
        return implement(appContract.deployment.queueFailJob)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentService.failQueueJob(input.params.jobId, input.body);
            });
    }

    @Implement(appContract.deployment.queueFindJobById)
    queueFindJobById() {
        return implement(appContract.deployment.queueFindJobById)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.findQueueJobById(input.params.jobId);
            });
    }

    @Implement(appContract.deployment.queueListJobs)
    queueListJobs() {
        return implement(appContract.deployment.queueListJobs)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.listQueueJobs(input.query);
            });
    }

    @Implement(appContract.deployment.queueListDeadLetterJobs)
    queueListDeadLetterJobs() {
        return implement(appContract.deployment.queueListDeadLetterJobs)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.listDeadLetterJobs(input.query);
            });
    }

    @Implement(appContract.deployment.queueFindDeadLetterJobById)
    queueFindDeadLetterJobById() {
        return implement(appContract.deployment.queueFindDeadLetterJobById)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.findDeadLetterJobById(input.params.deadLetterJobId);
            });
    }

    @Implement(appContract.deployment.queueReplayDeadLetterJob)
    queueReplayDeadLetterJob() {
        return implement(appContract.deployment.queueReplayDeadLetterJob)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentService.replayDeadLetterJob(input);
            });
    }

    @Implement(appContract.deployment.listRetryPolicies)
    listRetryPolicies() {
        return implement(appContract.deployment.listRetryPolicies)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.listRetryPolicies(input);
            });
    }

    @Implement(appContract.deployment.resolveRetryPolicy)
    resolveRetryPolicy() {
        return implement(appContract.deployment.resolveRetryPolicy)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.resolveRetryPolicy(input);
            });
    }

    @Implement(appContract.deployment.cancelExecution)
    cancelExecution() {
        return implement(appContract.deployment.cancelExecution)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentService.cancelExecution(input.params.id, input.body);
            });
    }

    @Implement(appContract.deployment.resumeExecution)
    resumeExecution() {
        return implement(appContract.deployment.resumeExecution)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentService.resumeExecution(input.params.id, input.body);
            });
    }

    @Implement(appContract.deployment.getExecutionCheckpoint)
    getExecutionCheckpoint() {
        return implement(appContract.deployment.getExecutionCheckpoint)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.getExecutionCheckpoint(input.params.id);
            });
    }

    @Implement(appContract.deployment.getExecutionCheckpointByRun)
    getExecutionCheckpointByRun() {
        return implement(appContract.deployment.getExecutionCheckpointByRun)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.getExecutionCheckpointByRun(input.params.runId);
            });
    }

    @Implement(appContract.deployment.emitNodeLifecycleEvent)
    emitNodeLifecycleEvent() {
        return implement(appContract.deployment.emitNodeLifecycleEvent)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentService.emitNodeLifecycleEvent(input.params.runId, input.body);
            });
    }

    @Implement(appContract.deployment.listNodeLifecycleEvents)
    listNodeLifecycleEvents() {
        return implement(appContract.deployment.listNodeLifecycleEvents)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.listNodeLifecycleEvents(input.params.runId, input.query);
            });
    }

    @Implement(appContract.deployment.streamNodeLifecycleEvents)
    streamNodeLifecycleEvents() {
        return implement(appContract.deployment.streamNodeLifecycleEvents)
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

    @Implement(appContract.deployment.listPhaseTransitions)
    listPhaseTransitions() {
        return implement(appContract.deployment.listPhaseTransitions)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.listPhaseTransitions(input);
            });
    }

    @Implement(appContract.deployment.validatePhaseTransition)
    validatePhaseTransition() {
        return implement(appContract.deployment.validatePhaseTransition)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.validatePhaseTransition(input);
            });
    }

    @Implement(appContract.deployment.applyPhaseTransition)
    applyPhaseTransition() {
        return implement(appContract.deployment.applyPhaseTransition)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(async ({ input }) => {
                return this.deploymentService.applyPhaseTransition(input.params.id, input.body);
            });
    }

    @Implement(appContract.deployment.delete)
    delete() {
        return implement(appContract.deployment.delete)
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
