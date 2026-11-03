import { Controller } from "@nestjs/common";
import { ORPCError } from "@orpc/client";
import { Implement } from "@orpc/nest";

import type { PlatformRole } from "@deployer/auth";
import { procedure } from "@deployer/nest-effect";
import { deploymentContract } from "@deployer/runtime-contracts";
import { authMiddleware, requireAuth, requireMesh, requirePlatformRole, requireSystemActor } from "@deployer/shared/core/modules/auth/orpc/middlewares";

import { serve } from "../../../core/orpc/serve";
import { DeploymentStreamOrchestratorService } from "../mesh/services/deployment-stream-orchestrator.service";
import { DeploymentService } from "../services/deployment.service";
import { DeploymentEventTriggerService } from "../triggers/deployment-event-trigger.service";

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


    // ── ROUTE ORDER MATTERS ──────────────────────────────────────────────────
    // Nest registers routes in method order, and `trigger` below is `POST /deployments/:serviceId`:
    // declared first, it captures `POST /deployments/trigger-event` and answers it as a deployment
    // trigger (a 400 or 401 about `serviceId` and `previewName`). This peer-only procedure therefore
    // has to be registered before any `/:param` route.
    // The global session guard would turn a peer's call into a 401 before the claim is read, so the
    // procedure opts out of it: `requireSystemActor` below is its only gate.
    @Implement(deploymentContract.triggerFromEvent)
    triggerFromEvent() {
        // Not `requireAuth()`: the caller is a peer service relaying a provider event, vouched
        // for by a signed system-actor claim. A user session cannot reach this procedure.
        return procedure(deploymentContract.triggerFromEvent)
            .use(requireSystemActor("runtime"))
            .effect(function* ({ input, context }) {
                const trigger = yield* DeploymentEventTriggerService;
                return yield* serve(context)(trigger.trigger(input, context.systemActor.deliveryId));
            });
    }

    @Implement(deploymentContract.list)
    list() {
        return procedure(deploymentContract.list)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(async ({ input }) => {
                return this.deploymentService.listDeployments(input.query);
            });
    }

    @Implement(deploymentContract.listServicePreviews)
    listServicePreviews() {
        return procedure(deploymentContract.listServicePreviews)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.deploymentService.listServicePreviews(input.params.serviceId);
            });
    }

    @Implement(deploymentContract.promoteServicePreview)
    promoteServicePreview() {
        return procedure(deploymentContract.promoteServicePreview)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const userId = callerId(context);
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
        return procedure(deploymentContract.findById)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(async ({ input }) => {
                return this.deploymentService.getDeploymentById(input.params.id);
            });
    }

    @Implement(deploymentContract.trigger)
    trigger() {
        return procedure(deploymentContract.trigger)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const userId = callerId(context);
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
        return procedure(deploymentContract.uploadBundle)
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
        return procedure(deploymentContract.cancel)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const actorPlatformRole = this.resolvePlatformRole(context);
                const result = await this.deploymentService.cancelDeployment(
                    input.params.id,
                    callerId(context),
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
        return procedure(deploymentContract.rollback)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const actorPlatformRole = this.resolvePlatformRole(context);
                const rollback = await this.deploymentService.rollbackDeployment(
                    input.params.id,
                    input.body.targetDeploymentId,
                    callerId(context),
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
        return procedure(deploymentContract.getLogs)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
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
        return procedure(deploymentContract.retry)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const userId = callerId(context);
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
        return procedure(deploymentContract.getRollbackHistory)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.deploymentService.getRollbackHistory(input.params.id);
            });
    }

    @Implement(deploymentContract.stream)
    stream() {
        return procedure(deploymentContract.stream)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentStreamOrchestratorService.openDeploymentStream({
                    deploymentId: input.params.id,
                    replay: input.query.replay,
                    replayLimit: input.query.replayLimit,
                });
            });
    }

    @Implement(deploymentContract.streamInternal)
    streamInternal() {
        const deploymentService = this.deploymentService;

        return procedure(deploymentContract.streamInternal)
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

        return procedure(deploymentContract.streamService)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
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

        return procedure(deploymentContract.streamQuery)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
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
        return procedure(deploymentContract.streamsList)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.deploymentService.listStreamDefinitions(input.query);
            });
    }

    @Implement(deploymentContract.streamFindById)
    streamFindById() {
        return procedure(deploymentContract.streamFindById)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.deploymentService.getStreamDefinitionById(input.params.id);
            });
    }

    @Implement(deploymentContract.getTemplateProvenance)
    getTemplateProvenance() {
        return procedure(deploymentContract.getTemplateProvenance)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.getTemplateProvenance(input.params.id);
            });
    }

    @Implement(deploymentContract.upsertTemplateProvenance)
    upsertTemplateProvenance() {
        return procedure(deploymentContract.upsertTemplateProvenance)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.upsertTemplateProvenance(input.params.id, input.body);
            });
    }

    @Implement(deploymentContract.getTemplateProvenanceByRun)
    getTemplateProvenanceByRun() {
        return procedure(deploymentContract.getTemplateProvenanceByRun)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.getTemplateProvenanceByRun(input.params.runId);
            });
    }

    @Implement(deploymentContract.createCompiledPlanSnapshot)
    createCompiledPlanSnapshot() {
        return procedure(deploymentContract.createCompiledPlanSnapshot)
            .use(authMiddleware())
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.createCompiledPlanSnapshot(input.params.id, input.body);
            });
    }

    @Implement(deploymentContract.listCompiledPlanSnapshots)
    listCompiledPlanSnapshots() {
        return procedure(deploymentContract.listCompiledPlanSnapshots)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.listCompiledPlanSnapshots(input.params.id);
            });
    }

    @Implement(deploymentContract.getCompiledPlanSnapshot)
    getCompiledPlanSnapshot() {
        return procedure(deploymentContract.getCompiledPlanSnapshot)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.getCompiledPlanSnapshot(input.params.snapshotId);
            });
    }

    @Implement(deploymentContract.getCompiledPlanSnapshotByRun)
    getCompiledPlanSnapshotByRun() {
        return procedure(deploymentContract.getCompiledPlanSnapshotByRun)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.getCompiledPlanSnapshotByRun(input.params.runId);
            });
    }

    @Implement(deploymentContract.compilePlan)
    compilePlan() {
        return procedure(deploymentContract.compilePlan)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.compilePlan(input);
            });
    }

    @Implement(deploymentContract.compilePlanPreview)
    compilePlanPreview() {
        return procedure(deploymentContract.compilePlanPreview)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.compilePlan(input);
            });
    }

    @Implement(deploymentContract.compileRollbackEdges)
    compileRollbackEdges() {
        return procedure(deploymentContract.compileRollbackEdges)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.compileRollbackEdges(input);
            });
    }

    @Implement(deploymentContract.queueEnqueueJob)
    queueEnqueueJob() {
        return procedure(deploymentContract.queueEnqueueJob)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentService.enqueueQueueJob(input);
            });
    }

    @Implement(deploymentContract.queueClaimJobs)
    queueClaimJobs() {
        return procedure(deploymentContract.queueClaimJobs)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentService.claimQueueJobs(input);
            });
    }

    @Implement(deploymentContract.queueHeartbeatJob)
    queueHeartbeatJob() {
        return procedure(deploymentContract.queueHeartbeatJob)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentService.heartbeatQueueJob(input.params.jobId, input.body);
            });
    }

    @Implement(deploymentContract.queueCompleteJob)
    queueCompleteJob() {
        return procedure(deploymentContract.queueCompleteJob)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentService.completeQueueJob(input.params.jobId, input.body);
            });
    }

    @Implement(deploymentContract.queueFailJob)
    queueFailJob() {
        return procedure(deploymentContract.queueFailJob)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentService.failQueueJob(input.params.jobId, input.body);
            });
    }

    @Implement(deploymentContract.queueFindJobById)
    queueFindJobById() {
        return procedure(deploymentContract.queueFindJobById)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.findQueueJobById(input.params.jobId);
            });
    }

    @Implement(deploymentContract.queueListJobs)
    queueListJobs() {
        return procedure(deploymentContract.queueListJobs)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.listQueueJobs(input.query);
            });
    }

    @Implement(deploymentContract.queueListDeadLetterJobs)
    queueListDeadLetterJobs() {
        return procedure(deploymentContract.queueListDeadLetterJobs)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.listDeadLetterJobs(input.query);
            });
    }

    @Implement(deploymentContract.queueFindDeadLetterJobById)
    queueFindDeadLetterJobById() {
        return procedure(deploymentContract.queueFindDeadLetterJobById)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.findDeadLetterJobById(input.params.deadLetterJobId);
            });
    }

    @Implement(deploymentContract.queueReplayDeadLetterJob)
    queueReplayDeadLetterJob() {
        return procedure(deploymentContract.queueReplayDeadLetterJob)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentService.replayDeadLetterJob(input);
            });
    }

    @Implement(deploymentContract.listRetryPolicies)
    listRetryPolicies() {
        return procedure(deploymentContract.listRetryPolicies)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.listRetryPolicies(input.query);
            });
    }

    @Implement(deploymentContract.resolveRetryPolicy)
    resolveRetryPolicy() {
        return procedure(deploymentContract.resolveRetryPolicy)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.resolveRetryPolicy(input);
            });
    }

    @Implement(deploymentContract.cancelExecution)
    cancelExecution() {
        return procedure(deploymentContract.cancelExecution)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentService.cancelExecution(input.params.id, input.body);
            });
    }

    @Implement(deploymentContract.resumeExecution)
    resumeExecution() {
        return procedure(deploymentContract.resumeExecution)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentService.resumeExecution(input.params.id, input.body);
            });
    }

    @Implement(deploymentContract.getExecutionCheckpoint)
    getExecutionCheckpoint() {
        return procedure(deploymentContract.getExecutionCheckpoint)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.getExecutionCheckpoint(input.params.id);
            });
    }

    @Implement(deploymentContract.getExecutionCheckpointByRun)
    getExecutionCheckpointByRun() {
        return procedure(deploymentContract.getExecutionCheckpointByRun)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.getExecutionCheckpointByRun(input.params.runId);
            });
    }

    @Implement(deploymentContract.emitNodeLifecycleEvent)
    emitNodeLifecycleEvent() {
        return procedure(deploymentContract.emitNodeLifecycleEvent)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(({ input }) => {
                return this.deploymentService.emitNodeLifecycleEvent(input.params.runId, input.body);
            });
    }

    @Implement(deploymentContract.listNodeLifecycleEvents)
    listNodeLifecycleEvents() {
        return procedure(deploymentContract.listNodeLifecycleEvents)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.listNodeLifecycleEvents(input.params.runId, input.query);
            });
    }

    @Implement(deploymentContract.streamNodeLifecycleEvents)
    streamNodeLifecycleEvents() {
        return procedure(deploymentContract.streamNodeLifecycleEvents)
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
        return procedure(deploymentContract.listPhaseTransitions)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.listPhaseTransitions(input.query ?? {});
            });
    }

    @Implement(deploymentContract.validatePhaseTransition)
    validatePhaseTransition() {
        return procedure(deploymentContract.validatePhaseTransition)
            .use(requireAuth())
            .handler(({ input }) => {
                return this.deploymentService.validatePhaseTransition(input);
            });
    }

    @Implement(deploymentContract.applyPhaseTransition)
    applyPhaseTransition() {
        return procedure(deploymentContract.applyPhaseTransition)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .handler(async ({ input }) => {
                return this.deploymentService.applyPhaseTransition(input.params.id, input.body);
            });
    }

    @Implement(deploymentContract.delete)
    delete() {
        return procedure(deploymentContract.delete)
            .use(requireAuth())
            .handler(async ({ input, context }) => {
                const actorPlatformRole = this.resolvePlatformRole(context);
                await this.deploymentService.deleteDeployment(
                    input.params.id,
                    callerId(context),
                    actorPlatformRole,
                );
                return { success: true };
            });
    }
}

/**
 * The authenticated caller of a Promise handler.
 *
 * `requireAuth()` has already refused a caller without a session; this restates it for the type system, because the
 * `procedure()` wrapper does not carry that middleware's narrowing the way `implement()` did.
 */
function callerId(context: { readonly auth: { readonly user: { readonly id: string } | null } }): string {
    if (context.auth.user === null) throw new ORPCError("UNAUTHORIZED", { message: "Authentication required" });
    return context.auth.user.id;
}
