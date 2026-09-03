import { oc } from "@orpc/contract";
import { deploymentListContract } from "./list";
import {
    deploymentFindByIdContract,
    deploymentDeleteContract,
    deploymentTriggerContract,
    deploymentUploadBundleContract,
    deploymentCancelContract,
    deploymentRollbackContract,
    deploymentGetLogsContract,
    deploymentRetryContract,
    deploymentGetRollbackHistoryContract,
} from "./crud";
import {
    deploymentStreamContract,
    deploymentInternalStreamContract,
    serviceDeploymentsStreamContract,
    deploymentQueryStreamContract,
    deploymentStreamsListContract,
    deploymentStreamFindByIdContract,
} from "./stream";
import {
    deploymentGetTemplateProvenanceByRunContract,
    deploymentGetTemplateProvenanceContract,
    deploymentUpsertTemplateProvenanceContract,
} from "./provenance";
import {
    deploymentCreateCompiledPlanSnapshotContract,
    deploymentGetCompiledPlanSnapshotByRunContract,
    deploymentGetCompiledPlanSnapshotContract,
    deploymentListCompiledPlanSnapshotsContract,
} from "./plan-snapshot";
import {
    deploymentCompilePlanContract,
    deploymentCompilePlanPreviewContract,
    deploymentCompileRollbackEdgesContract,
} from "./compiler";
import {
    deploymentQueueClaimJobsContract,
    deploymentQueueCompleteJobContract,
    deploymentQueueEnqueueJobContract,
    deploymentQueueFailJobContract,
    deploymentQueueFindJobByIdContract,
    deploymentQueueListJobsContract,
    deploymentQueueFindDeadLetterJobByIdContract,
    deploymentQueueHeartbeatJobContract,
    deploymentQueueListDeadLetterJobsContract,
    deploymentQueueReplayDeadLetterJobContract,
} from "./queue";
import {
    deploymentApplyPhaseTransitionContract,
    deploymentListPhaseTransitionsContract,
    deploymentValidatePhaseTransitionContract,
} from "./state-machine";
import {
    deploymentListRetryPoliciesContract,
    deploymentResolveRetryPolicyContract,
} from "./retry-policy";
import {
    deploymentCancelExecutionContract,
    deploymentGetExecutionCheckpointByRunContract,
    deploymentGetExecutionCheckpointContract,
    deploymentResumeExecutionContract,
} from "./execution";
import {
    deploymentEmitNodeLifecycleEventContract,
    deploymentListNodeLifecycleEventsContract,
    deploymentNodeLifecycleEventsStreamContract,
} from "./lifecycle-events";
import { listServicePreviewsContract, promoteServicePreviewContract } from "./previews";

export const deploymentContract = oc.tag("Deployment").prefix("/deployments").router({
    list: deploymentListContract,
    findById: deploymentFindByIdContract,
    listServicePreviews: listServicePreviewsContract,
    promoteServicePreview: promoteServicePreviewContract,
    trigger: deploymentTriggerContract,
    uploadBundle: deploymentUploadBundleContract,
    cancel: deploymentCancelContract,
    rollback: deploymentRollbackContract,
    getLogs: deploymentGetLogsContract,
    delete: deploymentDeleteContract,
    stream: deploymentStreamContract,
    streamInternal: deploymentInternalStreamContract,
    streamService: serviceDeploymentsStreamContract,
    streamQuery: deploymentQueryStreamContract,
    streamsList: deploymentStreamsListContract,
    streamFindById: deploymentStreamFindByIdContract,
    retry: deploymentRetryContract,
    getRollbackHistory: deploymentGetRollbackHistoryContract,
    getTemplateProvenance: deploymentGetTemplateProvenanceContract,
    upsertTemplateProvenance: deploymentUpsertTemplateProvenanceContract,
    getTemplateProvenanceByRun: deploymentGetTemplateProvenanceByRunContract,
    createCompiledPlanSnapshot: deploymentCreateCompiledPlanSnapshotContract,
    listCompiledPlanSnapshots: deploymentListCompiledPlanSnapshotsContract,
    getCompiledPlanSnapshot: deploymentGetCompiledPlanSnapshotContract,
    getCompiledPlanSnapshotByRun: deploymentGetCompiledPlanSnapshotByRunContract,
    compilePlan: deploymentCompilePlanContract,
    compilePlanPreview: deploymentCompilePlanPreviewContract,
    compileRollbackEdges: deploymentCompileRollbackEdgesContract,
    queueEnqueueJob: deploymentQueueEnqueueJobContract,
    queueClaimJobs: deploymentQueueClaimJobsContract,
    queueHeartbeatJob: deploymentQueueHeartbeatJobContract,
    queueCompleteJob: deploymentQueueCompleteJobContract,
    queueFailJob: deploymentQueueFailJobContract,
    queueFindJobById: deploymentQueueFindJobByIdContract,
    queueListJobs: deploymentQueueListJobsContract,
    queueListDeadLetterJobs: deploymentQueueListDeadLetterJobsContract,
    queueFindDeadLetterJobById: deploymentQueueFindDeadLetterJobByIdContract,
    queueReplayDeadLetterJob: deploymentQueueReplayDeadLetterJobContract,
    listRetryPolicies: deploymentListRetryPoliciesContract,
    resolveRetryPolicy: deploymentResolveRetryPolicyContract,
    cancelExecution: deploymentCancelExecutionContract,
    resumeExecution: deploymentResumeExecutionContract,
    getExecutionCheckpoint: deploymentGetExecutionCheckpointContract,
    getExecutionCheckpointByRun: deploymentGetExecutionCheckpointByRunContract,
    emitNodeLifecycleEvent: deploymentEmitNodeLifecycleEventContract,
    listNodeLifecycleEvents: deploymentListNodeLifecycleEventsContract,
    streamNodeLifecycleEvents: deploymentNodeLifecycleEventsStreamContract,
    listPhaseTransitions: deploymentListPhaseTransitionsContract,
    validatePhaseTransition: deploymentValidatePhaseTransitionContract,
    applyPhaseTransition: deploymentApplyPhaseTransitionContract,
});

export type DeploymentContract = typeof deploymentContract;

export * from "./list";
export * from "./crud";
export * from "./previews";
export * from "./stream";
export * from "./provenance";
export * from "./plan-snapshot";
export * from "./compiler";
export * from "./queue";
export * from "./retry-policy";
export * from "./execution";
export * from "./lifecycle-events";
export * from "./state-machine";
