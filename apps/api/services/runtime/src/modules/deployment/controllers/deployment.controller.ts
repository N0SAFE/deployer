import { Controller } from "@nestjs/common";
import { ORPCError } from "@orpc/client";
import { Implement } from "@orpc/nest";

import type { PlatformRole } from "@deployer/auth";
import { procedure } from "@deployer/nest-effect";
import { deploymentContract } from "@deployer/runtime-contracts";
import { authMiddleware, requireAuth, requireMesh, requirePlatformRole, requireSystemActor } from "@deployer/shared/core/modules/auth/orpc/middlewares";

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

    private static resolvePlatformRole(context: unknown): PlatformRole | null {
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
                return yield* trigger.trigger(input, context.systemActor.deliveryId);
            });
    }

    @Implement(deploymentContract.list)
    list() {
        return procedure(deploymentContract.list)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.listDeployments(input.query);
            });
    }

    @Implement(deploymentContract.listServicePreviews)
    listServicePreviews() {
        return procedure(deploymentContract.listServicePreviews)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.listServicePreviews(input.params.serviceId);
            });
    }

    @Implement(deploymentContract.promoteServicePreview)
    promoteServicePreview() {
        return procedure(deploymentContract.promoteServicePreview)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.promoteServicePreview(
                        input.params.serviceId,
                        input.body.previewName,
                        callerId(context),
                        DeploymentController.resolvePlatformRole(context),
                    )
                ;
            });
    }

    @Implement(deploymentContract.findById)
    findById() {
        return procedure(deploymentContract.findById)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.getDeploymentById(input.params.id);
            });
    }

    @Implement(deploymentContract.trigger)
    trigger() {
        return procedure(deploymentContract.trigger)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const deployments = yield* DeploymentService;
                const deployment = yield* deployments.triggerDeployment(input, callerId(context), DeploymentController.resolvePlatformRole(context))
                ;
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
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.uploadBundle({ file: input.file, fileName: input.fileName });
            });
    }

    @Implement(deploymentContract.cancel)
    cancel() {
        return procedure(deploymentContract.cancel)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const deployments = yield* DeploymentService;
                const result = yield* deployments.cancelDeployment(
                        input.params.id,
                        callerId(context),
                        input.body?.reason,
                        DeploymentController.resolvePlatformRole(context),
                    )
                ;
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
            .effect(function* ({ input, context }) {
                const deployments = yield* DeploymentService;
                const rollback = yield* deployments.rollbackDeployment(
                        input.params.id,
                        input.body.targetDeploymentId,
                        callerId(context),
                        input.body.reason,
                        DeploymentController.resolvePlatformRole(context),
                    )
                ;
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
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.getDeploymentLogs(
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
            .effect(function* ({ input, context }) {
                const deployments = yield* DeploymentService;
                const retry = yield* deployments.retryDeployment(input.params.id, callerId(context), DeploymentController.resolvePlatformRole(context))
                ;
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
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.getRollbackHistory(input.params.id);
            });
    }

    @Implement(deploymentContract.stream)
    stream() {
        return procedure(deploymentContract.stream)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .effect(function* ({ input }) {
                const orchestrator = yield* DeploymentStreamOrchestratorService;
                return yield* orchestrator.openDeploymentStream({
                        deploymentId: input.params.id,
                        replay: input.query.replay,
                        replayLimit: input.query.replayLimit,
                    })
                ;
            });
    }

    @Implement(deploymentContract.streamInternal)
    streamInternal() {
        return procedure(deploymentContract.streamInternal)
            .use(requireMesh())
            .use(requireAuth())
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return deployments.streamDeploymentEvents({
                    deploymentId: input.params.id,
                    replay: input.query.replay,
                    replayLimit: input.query.replayLimit,
                });
            });
    }

    @Implement(deploymentContract.streamService)
    streamService() {
        return procedure(deploymentContract.streamService)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return deployments.streamServiceEvents({
                    serviceId: input.params.serviceId,
                    replay: input.query.replay,
                    replayLimit: input.query.replayLimit,
                });
            });
    }

    @Implement(deploymentContract.streamQuery)
    streamQuery() {
        return procedure(deploymentContract.streamQuery)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return deployments.streamQueryEvents({
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
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.listStreamDefinitions(input.query);
            });
    }

    @Implement(deploymentContract.streamFindById)
    streamFindById() {
        return procedure(deploymentContract.streamFindById)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.getStreamDefinitionById(input.params.id);
            });
    }

    @Implement(deploymentContract.getTemplateProvenance)
    getTemplateProvenance() {
        return procedure(deploymentContract.getTemplateProvenance)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.getTemplateProvenance(input.params.id);
            });
    }

    @Implement(deploymentContract.upsertTemplateProvenance)
    upsertTemplateProvenance() {
        return procedure(deploymentContract.upsertTemplateProvenance)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.upsertTemplateProvenance(input.params.id, input.body);
            });
    }

    @Implement(deploymentContract.getTemplateProvenanceByRun)
    getTemplateProvenanceByRun() {
        return procedure(deploymentContract.getTemplateProvenanceByRun)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.getTemplateProvenanceByRun(input.params.runId);
            });
    }

    @Implement(deploymentContract.createCompiledPlanSnapshot)
    createCompiledPlanSnapshot() {
        return procedure(deploymentContract.createCompiledPlanSnapshot)
            .use(authMiddleware())
            .use(requireAuth())
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.createCompiledPlanSnapshot(input.params.id, input.body);
            });
    }

    @Implement(deploymentContract.listCompiledPlanSnapshots)
    listCompiledPlanSnapshots() {
        return procedure(deploymentContract.listCompiledPlanSnapshots)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.listCompiledPlanSnapshots(input.params.id);
            });
    }

    @Implement(deploymentContract.getCompiledPlanSnapshot)
    getCompiledPlanSnapshot() {
        return procedure(deploymentContract.getCompiledPlanSnapshot)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.getCompiledPlanSnapshot(input.params.snapshotId);
            });
    }

    @Implement(deploymentContract.getCompiledPlanSnapshotByRun)
    getCompiledPlanSnapshotByRun() {
        return procedure(deploymentContract.getCompiledPlanSnapshotByRun)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.getCompiledPlanSnapshotByRun(input.params.runId);
            });
    }

    @Implement(deploymentContract.compilePlan)
    compilePlan() {
        return procedure(deploymentContract.compilePlan)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.compilePlan(input);
            });
    }

    @Implement(deploymentContract.compilePlanPreview)
    compilePlanPreview() {
        return procedure(deploymentContract.compilePlanPreview)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.compilePlan(input);
            });
    }

    @Implement(deploymentContract.compileRollbackEdges)
    compileRollbackEdges() {
        return procedure(deploymentContract.compileRollbackEdges)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.compileRollbackEdges(input);
            });
    }

    @Implement(deploymentContract.queueEnqueueJob)
    queueEnqueueJob() {
        return procedure(deploymentContract.queueEnqueueJob)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.enqueueQueueJob(input);
            });
    }

    @Implement(deploymentContract.queueClaimJobs)
    queueClaimJobs() {
        return procedure(deploymentContract.queueClaimJobs)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.claimQueueJobs(input);
            });
    }

    @Implement(deploymentContract.queueHeartbeatJob)
    queueHeartbeatJob() {
        return procedure(deploymentContract.queueHeartbeatJob)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.heartbeatQueueJob(input.params.jobId, input.body);
            });
    }

    @Implement(deploymentContract.queueCompleteJob)
    queueCompleteJob() {
        return procedure(deploymentContract.queueCompleteJob)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.completeQueueJob(input.params.jobId, input.body);
            });
    }

    @Implement(deploymentContract.queueFailJob)
    queueFailJob() {
        return procedure(deploymentContract.queueFailJob)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.failQueueJob(input.params.jobId, input.body);
            });
    }

    @Implement(deploymentContract.queueFindJobById)
    queueFindJobById() {
        return procedure(deploymentContract.queueFindJobById)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.findQueueJobById(input.params.jobId);
            });
    }

    @Implement(deploymentContract.queueListJobs)
    queueListJobs() {
        return procedure(deploymentContract.queueListJobs)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.listQueueJobs(input.query);
            });
    }

    @Implement(deploymentContract.queueListDeadLetterJobs)
    queueListDeadLetterJobs() {
        return procedure(deploymentContract.queueListDeadLetterJobs)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.listDeadLetterJobs(input.query);
            });
    }

    @Implement(deploymentContract.queueFindDeadLetterJobById)
    queueFindDeadLetterJobById() {
        return procedure(deploymentContract.queueFindDeadLetterJobById)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.findDeadLetterJobById(input.params.deadLetterJobId);
            });
    }

    @Implement(deploymentContract.queueReplayDeadLetterJob)
    queueReplayDeadLetterJob() {
        return procedure(deploymentContract.queueReplayDeadLetterJob)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.replayDeadLetterJob(input);
            });
    }

    @Implement(deploymentContract.listRetryPolicies)
    listRetryPolicies() {
        return procedure(deploymentContract.listRetryPolicies)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.listRetryPolicies(input.query);
            });
    }

    @Implement(deploymentContract.resolveRetryPolicy)
    resolveRetryPolicy() {
        return procedure(deploymentContract.resolveRetryPolicy)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.resolveRetryPolicy(input);
            });
    }

    @Implement(deploymentContract.cancelExecution)
    cancelExecution() {
        return procedure(deploymentContract.cancelExecution)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.cancelExecution(input.params.id, input.body);
            });
    }

    @Implement(deploymentContract.resumeExecution)
    resumeExecution() {
        return procedure(deploymentContract.resumeExecution)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.resumeExecution(input.params.id, input.body);
            });
    }

    @Implement(deploymentContract.getExecutionCheckpoint)
    getExecutionCheckpoint() {
        return procedure(deploymentContract.getExecutionCheckpoint)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.getExecutionCheckpoint(input.params.id);
            });
    }

    @Implement(deploymentContract.getExecutionCheckpointByRun)
    getExecutionCheckpointByRun() {
        return procedure(deploymentContract.getExecutionCheckpointByRun)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.getExecutionCheckpointByRun(input.params.runId);
            });
    }

    @Implement(deploymentContract.emitNodeLifecycleEvent)
    emitNodeLifecycleEvent() {
        return procedure(deploymentContract.emitNodeLifecycleEvent)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.emitNodeLifecycleEvent(input.params.runId, input.body);
            });
    }

    @Implement(deploymentContract.listNodeLifecycleEvents)
    listNodeLifecycleEvents() {
        return procedure(deploymentContract.listNodeLifecycleEvents)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.listNodeLifecycleEvents(input.params.runId, input.query);
            });
    }

    @Implement(deploymentContract.streamNodeLifecycleEvents)
    streamNodeLifecycleEvents() {
        return procedure(deploymentContract.streamNodeLifecycleEvents)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return deployments.streamNodeLifecycleEvents({
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
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.listPhaseTransitions(input.query ?? {});
            });
    }

    @Implement(deploymentContract.validatePhaseTransition)
    validatePhaseTransition() {
        return procedure(deploymentContract.validatePhaseTransition)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.validatePhaseTransition(input);
            });
    }

    @Implement(deploymentContract.applyPhaseTransition)
    applyPhaseTransition() {
        return procedure(deploymentContract.applyPhaseTransition)
            .use(requireAuth())
            .use(requirePlatformRole(["superAdmin", "admin", "operator"]))
            .effect(function* ({ input }) {
                const deployments = yield* DeploymentService;
                return yield* deployments.applyPhaseTransition(input.params.id, input.body);
            });
    }

    @Implement(deploymentContract.delete)
    delete() {
        return procedure(deploymentContract.delete)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const deployments = yield* DeploymentService;
                yield* deployments.deleteDeployment(
                        input.params.id,
                        callerId(context),
                        DeploymentController.resolvePlatformRole(context),
                    )
                ;
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
