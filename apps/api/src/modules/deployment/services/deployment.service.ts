import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { OnModuleInit } from "@nestjs/common";
import { DeploymentRepository } from "../repositories/deployment.repository";
import { ProjectAccessService } from "@/core/modules/project/services/project-access.service";
import { DeploymentEventService } from "../events/deployment-event.service";
import {
    EMPTY,
    Observable,
    concat,
    defer,
    filter as rxFilter,
    from,
    map,
    merge,
    mergeMap,
} from "rxjs";
import { CoreEventSyncService } from "@/core/modules/events";
import { createHash, randomUUID } from "crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SourceProviderRegistryService } from "../providers/source-provider-registry.service";
import { DeploymentExecutionWorkflowService } from "./deployment-execution-workflow.service";
import { DeploymentQueueLifecycleService } from "../queue/deployment-queue-lifecycle.service";
import { DeploymentBullQueueService } from "../queue/deployment-bull-queue.service";
import { StorageProviderRegistryService } from "../storage/storage-provider-registry.service";
import { StoragePolicyResolverRegistryService } from "../storage/policy/storage-policy-resolver-registry.service";
import { runtimeConfigurationAccessor } from "@/core/modules/configuration/services/runtime-configuration-accessor";
import { DeploymentProviderBuilderRunnerStateMachineService } from "@/core/modules/deployment/services/deployment-provider-builder-runner-state-machine.service";
import type { DeploymentStateMachineScopeConfigInput } from "@/core/modules/deployment/services/deployment-provider-builder-runner-state-machine.service";
import { deploymentRunnerKindSchema } from "@/core/modules/deployment/services/deployment-provider-builder-runner-state-machine.service";
import type { ResolvedRuntimeConfiguration } from "@/core/modules/configuration/schemas/runtime-configuration.schema";
import { UploadBundleRegistryService } from "../providers/upload/upload-bundle-registry.service";
import type { DeploymentListInput } from "@repo/api-contracts/modules/deployment/list";
import type { DeploymentTriggerInput } from "@repo/api-contracts/modules/deployment/crud";
import type { PlatformRole, ProjectRole } from "@repo/auth";
import type {
    DeploymentProgressEvent,
    DeploymentQueryEvent,
    DeploymentStreamListInput,
    ServiceDeploymentEvent,
} from "@repo/api-contracts/modules/deployment/stream";
import type {
    DeploymentStatus,
    DeploymentLog,
    DeploymentCompileRollbackEdgesInput,
    DeploymentCompileRollbackEdgesResult,
    DeploymentCompiledPlan,
    DeploymentCompiledPlanSnapshot,
    DeploymentDeadLetterJob,
    DeploymentDeadLetterListInput,
    DeploymentDeadLetterListResult,
    DeploymentDeadLetterReplayInput,
    DeploymentDeadLetterReplayResult,
    DeploymentExecutionCancelInput,
    DeploymentExecutionCancelResult,
    DeploymentExecutionCheckpoint,
    DeploymentExecutionCheckpointByRunResult,
    DeploymentExecutionResumeInput,
    DeploymentExecutionResumeResult,
    DeploymentNodeLifecycleEvent,
    DeploymentNodeLifecycleEventEmitInput,
    DeploymentNodeLifecycleEventEmitResult,
    DeploymentNodeLifecycleEventListInput,
    DeploymentNodeLifecycleEventListResult,
    DeploymentPhaseTransition,
    DeploymentPhaseTransitionApplyInput,
    DeploymentPhaseTransitionApplyResult,
    DeploymentPhaseTransitionValidationInput,
    DeploymentPhaseTransitionValidationResult,
    DeploymentPlanCompileInput,
    DeploymentPlanCompileResult,
    DeploymentQueueClaimInput,
    DeploymentQueueClaimResult,
    DeploymentQueueCompleteInput,
    DeploymentQueueEnqueueInput,
    DeploymentQueueEnqueueResult,
    DeploymentQueueFailInput,
    DeploymentQueueHeartbeatInput,
    DeploymentQueueHeartbeatResult,
    DeploymentQueueJob,
    DeploymentQueueListInput,
    DeploymentQueueListResult,
    DeploymentQueueTransitionResult,
    DeploymentRetryPolicy,
    DeploymentRetryPolicyListInput,
    DeploymentRetryPolicyResolveInput,
    DeploymentRetryPolicyResolveResult,
    DeploymentTemplateProvenance,
    DeploymentTemplateProvenanceByRunResult,
    DeploymentTemplateProvenanceUpsertInput,
    DeploymentTemplateProvenanceUpsertResult,
    DeploymentCompiledPlanSnapshotByRunResult,
    DeploymentCreateCompiledPlanSnapshotInput,
    DeploymentCreateCompiledPlanSnapshotResult,
    DeploymentListCompiledPlanSnapshotsResult,
    DeploymentPhaseTransitionsCatalog,
    DeploymentStreamEventType,
} from "@repo/contracts-entities";


/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys. Used in place of `as Record<string, unknown>`
 * to avoid the runtime lie.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
const CANCELLABLE_STATUSES = ["pending", "queued", "building", "deploying"] as const;

interface StreamReplayInput {
    replay: boolean;
    replayLimit: number;
}

type StreamEventWithMeta<T extends object> = T & {
    sequence: number;
    cursor: string;
    replayed: boolean;
    emittedAt: Date;
};

const BASE_PHASE_TRANSITIONS: DeploymentPhaseTransition[] = [
    { from: "queued", to: "pulling_source", allowed: true, guards: ["requiresNoCancellation"], reason: null },
    { from: "pulling_source", to: "building", allowed: true, guards: ["requiresActiveLease"], reason: null },
    { from: "building", to: "copying_files", allowed: true, guards: ["requiresCompiledPlan"], reason: null },
    { from: "copying_files", to: "creating_symlinks", allowed: true, guards: ["requiresCompiledPlan"], reason: null },
    { from: "creating_symlinks", to: "updating_routes", allowed: true, guards: ["requiresRouteSync"], reason: null },
    { from: "updating_routes", to: "health_check", allowed: true, guards: ["requiresRouteSync"], reason: null },
    { from: "health_check", to: "active", allowed: true, guards: ["requiresHealthyDependencies"], reason: null },
    { from: "queued", to: "failed", allowed: true, guards: [], reason: null },
    { from: "pulling_source", to: "failed", allowed: true, guards: [], reason: null },
    { from: "building", to: "failed", allowed: true, guards: [], reason: null },
    { from: "copying_files", to: "failed", allowed: true, guards: [], reason: null },
    { from: "creating_symlinks", to: "failed", allowed: true, guards: [], reason: null },
    { from: "updating_routes", to: "failed", allowed: true, guards: [], reason: null },
    { from: "health_check", to: "failed", allowed: true, guards: [], reason: null },
];

const BASE_RETRY_POLICIES: DeploymentRetryPolicy[] = [
    {
        id: "deploy-default",
        label: "Default deploy execution retry",
        jobType: "deploy",
        taskType: "execute",
        maxAttempts: 5,
        strategy: "exponential_jitter",
        initialBackoffMs: 1_000,
        maxBackoffMs: 60_000,
        multiplier: 2,
        jitterRatio: 0.2,
        retryableErrorCodes: ["NETWORK", "TIMEOUT", "RATE_LIMIT"],
        nonRetryableErrorCodes: ["VALIDATION", "PERMISSION_DENIED"],
        enabled: true,
        metadata: null,
    },
    {
        id: "health-check-monitor",
        label: "Health check monitor retry",
        nodeType: "health",
        taskType: "monitor",
        maxAttempts: 6,
        strategy: "linear",
        initialBackoffMs: 2_000,
        maxBackoffMs: 20_000,
        multiplier: 1,
        jitterRatio: 0,
        retryableErrorCodes: ["HEALTH_UNSTABLE", "HEALTH_TIMEOUT"],
        nonRetryableErrorCodes: ["IMAGE_MISSING"],
        enabled: true,
        metadata: null,
    },
];

@Injectable()
export class DeploymentService implements OnModuleInit {
    private static readonly DEPLOYMENT_MUTATION_PLATFORM_ROLES: readonly PlatformRole[] = [
        "superAdmin",
        "admin",
        "operator",
    ];
    private readonly templateProvenanceByDeployment = new Map<string, DeploymentTemplateProvenance>();
    private readonly templateProvenanceByRun = new Map<string, DeploymentTemplateProvenance[]>();
    private readonly compiledSnapshotsById = new Map<string, DeploymentCompiledPlanSnapshot>();
    private readonly compiledSnapshotsByDeployment = new Map<string, DeploymentCompiledPlanSnapshot[]>();
    private readonly compiledSnapshotsByRun = new Map<string, DeploymentCompiledPlanSnapshot>();
    private readonly queueJobs: Map<string, DeploymentQueueJob>;
    private readonly deadLetterJobs: Map<string, DeploymentDeadLetterJob>;
    private readonly executionCheckpointsByDeployment = new Map<string, DeploymentExecutionCheckpoint>();
    private readonly executionCheckpointsByRun = new Map<string, DeploymentExecutionCheckpoint>();
    private readonly nodeLifecycleByRun = new Map<string, DeploymentNodeLifecycleEvent[]>();

    constructor(
        private readonly deploymentRepository: DeploymentRepository,
        private readonly deploymentEventService: DeploymentEventService,
        private readonly coreEventSyncService: CoreEventSyncService,
        private readonly sourceProviderRegistryService: SourceProviderRegistryService,
        private readonly storageProviderRegistryService: StorageProviderRegistryService,
        private readonly storagePolicyResolverRegistryService: StoragePolicyResolverRegistryService,
        private readonly deploymentExecutionWorkflowService: DeploymentExecutionWorkflowService,
        private readonly deploymentQueueLifecycleService: DeploymentQueueLifecycleService,
        private readonly deploymentBullQueueService: DeploymentBullQueueService,
        private readonly deploymentStateMachineService: DeploymentProviderBuilderRunnerStateMachineService,
        private readonly uploadBundleRegistryService: UploadBundleRegistryService,
        private readonly projectAccessService: ProjectAccessService,
    ) {
        this.queueJobs = this.deploymentQueueLifecycleService.getQueueJobsStore();
        this.deadLetterJobs = this.deploymentQueueLifecycleService.getDeadLetterJobsStore();
    }

    onModuleInit(): void {
        this.coreEventSyncService.registerNamespaceAdapter("deployment", ({ definition, replay, replayLimit }) =>
            this.toCoreAdapterStream(definition, replay, replayLimit),
        );
    }

    async uploadBundle(input: { file: File; fileName?: string }) {
        const preferredFileName =
            typeof input.fileName === "string" && input.fileName.trim().length > 0
                ? input.fileName.trim()
                : input.file.name;
        const normalizedFileName = path.basename(preferredFileName);
        const extension = path.extname(normalizedFileName).toLowerCase();
        const allowedExtensions = new Set([".zip", ".tar", ".tgz", ".gz"]);

        if (!allowedExtensions.has(extension)) {
            throw new BadRequestException(
                "Unsupported archive format. Allowed formats are: .zip, .tar, .tgz, .gz",
            );
        }

        const uploadId = randomUUID();
        const uploadsDir = process.env.DEPLOYMENT_UPLOAD_DIR ?? "/tmp/deployer-uploads";
        const targetPath = path.join(uploadsDir, `${uploadId}-${normalizedFileName}`);

        await mkdir(uploadsDir, { recursive: true });
        const bytes = Buffer.from(await input.file.arrayBuffer());
        await writeFile(targetPath, bytes);

        this.uploadBundleRegistryService.register({
            uploadId,
            uploadPath: targetPath,
            fileName: normalizedFileName,
            fileSize: bytes.byteLength,
            mimeType: input.file.type || "application/octet-stream",
        });

        return {
            uploadId,
            uploadPath: targetPath,
            fileName: normalizedFileName,
            fileSize: bytes.byteLength,
            mimeType: input.file.type || "application/octet-stream",
        };
    }

    async listDeployments(input: DeploymentListInput) {
        return this.deploymentRepository.findMany(input);
    }

    async getDeploymentById(id: string) {
        const deployment = await this.deploymentRepository.findById(id);
        if (!deployment) {
            throw new NotFoundException(`Deployment with id '${id}' not found`);
        }
        return deployment;
    }

    private async assertDeploymentServiceAccess(
        serviceId: string,
        requesterId: string,
        allowedRoles: readonly ProjectRole[],
        requesterPlatformRole: PlatformRole | null = null,
    ): Promise<void> {
        if (
            requesterPlatformRole !== null &&
            DeploymentService.DEPLOYMENT_MUTATION_PLATFORM_ROLES.includes(requesterPlatformRole)
        ) {
            return;
        }

        const projectId = await this.deploymentRepository.getServiceProjectId(serviceId);
        if (!projectId) {
            throw new NotFoundException(`Service '${serviceId}' not found`);
        }
        const project = await this.projectAccessService.findProjectById(projectId);
        if (!project) {
            throw new NotFoundException(`Project '${projectId}' not found`);
        }
        if (project.ownerId === requesterId) {
            return;
        }
        const collaborator = await this.projectAccessService.findCollaboratorByUserAndProject(
            requesterId,
            projectId,
        );
        if (!collaborator || !allowedRoles.includes(collaborator.role)) {
            throw new ForbiddenException("You do not have permission to perform this action");
        }
    }

    async triggerDeployment(
        input: DeploymentTriggerInput,
        userId: string,
        actorPlatformRole: PlatformRole | null = null,
    ) {
        await this.assertDeploymentServiceAccess(input.serviceId, userId, [
            "owner",
            "maintainer",
            "deployer",
        ], actorPlatformRole);
        const runtimeConfigurationSeed =
            await this.deploymentRepository.getRuntimeConfigurationSeed(input.serviceId);

        if (!runtimeConfigurationSeed) {
            throw new NotFoundException(`Service '${input.serviceId}' not found`);
        }

        const serviceDependencies = await this.deploymentRepository.getServiceDependencies(input.serviceId);
        const crossProjectDependency = serviceDependencies.find(
            (dependency) => dependency.dependsOnProjectId !== runtimeConfigurationSeed.projectId,
        );

        if (crossProjectDependency) {
            throw new BadRequestException(
                `Service dependency '${crossProjectDependency.dependsOnServiceId}' belongs to a different project and cannot be deployed together`,
            );
        }

        const resolvedRuntimeConfiguration = runtimeConfigurationAccessor.resolveForDeployment({
            serviceId: input.serviceId,
            projectId: runtimeConfigurationSeed.projectId,
            environment: input.environment,
            sourceType: input.sourceType,
            projectSettings: runtimeConfigurationSeed.projectSettings,
            serviceRecord: runtimeConfigurationSeed.service,
        });
        const stateMachineScopeConfig = this.buildStateMachineScopeConfig(resolvedRuntimeConfiguration);

        if (!resolvedRuntimeConfiguration.effective.constraints.canDeployToRequestedEnvironment) {
            throw new BadRequestException(
                resolvedRuntimeConfiguration.effective.constraints.reason ??
                    "Deployment is blocked by runtime configuration",
            );
        }

        if (!resolvedRuntimeConfiguration.effective.constraints.providerAllowed) {
            throw new BadRequestException("Deployment source provider is not allowed by runtime configuration");
        }

        if (!resolvedRuntimeConfiguration.effective.constraints.runnerAllowed) {
            throw new BadRequestException("Deployment runner is not allowed by runtime configuration");
        }

        if (input.environment === "preview") {
            const previewTransition = this.deploymentStateMachineService.evaluatePreviewTransition(
                {
                    operation: "create",
                    environment: input.environment,
                    resolvedPreviewEnabled: resolvedRuntimeConfiguration.effective.deployment.previewEnabled,
                },
                stateMachineScopeConfig,
            );

            if (!previewTransition.canProceed) {
                throw new BadRequestException(
                    previewTransition.violations.map((violation) => violation.message).join(" "),
                );
            }
        }

        const sourceCheckout = await this.sourceProviderRegistryService.resolveSourceCheckout(input);
        const serviceStorageConfig = this.storagePolicyResolverRegistryService.resolveServiceStorageConfig({
            serviceId: input.serviceId,
            serviceMetadata: resolvedRuntimeConfiguration.service.metadata,
            sourceConfig: input.sourceConfig,
            runtimeConfiguration: resolvedRuntimeConfiguration,
        });
        const storageBinding = await this.storageProviderRegistryService.resolveStorageBinding(
            input,
            serviceStorageConfig,
        );

        const requestedRuntimeRunnerFromSource =
            sourceCheckout && "runtimeRunner" in sourceCheckout
                ? sourceCheckout.runtimeRunner
                : null;
        const requestedRuntimeRunnerCandidate = input.execution?.runner ?? requestedRuntimeRunnerFromSource ?? null;
        const requestedRuntimeRunner = requestedRuntimeRunnerCandidate
            ? deploymentRunnerKindSchema.parse(requestedRuntimeRunnerCandidate)
            : null;
        const requestedBuilder = input.execution?.builder ?? null;
        const requestedContainerImage =
            sourceCheckout && "containerImage" in sourceCheckout
                ? sourceCheckout.containerImage
                : null;
        const stateMachine = this.deploymentStateMachineService.evaluate({
            provider: sourceCheckout?.provider ?? "upload",
            builder: requestedBuilder,
            runner: requestedRuntimeRunner,
            hasContainerImage: Boolean(requestedContainerImage?.trim()),
            hasCustomBuildCommand: Boolean(input.execution?.customCommands?.buildCommand?.trim()),
            hasCustomRunCommand: Boolean(input.execution?.customCommands?.runCommand?.trim()),
        }, stateMachineScopeConfig);

        if (!stateMachine.canProceed) {
            throw new BadRequestException(stateMachine.violations.map((violation) => violation.message).join(" "));
        }

        const resolvedBuilder = stateMachine.normalizedBuilder;
        const resolvedRuntimeRunner = stateMachine.normalizedRunner;

        if (
            resolvedRuntimeRunner === "dockerfile" &&
            (!requestedContainerImage || requestedContainerImage.trim().length === 0) &&
            !resolvedBuilder
        ) {
            const sourceProvider = sourceCheckout?.provider ?? input.sourceType;
            throw new BadRequestException(
                `${sourceProvider} source with runtimeRunner 'dockerfile' requires either an explicit containerImage or compatible execution.builder`,
            );
        }

        const correlationId = randomUUID();

        const deployment = await this.deploymentRepository.create({
            serviceId: input.serviceId,
            triggeredBy: userId,
            environment: input.environment,
            sourceType: input.sourceType,
            sourceConfig: input.sourceConfig,
        });

        await this.deploymentRepository.insertLog(deployment.id, {
            level: "info",
            message: "Source provider checkout resolved",
            phase: "queued",
            step: "checkout_resolved",
            stage: "provider",
            correlationId,
            metadata: {
                provider: sourceCheckout?.provider ?? input.sourceType,
                resolvedBuilder,
                resolvedRuntimeRunner,
                hasStorageBinding: Boolean(storageBinding),
                structured: true,
            },
        });

        await this.emitLifecycleQueued(deployment, null, "Deployment queued");

        this.enqueueQueueJob({
            type: "deploy",
            idempotencyKey: `deploy:${deployment.id}:trigger`,
            payload: {
                deploymentId: deployment.id,
                serviceId: deployment.serviceId,
                projectId: runtimeConfigurationSeed.projectId,
                environment: deployment.environment,
                observability: {
                    correlationId,
                    source: "deployment.trigger",
                },
                context: {
                    sourceType: deployment.sourceType,
                    triggeredBy: userId,
                    correlationId,
                    executionPlan: {
                        builder: resolvedBuilder,
                        runner: resolvedRuntimeRunner,
                        runtimeRunnerOptions: input.execution?.runtimeRunnerOptions ?? null,
                        customCommands: input.execution?.customCommands ?? null,
                        healthChecks: input.execution?.healthChecks ?? null,
                    },
                    ...(sourceCheckout ? { sourceCheckout } : {}),
                    storageBinding,
                    dependencyGraph: {
                        serviceId: input.serviceId,
                        dependencies: serviceDependencies.map((dependency) => ({
                            dependsOnServiceId: dependency.dependsOnServiceId,
                            isRequired: dependency.isRequired,
                        })),
                        requiredServiceIds: serviceDependencies
                            .filter((dependency) => dependency.isRequired)
                            .map((dependency) => dependency.dependsOnServiceId),
                    },
                    runtimeConfiguration: resolvedRuntimeConfiguration.effective,
                },
            },
            maxAttempts: 5,
            metadata: {
                reason: "deployment_trigger",
                source: "deployment.trigger",
            },
        });

        return deployment;
    }

    async cancelDeployment(id: string, requesterId: string, reason?: string, actorPlatformRole: PlatformRole | null = null) {
        const deployment = await this.getDeploymentById(id);
        await this.assertDeploymentServiceAccess(deployment.serviceId, requesterId, [
            "owner",
            "maintainer",
            "deployer",
        ], actorPlatformRole);
        if (!CANCELLABLE_STATUSES.includes(deployment.status as (typeof CANCELLABLE_STATUSES)[number])) {
            throw new BadRequestException(
                `Cannot cancel deployment with status '${deployment.status}'. ` +
                    `Only ${CANCELLABLE_STATUSES.join(", ")} deployments can be cancelled.`,
            );
        }
        const cancelledAt = new Date();
        await this.deploymentRepository.updateStatus(id, "cancelled", {
            cancelReason: reason ?? "user_requested",
            cancelledAt,
        });
        const cancelLog = await this.deploymentRepository.insertLog(id, {
            level: "warn",
            message: "Deployment cancelled",
            phase: "failed",
            stage: "cancel",
            metadata: { reason: reason ?? "user_requested" },
        });
        this.deploymentEventService.emit(
            "statusChanged",
            { deploymentId: id },
            {
                deploymentId: id,
                status: "cancelled",
                previousStatus: deployment.status,
                timestamp: cancelledAt.toISOString(),
            },
        );
        this.deploymentEventService.emit(
            "serviceStatusChanged",
            { serviceId: deployment.serviceId },
            {
                serviceId: deployment.serviceId,
                deploymentId: id,
                status: "cancelled",
                timestamp: cancelledAt.toISOString(),
            },
        );
        this.deploymentEventService.emit(
            "deploymentCancelled",
            { serviceId: deployment.serviceId },
            {
                serviceId: deployment.serviceId,
                deploymentId: id,
                reason: reason,
                timestamp: cancelledAt.toISOString(),
            },
        );
        this.deploymentEventService.emit("logAppended", { deploymentId: id }, cancelLog);
        return { deploymentId: id, cancelledAt };
    }

    async rollbackDeployment(
        fromDeploymentId: string,
        targetDeploymentId: string,
        userId: string,
        reason?: string,
        actorPlatformRole: PlatformRole | null = null,
    ) {
        const [fromDeployment, targetDeployment] = await Promise.all([
            this.getDeploymentById(fromDeploymentId),
            this.getDeploymentById(targetDeploymentId),
        ]);

        await this.assertDeploymentServiceAccess(fromDeployment.serviceId, userId, [
            "owner",
            "maintainer",
            "deployer",
        ], actorPlatformRole);

        if (fromDeployment.serviceId !== targetDeployment.serviceId) {
            throw new BadRequestException("Both deployments must belong to the same service");
        }
        if (targetDeployment.status !== "success") {
            throw new BadRequestException(
                `Target deployment status is '${targetDeployment.status}', must be 'success' to roll back to`,
            );
        }

        const rollbackStateMachineScopeConfig = await this.resolveStateMachineScopeConfigForService({
            serviceId: fromDeployment.serviceId,
            environment: fromDeployment.environment,
            sourceType: targetDeployment.sourceType,
        });
        const rollbackTransition = this.deploymentStateMachineService.evaluateRollbackTransition(
            {
                sourceStatus: fromDeployment.status,
                targetStatus: targetDeployment.status,
                sourceEnvironment: fromDeployment.environment,
                targetEnvironment: targetDeployment.environment,
            },
            rollbackStateMachineScopeConfig,
        );

        if (!rollbackTransition.canProceed) {
            throw new BadRequestException(
                rollbackTransition.violations.map((violation) => violation.message).join(" "),
            );
        }

        const rollback = await this.deploymentRepository.create({
            serviceId: fromDeployment.serviceId,
            triggeredBy: userId,
            environment: fromDeployment.environment,
            sourceType: targetDeployment.sourceType,
            sourceConfig: targetDeployment.sourceConfig ?? undefined,
            metadata: {
                rollbackFrom: fromDeploymentId,
                targetDeploymentId,
                ...(reason ? { rollbackReason: reason } : {}),
            },
        });
        const rollbackRecord = await this.deploymentRepository.createRollback({
            fromDeploymentId,
            toDeploymentId: rollback.id,
            triggeredBy: userId,
            reason: reason ?? null,
            metadata: {
                targetDeploymentId,
            },
        });

        const rollbackProjectId = await this.deploymentRepository.getServiceProjectId(rollback.serviceId);

        await this.emitLifecycleQueued(rollback, fromDeployment.status, "Rollback deployment queued");

        this.enqueueQueueJob({
            type: "rollback",
            idempotencyKey: `rollback:${rollbackRecord.id}`,
            payload: {
                deploymentId: rollback.id,
                serviceId: rollback.serviceId,
                ...(rollbackProjectId ? { projectId: rollbackProjectId } : {}),
                environment: rollback.environment,
                observability: {
                    correlationId: randomUUID(),
                    source: "deployment.rollback",
                },
                context: {
                    rollbackId: rollbackRecord.id,
                    fromDeploymentId,
                    targetDeploymentId,
                },
            },
            maxAttempts: 5,
            metadata: {
                reason: "deployment_rollback",
                source: "deployment.rollback",
            },
        });

        const rollbackLog = await this.deploymentRepository.insertLog(rollback.id, {
            level: "info",
            message: "Rollback deployment queued",
            phase: "queued",
            stage: "rollback",
            metadata: {
                rollbackId: rollbackRecord.id,
                rollbackFrom: fromDeploymentId,
                targetDeploymentId,
                ...(reason ? { reason } : {}),
            },
        });
        const now = new Date().toISOString();
        this.deploymentEventService.emit(
            "deploymentTriggered",
            { serviceId: rollback.serviceId },
            {
                serviceId: rollback.serviceId,
                deployment: rollback,
                timestamp: now,
            },
        );
        this.deploymentEventService.emit(
            "rollbackStarted",
            { serviceId: fromDeployment.serviceId },
            {
                serviceId: fromDeployment.serviceId,
                fromDeploymentId,
                toDeploymentId: rollback.id,
                timestamp: now,
            },
        );
        this.deploymentEventService.emit(
            "serviceStatusChanged",
            { serviceId: rollback.serviceId },
            {
                serviceId: rollback.serviceId,
                deploymentId: rollback.id,
                status: rollback.status,
                timestamp: now,
            },
        );
        this.deploymentEventService.emit(
            "statusChanged",
            { deploymentId: rollback.id },
            {
                deploymentId: rollback.id,
                status: rollback.status,
                previousStatus: null,
                timestamp: now,
            },
        );
        this.deploymentEventService.emit(
            "phaseUpdated",
            { deploymentId: rollback.id },
            {
                deploymentId: rollback.id,
                phase: "queued",
                progress: 0,
                timestamp: now,
            },
        );
        this.deploymentEventService.emit(
            "orchestrationPhaseTransition",
            { deploymentId: rollback.id },
            {
                deploymentId: rollback.id,
                toPhase: "queued",
                progress: 0,
                timestamp: now,
            },
        );
        this.deploymentEventService.emit(
            "metricsSnapshot",
            { deploymentId: rollback.id },
            {
                deploymentId: rollback.id,
                cpuPercent: 0,
                memoryMb: 0,
                networkRxBytes: 0,
                networkTxBytes: 0,
                timestamp: now,
            },
        );
        this.deploymentEventService.emit("logAppended", { deploymentId: rollback.id }, rollbackLog);
        return rollback;
    }

    async getDeploymentLogs(
        deploymentId: string,
        limit: number,
        offset: number,
        filters?: {
            level?: DeploymentLog["level"];
            phase?: string;
            step?: string;
        },
        options?: {
            includeRetrySummary?: boolean;
        },
    ) {
        await this.getDeploymentById(deploymentId); // verify exists
        const [logs, total, buildRetryEvents, deployRetryEvents] = await Promise.all([
            this.deploymentRepository.findLogs(deploymentId, limit, offset, filters),
            this.deploymentRepository.countLogs(deploymentId, filters),
            options?.includeRetrySummary
                ? this.deploymentRepository.countLogs(deploymentId, {
                      step: "build_retry",
                  })
                : Promise.resolve(null),
            options?.includeRetrySummary
                ? this.deploymentRepository.countLogs(deploymentId, {
                      step: "deploy_retry",
                  })
                : Promise.resolve(null),
        ]);

        const retrySummary =
            options?.includeRetrySummary && buildRetryEvents !== null && deployRetryEvents !== null
                ? {
                      scope: "deployment" as const,
                      build: {
                          retryEvents: buildRetryEvents,
                      },
                      deploy: {
                          retryEvents: deployRetryEvents,
                      },
                      totalRetryEvents: buildRetryEvents + deployRetryEvents,
                  }
                : undefined;

        return {
            logs,
            total,
            hasMore: offset + limit < total,
            ...(retrySummary ? { retrySummary } : {}),
        };
    }

    async deleteDeployment(id: string, requesterId: string, actorPlatformRole: PlatformRole | null = null) {
        const deployment = await this.getDeploymentById(id);
        await this.assertDeploymentServiceAccess(
            deployment.serviceId,
            requesterId,
            ["owner", "maintainer"],
            actorPlatformRole,
        );
        await this.deploymentRepository.delete(id);
    }

    async retryDeployment(id: string, userId: string, actorPlatformRole: PlatformRole | null = null) {
        const deployment = await this.getDeploymentById(id);
        await this.assertDeploymentServiceAccess(deployment.serviceId, userId, [
            "owner",
            "maintainer",
            "deployer",
        ], actorPlatformRole);
        const RETRYABLE_STATUSES = ["failed", "cancelled"] as const;
        if (!RETRYABLE_STATUSES.includes(deployment.status as (typeof RETRYABLE_STATUSES)[number])) {
            throw new BadRequestException(
                `Cannot retry deployment with status '${deployment.status}'. Only failed or cancelled deployments can be retried.`,
            );
        }
        const retry = await this.deploymentRepository.create({
            serviceId: deployment.serviceId,
            triggeredBy: userId,
            environment: deployment.environment,
            sourceType: deployment.sourceType,
            sourceConfig: deployment.sourceConfig ?? undefined,
        });
        await this.emitLifecycleQueued(retry, null, "Retry deployment queued");
        // TODO: Queue retry job via orchestration module (not yet migrated)
        return retry;
    }

    async getRollbackHistory(deploymentId: string) {
        await this.getDeploymentById(deploymentId); // verify exists
        const rollbacks = await this.deploymentRepository.findRollbacks(deploymentId);
        return { rollbacks };
    }

    async getDeploymentReplayEvents(deploymentId: string, replayLimit: number): Promise<DeploymentProgressEvent[]> {
        const deployment = await this.getDeploymentById(deploymentId);
        const logs = await this.deploymentRepository.findLogs(deploymentId, replayLimit, 0);

        const events: DeploymentProgressEvent[] = [
            {
                type: "statusChanged",
                status: deployment.status,
                ...(deployment.phase ? { phase: deployment.phase } : {}),
                ...(typeof deployment.phaseProgress === "number"
                    ? { phaseProgress: deployment.phaseProgress }
                    : {}),
            },
            ...(deployment.phase
                ? [
                      {
                          type: "phaseUpdated" as const,
                          phase: deployment.phase,
                          phaseProgress: deployment.phaseProgress ?? 0,
                      },
                  ]
                : []),
            ...logs.map((log) => ({
                type: "logAppended" as const,
                log,
            })),
        ];

        return events;
    }

    async getServiceReplayEvents(serviceId: string, replayLimit: number): Promise<ServiceDeploymentEvent[]> {
        const deployments = await this.deploymentRepository.findRecentDeployments({ serviceId }, replayLimit);

        const events: ServiceDeploymentEvent[] = [];

        for (const item of deployments) {
            const deployment = item.deployment;
            events.push({ type: "deploymentTriggered", deployment });
            events.push({
                type: "statusChanged",
                deploymentId: deployment.id,
                status: deployment.status,
            });

            if (deployment.status === "success") {
                events.push({ type: "deploymentCompleted", deploymentId: deployment.id });
            } else if (deployment.status === "failed") {
                events.push({
                    type: "deploymentFailed",
                    deploymentId: deployment.id,
                    ...(deployment.errorMessage ? { errorMessage: deployment.errorMessage } : {}),
                });
            } else if (deployment.status === "cancelled") {
                events.push({
                    type: "deploymentCancelled",
                    deploymentId: deployment.id,
                    ...(typeof deployment.metadata?.cancelReason === "string"
                        ? { reason: deployment.metadata.cancelReason }
                        : {}),
                });
            }
        }

        return events;
    }

    async getFilteredReplayEvents(
        filters: {
            deploymentId?: string;
            serviceId?: string;
            projectId?: string;
            aggregateId?: string;
            eventType?: DeploymentStreamEventType;
            since?: string;
        },
        replayLimit: number,
    ): Promise<DeploymentQueryEvent[]> {
        const [deployments, logs] = await Promise.all([
            this.deploymentRepository.findRecentDeployments(filters, replayLimit),
            this.deploymentRepository.findRecentLogs(filters, replayLimit),
        ]);

        const events: DeploymentQueryEvent[] = [];

        for (const item of deployments) {
            const deployment = item.deployment;
            events.push({
                type: "deploymentTriggered",
                deployment,
                emittedAt: this.toDate(deployment.createdAt),
            });
            events.push({
                type: "statusChanged",
                deploymentId: deployment.id,
                serviceId: deployment.serviceId,
                ...(item.projectId ? { projectId: item.projectId } : {}),
                status: deployment.status,
                environment: deployment.environment,
                emittedAt: this.toDate(deployment.updatedAt),
            });

            if (deployment.phase) {
                events.push({
                    type: "phaseUpdated",
                    deploymentId: deployment.id,
                    phase: deployment.phase,
                    phaseProgress: deployment.phaseProgress ?? 0,
                    emittedAt: this.toDate(deployment.updatedAt),
                });
            }

            if (deployment.status === "cancelled") {
                events.push({
                    type: "deploymentCancelled",
                    deploymentId: deployment.id,
                    ...(typeof deployment.metadata?.cancelReason === "string"
                        ? { reason: deployment.metadata.cancelReason }
                        : {}),
                    emittedAt: this.toDate(deployment.updatedAt),
                });
            }

            if (deployment.metadata?.rollbackFrom) {
                events.push({
                    type: "rollbackStarted",
                    fromDeploymentId: deployment.metadata.rollbackFrom,
                    rollbackDeploymentId: deployment.id,
                    emittedAt: this.toDate(deployment.updatedAt),
                });
            }
        }

        for (const item of logs) {
            events.push({
                type: "logAppended",
                log: item.log,
                emittedAt: this.toDate(item.log.timestamp),
            });
        }

        return events.filter((event) => this.matchesStreamQueryFilters(event, filters));
    }

    async getProjectServiceIds(projectId: string) {
        return this.deploymentRepository.findServiceIdsByProject(projectId);
    }

    async listStreamDefinitions(input: DeploymentStreamListInput) {
        return this.deploymentRepository.findStreamMany(input);
    }

    async getStreamDefinitionById(id: string) {
        const stream = await this.deploymentRepository.findStreamById(id);
        if (!stream) {
            throw new NotFoundException(`Deployment stream definition with id '${id}' not found`);
        }
        return stream;
    }

    getTemplateProvenance(deploymentId: string): DeploymentTemplateProvenance | null {
        return this.templateProvenanceByDeployment.get(deploymentId) ?? null;
    }

    upsertTemplateProvenance(
        deploymentId: string,
        input: DeploymentTemplateProvenanceUpsertInput,
    ): Promise<DeploymentTemplateProvenanceUpsertResult> {
        const now = new Date().toISOString();
        const existing = this.templateProvenanceByDeployment.get(deploymentId);
        const record: DeploymentTemplateProvenance = {
            id: existing?.id ?? randomUUID(),
            deploymentId,
            runId: input.runId ?? null,
            planHash: input.planHash ?? null,
            templates: input.templates,
            metadata: input.metadata ?? null,
            capturedAt: now,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };

        this.templateProvenanceByDeployment.set(deploymentId, record);
        if (record.runId) {
            const records = this.templateProvenanceByRun.get(record.runId) ?? [];
            const next = [...records.filter((item) => item.id !== record.id), record];
            this.templateProvenanceByRun.set(record.runId, next);
        }

        return Promise.resolve({ persisted: true, provenance: record });
    }

    getTemplateProvenanceByRun(runId: string): DeploymentTemplateProvenanceByRunResult {
        return {
            runId,
            records: this.templateProvenanceByRun.get(runId) ?? [],
        };
    }

    createCompiledPlanSnapshot(
        deploymentId: string,
        input: DeploymentCreateCompiledPlanSnapshotInput,
    ): DeploymentCreateCompiledPlanSnapshotResult {
        const snapshot: DeploymentCompiledPlanSnapshot = {
            id: randomUUID(),
            deploymentId,
            runId: input.runId,
            planHash: input.planHash,
            compilerVersion: input.compilerVersion,
            immutable: true,
            context: input.context ?? null,
            nodes: input.nodes,
            edges: input.edges,
            metadata: input.metadata ?? null,
            createdAt: new Date().toISOString(),
        };

        this.compiledSnapshotsById.set(snapshot.id, snapshot);
        this.compiledSnapshotsByRun.set(snapshot.runId, snapshot);
        const existing = this.compiledSnapshotsByDeployment.get(deploymentId) ?? [];
        this.compiledSnapshotsByDeployment.set(deploymentId, [...existing, snapshot]);

        return { persisted: true, snapshot };
    }

    listCompiledPlanSnapshots(deploymentId: string): DeploymentListCompiledPlanSnapshotsResult {
        return {
            deploymentId,
            snapshots: this.compiledSnapshotsByDeployment.get(deploymentId) ?? [],
        };
    }

    getCompiledPlanSnapshot(snapshotId: string): DeploymentCompiledPlanSnapshot | null {
        return this.compiledSnapshotsById.get(snapshotId) ?? null;
    }

    getCompiledPlanSnapshotByRun(runId: string): DeploymentCompiledPlanSnapshotByRunResult {
        return {
            runId,
            snapshot: this.compiledSnapshotsByRun.get(runId) ?? null,
        };
    }

    compilePlan(input: DeploymentPlanCompileInput): DeploymentPlanCompileResult {
        const isPreview = input.environment === "preview";
        const previewTemplateId = input.templateRefs.previewTemplateId ?? null;

        // --- Base DAG nodes ---
        const nodes: DeploymentCompiledPlan["nodes"] = [
            { id: "source", type: "source", label: "Fetch source", dependsOn: [], metadata: null },
        ];
        const edges: DeploymentCompiledPlan["edges"] = [];

        // T030: inject preview_name node before build when compiling for a preview environment
        if (isPreview) {
            nodes.push({
                id: "preview_name",
                type: "preview_name",
                label: "Resolve preview environment name",
                dependsOn: ["source"],
                metadata: previewTemplateId ? { previewTemplateId } : null,
            });
            nodes.push({
                id: "build",
                type: "build",
                label: "Build artifact",
                dependsOn: ["preview_name"],
                metadata: null,
            });
            edges.push({ from: "source", to: "preview_name", kind: "dependency", metadata: null });
            edges.push({ from: "preview_name", to: "build", kind: "dependency", metadata: null });
        } else {
            nodes.push({ id: "build", type: "build", label: "Build artifact", dependsOn: ["source"], metadata: null });
            edges.push({ from: "source", to: "build", kind: "dependency", metadata: null });
        }

        nodes.push({ id: "deploy", type: "deploy", label: "Deploy artifact", dependsOn: ["build"], metadata: null });
        edges.push({ from: "build", to: "deploy", kind: "dependency", metadata: null });

        // T034: inject route_provision + tls_provision nodes for preview environments (DNS/routing + TLS lifecycle)
        if (isPreview) {
            nodes.push({
                id: "route_provision",
                type: "route_provision",
                label: "Provision preview route and DNS",
                dependsOn: ["deploy"],
                metadata: previewTemplateId ? { previewTemplateId } : null,
            });
            nodes.push({
                id: "tls_provision",
                type: "tls_provision",
                label: "Provision TLS certificate for preview domain",
                dependsOn: ["route_provision"],
                metadata: previewTemplateId ? { previewTemplateId } : null,
            });
            nodes.push({
                id: "health",
                type: "health",
                label: "Run health check",
                dependsOn: ["tls_provision"],
                metadata: null,
            });
            edges.push({ from: "deploy", to: "route_provision", kind: "dependency", metadata: null });
            edges.push({ from: "route_provision", to: "tls_provision", kind: "dependency", metadata: null });
            edges.push({ from: "tls_provision", to: "health", kind: "dependency", metadata: null });
        } else {
            nodes.push({ id: "health", type: "health", label: "Run health check", dependsOn: ["deploy"], metadata: null });
            edges.push({ from: "deploy", to: "health", kind: "dependency", metadata: null });
        }

        if (input.includeRollbackEdges) {
            edges.push({ from: "health", to: "deploy", kind: "rollback", metadata: { trigger: "health_gate_failure" } });
        }

        // Plan-level metadata carries preview context for inspectability
        const planMetadata: Record<string, unknown> | null = isPreview
            ? {
                  preview: {
                      enabled: true,
                      previewTemplateId,
                  },
              }
            : null;

        const hashInput = JSON.stringify({ serviceId: input.serviceId, projectId: input.projectId, environment: input.environment, nodes, edges, seed: input.deterministicSeed ?? null });
        const planHash = createHash("sha256").update(hashInput).digest("hex");

        return {
            compiled: true,
            plan: {
                planHash,
                compilerVersion: "v3.contract-runtime.1",
                deterministic: true,
                nodes,
                edges,
                progress: null,
                metadata: planMetadata,
            },
            observability: input.observability,
            issues: [],
        };
    }

    compileRollbackEdges(input: DeploymentCompileRollbackEdgesInput): DeploymentCompileRollbackEdgesResult {
        const rollbackEdges = input.plan.edges
            .filter((edge) => edge.kind === "rollback")
            .map((edge) => ({
                from: edge.from,
                to: edge.to,
                kind: "rollback" as const,
                trigger: "policy" as const,
                compensationNodeId: undefined,
                metadata: edge.metadata ?? null,
            }));

        return {
            compiled: true,
            graph: {
                planHash: input.plan.planHash,
                rollbackEdges,
                rollbackCoverage: {
                    totalNodes: input.plan.nodes.length,
                    protectedNodes: new Set(rollbackEdges.map((e) => e.from)).size,
                    uncoveredNodes: Math.max(0, input.plan.nodes.length - new Set(rollbackEdges.map((e) => e.from)).size),
                },
                issues: [],
            },
        };
    }

    enqueueQueueJob(input: DeploymentQueueEnqueueInput): DeploymentQueueEnqueueResult {
        const enqueued = this.deploymentQueueLifecycleService.enqueueQueueJob(input);

        void this.deploymentBullQueueService
            .enqueueFromQueueJob(enqueued.job)
            .then((bullJobId) => {
                const updated: DeploymentQueueJob = {
                    ...enqueued.job,
                    metadata: {
                        ...(enqueued.job.metadata ?? {}),
                        bullJobId: bullJobId.bullJobId,
                        bullQueueName: bullJobId.bullQueueName,
                        bullJobName: bullJobId.bullJobName,
                    },
                };
                this.queueJobs.set(updated.id, updated);
            })
            .catch(() => {
                // Bull enqueue failure should not block current in-memory queue lifecycle.
            });

        return enqueued;
    }

    async claimQueueJobs(input: DeploymentQueueClaimInput): Promise<DeploymentQueueClaimResult> {
        const now = Date.now();
        const claimResult = this.deploymentQueueLifecycleService.claimQueueJobs(input);
        for (const job of claimResult.claimed) {
            await this.handleClaimedQueueJob(job, now);
        }

        return claimResult;
    }

    async claimQueueJobByIdempotencyKey(
        idempotencyKey: string,
        input: DeploymentQueueClaimInput,
    ): Promise<DeploymentQueueJob | null> {
        const now = Date.now();
        const claimed = this.deploymentQueueLifecycleService.claimQueueJobByIdempotencyKey(
            idempotencyKey,
            input,
        );

        if (!claimed) {
            return null;
        }

        await this.handleClaimedQueueJob(claimed, now);
        return claimed;
    }

    heartbeatQueueJob(jobId: string, input: DeploymentQueueHeartbeatInput): DeploymentQueueHeartbeatResult {
        const heartbeat = this.deploymentQueueLifecycleService.heartbeatQueueJob(jobId, input);
        if (!heartbeat) {
            return {
                acknowledged: false,
                leaseExpiresAt: null,
                lastHeartbeatAt: null,
                observedConnectivityStatus: null,
                observedAt: new Date().toISOString(),
            };
        }
        return heartbeat;
    }

    async completeQueueJob(
        jobId: string,
        input: DeploymentQueueCompleteInput,
    ): Promise<DeploymentQueueTransitionResult> {
        const existing = this.queueJobs.get(jobId);
        if (existing?.workerId !== input.workerId || existing.lockToken !== input.lockToken) {
            throw new BadRequestException("Invalid worker/lock token for queue completion");
        }

        if (existing.type === "deploy" && existing.payload.deploymentId) {
            await this.deploymentExecutionWorkflowService.persistBuildExecutionResult(
                existing.payload.deploymentId,
                input.result,
                existing.payload.observability ?? null,
            );
        }

        if (existing.type === "rollback" && existing.payload.deploymentId) {
            await this.deploymentExecutionWorkflowService.persistRollbackExecutionResult(
                existing.payload.deploymentId,
                this.getResultString(existing.payload.context, "rollbackId"),
                this.getResultString(existing.payload.context, "fromDeploymentId"),
                existing.payload.observability ?? null,
                input.result,
            );
        }

        const completion = this.deploymentQueueLifecycleService.completeQueueJob(
            jobId,
            input.workerId,
            input.lockToken,
            input.result,
        );
        if (!completion) {
            throw new BadRequestException("Invalid worker/lock token for queue completion");
        }
        return completion;
    }

    private getResultString(result: Record<string, unknown> | undefined, key: string): string | null {
        const value = result?.[key];
        return typeof value === "string" && value.trim().length > 0 ? value : null;
    }

    private async handleClaimedQueueJob(job: DeploymentQueueJob, claimedAtMs: number): Promise<void> {
        if (job.type !== "deploy" || !job.payload.deploymentId) {
            if (job.type === "rollback" && job.payload.deploymentId) {
                await this.deploymentExecutionWorkflowService.markRollbackExecutionStarted(
                    job.payload.deploymentId,
                    this.getResultString(job.payload.context, "rollbackId"),
                    this.getResultString(job.payload.context, "fromDeploymentId"),
                    job.payload.observability ?? null,
                );
            }
            return;
        }

        await this.deploymentExecutionWorkflowService.markBuildExecutionStarted(
            job.payload.deploymentId,
            new Date(claimedAtMs),
            job.payload.observability ?? null,
        );
    }

    failQueueJob(jobId: string, input: DeploymentQueueFailInput): DeploymentQueueTransitionResult {
        const failure = this.deploymentQueueLifecycleService.failQueueJob(jobId, input);
        if (!failure) {
            throw new BadRequestException("Invalid worker/lock token for queue failure");
        }

        if (failure.failedJob.type === "rollback" && failure.failedJob.payload.deploymentId) {
            void this.deploymentExecutionWorkflowService.persistRollbackExecutionFailure(
                failure.failedJob.payload.deploymentId,
                this.getResultString(failure.failedJob.payload.context, "rollbackId"),
                this.getResultString(failure.failedJob.payload.context, "fromDeploymentId"),
                input.error,
            );
        }

        return failure.transition;
    }

    findQueueJobById(jobId: string): DeploymentQueueJob | null {
        return this.deploymentQueueLifecycleService.findQueueJobById(jobId);
    }

    listQueueJobs(input: DeploymentQueueListInput): DeploymentQueueListResult {
        return this.deploymentQueueLifecycleService.listQueueJobs(input);
    }

    listDeadLetterJobs(input: DeploymentDeadLetterListInput): DeploymentDeadLetterListResult {
        return this.deploymentQueueLifecycleService.listDeadLetterJobs(input);
    }

    findDeadLetterJobById(deadLetterJobId: string): DeploymentDeadLetterJob | null {
        return this.deploymentQueueLifecycleService.findDeadLetterJobById(deadLetterJobId);
    }

    replayDeadLetterJob(input: DeploymentDeadLetterReplayInput): DeploymentDeadLetterReplayResult {
        return this.deploymentQueueLifecycleService.replayDeadLetterJob(input);
    }

    listRetryPolicies(input: DeploymentRetryPolicyListInput) {
        return {
            policies: BASE_RETRY_POLICIES.filter((policy) =>
                (!input.jobType || policy.jobType === input.jobType) &&
                (!input.nodeType || policy.nodeType === input.nodeType) &&
                (!input.taskType || policy.taskType === input.taskType) &&
                (!input.enabledOnly || policy.enabled),
            ),
        };
    }

    resolveRetryPolicy(input: DeploymentRetryPolicyResolveInput): DeploymentRetryPolicyResolveResult {
        const matched = BASE_RETRY_POLICIES.find((policy) =>
            (!policy.jobType || policy.jobType === input.jobType) &&
            (!policy.nodeType || policy.nodeType === input.nodeType) &&
            (!policy.taskType || policy.taskType === input.taskType) &&
            policy.enabled,
        );

        if (!matched) {
            return {
                matched: false,
                policy: null,
                retryAllowed: false,
                remainingAttempts: 0,
                backoffMs: null,
                nextRetryAt: null,
                reason: "No matching retry policy",
            };
        }

        if (input.errorCode && matched.nonRetryableErrorCodes.includes(input.errorCode)) {
            return {
                matched: true,
                policy: matched,
                retryAllowed: false,
                remainingAttempts: 0,
                backoffMs: null,
                nextRetryAt: null,
                reason: `Error code '${input.errorCode}' is non-retryable`,
            };
        }

        const retryAllowed = input.attempt < matched.maxAttempts;
        const remainingAttempts = Math.max(0, matched.maxAttempts - input.attempt);
        const rawBackoff =
            matched.strategy === "fixed"
                ? matched.initialBackoffMs
                : matched.strategy === "linear"
                  ? matched.initialBackoffMs * input.attempt
                  : matched.initialBackoffMs * Math.pow(matched.multiplier, Math.max(0, input.attempt - 1));
        const backoffMs = retryAllowed ? Math.min(rawBackoff, matched.maxBackoffMs) : null;
        const now = input.at ? new Date(input.at) : new Date();
        const nextRetryAt = backoffMs !== null ? new Date(now.getTime() + backoffMs).toISOString() : null;

        return {
            matched: true,
            policy: matched,
            retryAllowed,
            remainingAttempts,
            backoffMs,
            nextRetryAt,
            reason: retryAllowed ? null : "Max attempts reached",
        };
    }

    cancelExecution(deploymentId: string, input: DeploymentExecutionCancelInput): DeploymentExecutionCancelResult {
        const now = new Date().toISOString();
        const existing = this.executionCheckpointsByDeployment.get(deploymentId);
        const runId = existing?.runId ?? randomUUID();

        const checkpoint: DeploymentExecutionCheckpoint = {
            id: existing?.id ?? randomUUID(),
            deploymentId,
            runId,
            planHash: existing?.planHash ?? null,
            state: "cancellation_requested",
            currentNodeId: existing?.currentNodeId ?? null,
            completedNodeIds: existing?.completedNodeIds ?? [],
            pendingNodeIds: existing?.pendingNodeIds ?? [],
            failedNodeIds: existing?.failedNodeIds ?? [],
            cancellationRequestedAt: now,
            cancelledAt: input.force ? now : null,
            resumedFromRunId: existing?.resumedFromRunId ?? null,
            observability: input.observability ?? null,
            progress: existing?.progress ?? null,
            metadata: {
                ...(existing?.metadata ?? {}),
                reason: input.reason,
                requestedBy: input.requestedBy,
                gracefulTimeoutSec: input.gracefulTimeoutSec,
            },
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };

        this.executionCheckpointsByDeployment.set(deploymentId, checkpoint);
        this.executionCheckpointsByRun.set(runId, checkpoint);

        return {
            accepted: true,
            deploymentId,
            runId,
            state: checkpoint.state,
            checkpoint,
            message: "Execution cancellation accepted",
        };
    }

    resumeExecution(deploymentId: string, input: DeploymentExecutionResumeInput): DeploymentExecutionResumeResult {
        const previous = this.executionCheckpointsByDeployment.get(deploymentId);
        const now = new Date().toISOString();
        const runId = randomUUID();

        const checkpoint: DeploymentExecutionCheckpoint = {
            id: randomUUID(),
            deploymentId,
            runId,
            planHash: previous?.planHash ?? null,
            state: "resuming",
            currentNodeId: input.resumeFromNodeId ?? previous?.currentNodeId ?? null,
            completedNodeIds: previous?.completedNodeIds ?? [],
            pendingNodeIds: previous?.pendingNodeIds ?? [],
            failedNodeIds: input.strategy === "restart_failed_branch" ? [] : (previous?.failedNodeIds ?? []),
            cancellationRequestedAt: null,
            cancelledAt: null,
            resumedFromRunId: input.resumeFromRunId ?? previous?.runId ?? null,
            observability: input.observability ?? previous?.observability ?? null,
            progress: previous?.progress ?? null,
            metadata: {
                ...(previous?.metadata ?? {}),
                strategy: input.strategy,
                reason: input.reason,
                requestedBy: input.requestedBy,
            },
            createdAt: now,
            updatedAt: now,
        };

        this.executionCheckpointsByDeployment.set(deploymentId, checkpoint);
        this.executionCheckpointsByRun.set(runId, checkpoint);

        return {
            resumed: true,
            deploymentId,
            previousRunId: previous?.runId ?? null,
            runId,
            state: checkpoint.state,
            checkpoint,
            message: "Execution resumed",
        };
    }

    getExecutionCheckpoint(deploymentId: string): DeploymentExecutionCheckpoint | null {
        return this.executionCheckpointsByDeployment.get(deploymentId) ?? null;
    }

    getExecutionCheckpointByRun(runId: string): DeploymentExecutionCheckpointByRunResult {
        return {
            runId,
            checkpoint: this.executionCheckpointsByRun.get(runId) ?? null,
        };
    }

    emitNodeLifecycleEvent(
        runId: string,
        input: DeploymentNodeLifecycleEventEmitInput,
    ): DeploymentNodeLifecycleEventEmitResult {
        const event: DeploymentNodeLifecycleEvent = {
            id: randomUUID(),
            deploymentId: input.deploymentId,
            runId,
            nodeId: input.nodeId,
            nodeType: input.nodeType,
            type: input.type,
            sequence: input.sequence,
            attempt: input.attempt,
            maxAttempts: input.maxAttempts,
            state: input.state,
            phase: input.phase,
            progress: input.progress ?? null,
            observability: input.observability ?? null,
            connectivityStatus: input.connectivityStatus ?? null,
            errorCode: input.errorCode ?? null,
            errorMessage: input.errorMessage ?? null,
            rollbackToNodeId: input.rollbackToNodeId ?? null,
            durationMs: input.durationMs ?? null,
            metadata: input.metadata ?? null,
            emittedAt: input.emittedAt ?? new Date().toISOString(),
        };

        const events = this.nodeLifecycleByRun.get(runId) ?? [];
        const next = [...events, event].sort((a, b) => a.sequence - b.sequence);
        this.nodeLifecycleByRun.set(runId, next);

        return { emitted: true, event };
    }

    listNodeLifecycleEvents(
        runId: string,
        input: Omit<DeploymentNodeLifecycleEventListInput, "runId">,
    ): DeploymentNodeLifecycleEventListResult {
        const events = (this.nodeLifecycleByRun.get(runId) ?? [])
            .filter((event) => !input.deploymentId || event.deploymentId === input.deploymentId)
            .filter((event) => !input.nodeId || event.nodeId === input.nodeId)
            .filter((event) => !input.type || event.type === input.type)
            .filter((event) => input.fromSequence === undefined || event.sequence >= input.fromSequence)
            .sort((a, b) => a.sequence - b.sequence);

        const sliced = events.slice(0, input.limit);
        const hasMore = events.length > sliced.length;
        const lastEvent = sliced.at(-1);
        const lastSequence = lastEvent ? lastEvent.sequence : null;
        return {
            events: sliced,
            hasMore,
            nextFromSequence: hasMore && lastSequence !== null ? lastSequence + 1 : null,
        };
    }

    streamNodeLifecycleEvents(input: {
        runId: string;
        fromSequence?: number;
        replay: boolean;
        replayLimit: number;
    }): Observable<DeploymentNodeLifecycleEvent> {
        const events = (this.nodeLifecycleByRun.get(input.runId) ?? [])
            .filter((event) => input.fromSequence === undefined || event.sequence >= input.fromSequence)
            .sort((a, b) => a.sequence - b.sequence);

        const replayEvents = input.replay ? events.slice(-input.replayLimit) : events;

        return from(replayEvents);
    }

    listPhaseTransitions(input: { from?: string; to?: string }): DeploymentPhaseTransitionsCatalog {
        return {
            transitions: BASE_PHASE_TRANSITIONS.filter((transition) =>
                (!input.from || transition.from === input.from) && (!input.to || transition.to === input.to),
            ),
        };
    }

    validatePhaseTransition(
        input: DeploymentPhaseTransitionValidationInput,
    ): DeploymentPhaseTransitionValidationResult {
        const transition = BASE_PHASE_TRANSITIONS.find(
            (item) => item.from === input.currentPhase && item.to === input.targetPhase,
        );

        if (!transition) {
            return {
                valid: false,
                transition: {
                    from: input.currentPhase,
                    to: input.targetPhase,
                    allowed: false,
                    guards: [],
                    reason: "Transition not allowed",
                },
                violations: [
                    {
                        guard: "requiresCompiledPlan",
                        message: `Transition ${input.currentPhase} -> ${input.targetPhase} is not allowed`,
                        severity: "error",
                    },
                ],
            };
        }

        return {
            valid: true,
            transition,
            violations: [],
        };
    }

    async applyPhaseTransition(
        deploymentId: string,
        input: DeploymentPhaseTransitionApplyInput,
    ): Promise<DeploymentPhaseTransitionApplyResult> {
        const validation = this.validatePhaseTransition(input);
        const previousPhase = input.currentPhase;

        if (!validation.valid && !input.force) {
            return {
                applied: false,
                deploymentId,
                previousPhase,
                currentPhase: input.currentPhase,
                transition: validation.transition,
                violations: validation.violations,
            };
        }

        const phaseProgress =
            typeof input.context.phaseProgress === "number" ? input.context.phaseProgress : 0;
        await this.deploymentRepository.updatePhase(deploymentId, input.targetPhase, phaseProgress);

        return {
            applied: true,
            deploymentId,
            previousPhase,
            currentPhase: input.targetPhase,
            transition: {
                ...validation.transition,
                allowed: true,
                reason: null,
            },
            violations: validation.valid ? [] : validation.violations,
        };
    }

    streamDeploymentEvents(input: {
        deploymentId: string;
    } & StreamReplayInput): Observable<StreamEventWithMeta<DeploymentProgressEvent>> {
        const live$ = defer(async () => this.getDeploymentById(input.deploymentId)).pipe(
            mergeMap((deployment) =>
                this.mergeEventStreams<DeploymentProgressEvent>([
                    this.mapEventStream(
                        this.deploymentEventService.subscribe("statusChanged", {
                            deploymentId: input.deploymentId,
                        }),
                        (event) => ({
                            type: "statusChanged" as const,
                            status: event.status,
                            ...(event.phase ? { phase: event.phase } : {}),
                        }),
                    ),
                    this.mapEventStream(
                        this.deploymentEventService.subscribe("phaseUpdated", {
                            deploymentId: input.deploymentId,
                        }),
                        (event) => ({
                            type: "phaseUpdated" as const,
                            phase: event.phase,
                            phaseProgress: event.progress,
                        }),
                    ),
                    this.mapEventStream(
                        this.deploymentEventService.subscribe("logAppended", {
                            deploymentId: input.deploymentId,
                        }),
                        (event) => ({ type: "logAppended" as const, log: event }),
                    ),
                    this.mapEventStream(
                        this.deploymentEventService.subscribe("deploymentCancelled", {
                            serviceId: deployment.serviceId,
                        }),
                        (event) => {
                            if (event.deploymentId !== input.deploymentId) {
                                return null;
                            }
                            return {
                                type: "cancelled" as const,
                                ...(event.reason ? { reason: event.reason } : {}),
                            };
                        },
                    ),
                    this.mapEventStream(
                        this.deploymentEventService.subscribe("rollbackStarted", {
                            serviceId: deployment.serviceId,
                        }),
                        (event) => {
                            if (event.fromDeploymentId !== input.deploymentId) {
                                return null;
                            }
                            return {
                                type: "rollbackStarted" as const,
                                rollbackDeploymentId: event.toDeploymentId,
                            };
                        },
                    ),
                    this.mapEventStream(
                        this.deploymentEventService.subscribe("rollbackCompleted", {
                            serviceId: deployment.serviceId,
                        }),
                        (event) => {
                            if (event.fromDeploymentId !== input.deploymentId) {
                                return null;
                            }
                            return {
                                type: "rollbackCompleted" as const,
                                rollbackDeploymentId: event.toDeploymentId,
                            };
                        },
                    ),
                ]),
            ),
        );

        return this.toSequencedObservable({
            replay$: input.replay
                ? defer(() => from(this.getDeploymentReplayEvents(input.deploymentId, input.replayLimit))).pipe(
                      mergeMap((events) => from(events)),
                  )
                : EMPTY,
            live$,
        });
    }

    streamServiceEvents(input: {
        serviceId: string;
    } & StreamReplayInput): Observable<StreamEventWithMeta<ServiceDeploymentEvent>> {
        const live$ = this.mergeEventStreams<ServiceDeploymentEvent>([
            this.mapEventStream(
                this.deploymentEventService.subscribe("deploymentTriggered", {
                    serviceId: input.serviceId,
                }),
                (event) => ({
                    type: "deploymentTriggered" as const,
                    deployment: event.deployment,
                }),
            ),
            this.mapEventStream(
                this.deploymentEventService.subscribe("serviceStatusChanged", {
                    serviceId: input.serviceId,
                }),
                (event) => ({
                    type: "statusChanged" as const,
                    deploymentId: event.deploymentId,
                    status: event.status,
                }),
            ),
            this.mapEventStream(
                this.deploymentEventService.subscribe("deploymentCancelled", {
                    serviceId: input.serviceId,
                }),
                (event) => ({
                    type: "deploymentCancelled" as const,
                    deploymentId: event.deploymentId,
                    ...(event.reason ? { reason: event.reason } : {}),
                }),
            ),
        ]);

        return this.toSequencedObservable({
            replay$: input.replay
                ? defer(() => from(this.getServiceReplayEvents(input.serviceId, input.replayLimit))).pipe(
                      mergeMap((events) => from(events)),
                  )
                : EMPTY,
            live$,
        });
    }

    streamQueryEvents(input: {
        deploymentId?: string;
        serviceId?: string;
        projectId?: string;
        aggregateId?: string;
        eventType?: DeploymentStreamEventType;
        since?: string;
        cursor?: number;
    } & StreamReplayInput): Observable<StreamEventWithMeta<DeploymentQueryEvent>> {
        const live$ = defer(async () => {
            const serviceIds: string[] = [];
            if (input.serviceId) {
                serviceIds.push(input.serviceId);
            }
            if (input.projectId) {
                const projectServiceIds = await this.getProjectServiceIds(input.projectId);
                for (const id of projectServiceIds) {
                    if (!serviceIds.includes(id)) {
                        serviceIds.push(id);
                    }
                }
            }
            return serviceIds;
        }).pipe(
            mergeMap((serviceIds) => {
                const streams: Observable<DeploymentQueryEvent>[] = [];

                if (input.deploymentId) {
                    streams.push(
                        this.mapEventStream(
                            this.deploymentEventService.subscribe("statusChanged", {
                                deploymentId: input.deploymentId,
                            }),
                            (event) => ({
                                type: "statusChanged" as const,
                                deploymentId: event.deploymentId,
                                status: event.status,
                            }),
                        ),
                    );
                    streams.push(
                        this.mapEventStream(
                            this.deploymentEventService.subscribe("phaseUpdated", {
                                deploymentId: input.deploymentId,
                            }),
                            (event) => ({
                                type: "phaseUpdated" as const,
                                deploymentId: event.deploymentId,
                                phase: event.phase,
                                phaseProgress: event.progress,
                            }),
                        ),
                    );
                    streams.push(
                        this.mapEventStream(
                            this.deploymentEventService.subscribe("logAppended", {
                                deploymentId: input.deploymentId,
                            }),
                            (event) => ({ type: "logAppended" as const, log: event }),
                        ),
                    );
                    streams.push(
                        this.mapEventStream(
                            this.deploymentEventService.subscribe("metricsSnapshot", {
                                deploymentId: input.deploymentId,
                            }),
                            (event) => ({
                                type: "metricsSnapshot" as const,
                                deploymentId: event.deploymentId,
                                ...(event.cpuPercent !== undefined ? { cpuPercent: event.cpuPercent } : {}),
                                ...(event.memoryMb !== undefined ? { memoryMb: event.memoryMb } : {}),
                                ...(event.networkRxBytes !== undefined
                                    ? { networkRxBytes: event.networkRxBytes }
                                    : {}),
                                ...(event.networkTxBytes !== undefined
                                    ? { networkTxBytes: event.networkTxBytes }
                                    : {}),
                            }),
                        ),
                    );
                }

                for (const serviceId of serviceIds) {
                    streams.push(
                        this.mapEventStream(
                            this.deploymentEventService.subscribe("deploymentTriggered", { serviceId }),
                            (event) => ({
                                type: "deploymentTriggered" as const,
                                deployment: event.deployment,
                            }),
                        ),
                    );
                    streams.push(
                        this.mapEventStream(
                            this.deploymentEventService.subscribe("serviceStatusChanged", { serviceId }),
                            (event) => ({
                                type: "statusChanged" as const,
                                deploymentId: event.deploymentId,
                                serviceId: event.serviceId,
                                status: event.status,
                            }),
                        ),
                    );
                    streams.push(
                        this.mapEventStream(
                            this.deploymentEventService.subscribe("deploymentCancelled", { serviceId }),
                            (event) => ({
                                type: "deploymentCancelled" as const,
                                deploymentId: event.deploymentId,
                                ...(event.reason ? { reason: event.reason } : {}),
                            }),
                        ),
                    );
                    streams.push(
                        this.mapEventStream(
                            this.deploymentEventService.subscribe("rollbackStarted", { serviceId }),
                            (event) => ({
                                type: "rollbackStarted" as const,
                                fromDeploymentId: event.fromDeploymentId,
                                rollbackDeploymentId: event.toDeploymentId,
                            }),
                        ),
                    );
                    streams.push(
                        this.mapEventStream(
                            this.deploymentEventService.subscribe("rollbackCompleted", { serviceId }),
                            (event) => ({
                                type: "rollbackCompleted" as const,
                                fromDeploymentId: event.fromDeploymentId,
                                rollbackDeploymentId: event.toDeploymentId,
                                success: event.success,
                            }),
                        ),
                    );
                    streams.push(
                        this.mapEventStream(
                            this.deploymentEventService.subscribe("healthCheckUpdated", { serviceId }),
                            (event) => ({
                                type: "healthCheckUpdated" as const,
                                serviceId: event.serviceId,
                                ...(event.deploymentId ? { deploymentId: event.deploymentId } : {}),
                                status: event.status,
                                ...(event.message ? { message: event.message } : {}),
                            }),
                        ),
                    );
                    streams.push(
                        this.mapEventStream(
                            this.deploymentEventService.subscribe("domainRouteUpdated", { serviceId }),
                            (event) => ({
                                type: "domainRouteUpdated" as const,
                                serviceId: event.serviceId,
                                ...(event.projectId ? { projectId: event.projectId } : {}),
                                domain: event.domain,
                                action: event.action,
                            }),
                        ),
                    );
                }

                return streams.length > 0 ? this.mergeEventStreams(streams) : EMPTY;
            }),
        );

        const replayFilters = {
            deploymentId: input.deploymentId,
            serviceId: input.serviceId,
            projectId: input.projectId,
            aggregateId: input.aggregateId,
            eventType: input.eventType,
            since: input.since,
        };

        const filteredLive$ = live$.pipe(
            rxFilter((event) => this.matchesStreamQueryFilters(event, replayFilters)),
        );

        return this.toSequencedObservable({
            replay$: input.replay
                ? defer(() =>
                      from(
                          this.getFilteredReplayEvents(
                              replayFilters,
                              input.replayLimit,
                          ),
                      ),
                  ).pipe(mergeMap((events) => from(events)))
                : EMPTY,
            live$: filteredLive$,
            since: input.since,
            cursor: input.cursor,
        });
    }

    private async emitLifecycleQueued(
        deployment: Awaited<ReturnType<DeploymentRepository["create"]>>,
        previousStatus: DeploymentStatus | null,
        message: string,
    ) {
        await this.deploymentRepository.updatePhase(deployment.id, "queued", 0);
        const log = await this.deploymentRepository.insertLog(deployment.id, {
            level: "info",
            message,
            phase: "queued",
            stage: "queue",
        });

        const now = new Date().toISOString();

        this.deploymentEventService.emit(
            "deploymentTriggered",
            { serviceId: deployment.serviceId },
            {
                serviceId: deployment.serviceId,
                deployment,
                timestamp: now,
            },
        );

        this.deploymentEventService.emit(
            "serviceStatusChanged",
            { serviceId: deployment.serviceId },
            {
                serviceId: deployment.serviceId,
                deploymentId: deployment.id,
                status: deployment.status,
                timestamp: now,
            },
        );

        this.deploymentEventService.emit(
            "statusChanged",
            { deploymentId: deployment.id },
            {
                deploymentId: deployment.id,
                status: deployment.status,
                previousStatus,
                phase: "queued",
                timestamp: now,
            },
        );

        this.deploymentEventService.emit(
            "phaseUpdated",
            { deploymentId: deployment.id },
            {
                deploymentId: deployment.id,
                phase: "queued",
                progress: 0,
                timestamp: now,
            },
        );

        this.deploymentEventService.emit(
            "orchestrationPhaseTransition",
            { deploymentId: deployment.id },
            {
                deploymentId: deployment.id,
                toPhase: "queued",
                progress: 0,
                timestamp: now,
            },
        );

        this.deploymentEventService.emit(
            "metricsSnapshot",
            { deploymentId: deployment.id },
            {
                deploymentId: deployment.id,
                cpuPercent: 0,
                memoryMb: 0,
                networkRxBytes: 0,
                networkTxBytes: 0,
                timestamp: now,
            },
        );

        if (deployment.phase === "health_check") {
            this.deploymentEventService.emit(
                "healthCheckUpdated",
                { serviceId: deployment.serviceId },
                {
                    serviceId: deployment.serviceId,
                    deploymentId: deployment.id,
                    status: "healthy",
                    timestamp: now,
                },
            );
        }

        if (deployment.phase === "updating_routes") {
            this.deploymentEventService.emit(
                "domainRouteUpdated",
                { serviceId: deployment.serviceId },
                {
                    serviceId: deployment.serviceId,
                    domain: deployment.domainUrl ?? "pending-domain",
                    action: "synced",
                    timestamp: now,
                },
            );
        }

        this.deploymentEventService.emit("logAppended", { deploymentId: deployment.id }, log);
    }

    private mapEventStream<TInput, TOutput extends object>(
        iterable: AsyncIterable<TInput>,
        mapper: (value: TInput) => TOutput | null,
    ): Observable<TOutput> {
        return from(iterable).pipe(
            map((value) => mapper(value)),
            rxFilter((mapped): mapped is TOutput => mapped !== null),
        );
    }

    private mergeEventStreams<T>(streams: Observable<T>[]): Observable<T> {
        return merge(...streams);
    }

    private toSequencedObservable<TEvent extends object>(input: {
        replay$: Observable<TEvent>;
        live$: Observable<TEvent>;
        since?: string;
        cursor?: number;
    }): Observable<StreamEventWithMeta<TEvent>> {
        let sequence = input.cursor ?? 0;
        const sinceDate = input.since ? new Date(input.since) : null;
        const hasValidSince = sinceDate !== null && Number.isFinite(sinceDate.getTime());

        const stream$ = concat(
            input.replay$.pipe(map((event) => ({ event, replayed: true }))),
            input.live$.pipe(map((event) => ({ event, replayed: false }))),
        ).pipe(
            map(({ event, replayed }) => {
                const existingEmittedAt =
                    typeof event === "object" &&
                    "emittedAt" in event &&
                    (event as { emittedAt?: unknown }).emittedAt instanceof Date
                        ? ((event as { emittedAt: Date }).emittedAt)
                        : typeof event === "object" &&
                            "emittedAt" in event &&
                            typeof (event as { emittedAt?: unknown }).emittedAt === "string"
                          ? new Date((event as { emittedAt: string }).emittedAt)
                          : undefined;
                const emittedAt = existingEmittedAt ?? new Date();

                if (hasValidSince) {
                    if (!Number.isFinite(emittedAt.getTime()) || emittedAt < sinceDate) {
                        return null;
                    }
                }

                sequence += 1;
                return {
                    ...event,
                    sequence,
                    cursor: String(sequence),
                    replayed,
                    emittedAt,
                };
            }),
            rxFilter((event): event is StreamEventWithMeta<TEvent> => event !== null),
        );

        return stream$;
    }

    private matchesStreamQueryFilters(
        event: DeploymentQueryEvent,
        filters: {
            aggregateId?: string;
            eventType?: DeploymentStreamEventType;
            since?: string;
        },
    ): boolean {
        if (filters.eventType && event.type !== filters.eventType) {
            return false;
        }

        if (filters.aggregateId) {
            const aggregateId = this.resolveAggregateIdForQueryEvent(event);
            if (!aggregateId || aggregateId !== filters.aggregateId) {
                return false;
            }
        }

        if (filters.since) {
            const eventTime = this.resolveEventTimestamp(event);
            if (eventTime) {
                const sinceDate = new Date(filters.since);
                if (
                    Number.isFinite(sinceDate.getTime()) &&
                    Number.isFinite(eventTime.getTime()) &&
                    eventTime < sinceDate
                ) {
                    return false;
                }
            }
        }

        return true;
    }

    private resolveAggregateIdForQueryEvent(event: DeploymentQueryEvent): string | undefined {
        switch (event.type) {
            case "deploymentTriggered":
                return event.deployment.id;
            case "statusChanged":
            case "phaseUpdated":
            case "deploymentCancelled":
            case "metricsSnapshot":
            case "progressSnapshot":
                return event.deploymentId;
            case "logAppended":
                return event.log.deploymentId;
            case "rollbackStarted":
            case "rollbackCompleted":
                return event.rollbackDeploymentId;
            case "healthCheckUpdated":
            case "domainRouteUpdated":
            case "connectivityChanged":
                return event.serviceId;
            default:
                return undefined;
        }
    }

    private resolveEventTimestamp(event: DeploymentQueryEvent): Date | undefined {
        switch (event.type) {
            case "deploymentTriggered":
                return this.toDate(event.deployment.createdAt);
            case "logAppended":
                return this.toDate(event.log.timestamp);
            default:
                return event.emittedAt;
        }
    }

    private toCoreAdapterStream(
        definition: {
            scope: "global" | "tenant" | "project" | "service" | "deployment";
            scopeId: string | null;
            filters: Record<string, unknown> | null;
        },
        replay: boolean,
        replayLimit: number,
    ): Observable<{ eventName: string; payload: unknown; replayed?: boolean; emittedAt?: string }> {
        const filters = definition.filters ?? {};

        const scopedDeploymentId =
            definition.scope === "deployment" && definition.scopeId ? definition.scopeId : undefined;
        const scopedServiceId = definition.scope === "service" && definition.scopeId ? definition.scopeId : undefined;
        const scopedProjectId = definition.scope === "project" && definition.scopeId ? definition.scopeId : undefined;

        const deploymentId =
            typeof filters.deploymentId === "string" ? filters.deploymentId : scopedDeploymentId;
        const serviceId = typeof filters.serviceId === "string" ? filters.serviceId : scopedServiceId;
        const projectId = typeof filters.projectId === "string" ? filters.projectId : scopedProjectId;

        const eventTypes = Array.isArray(filters.eventTypes)
            ? new Set(filters.eventTypes.filter((v): v is string => typeof v === "string"))
            : null;

        const source$ = this.streamQueryEvents({
            deploymentId,
            serviceId,
            projectId,
            replay,
            replayLimit,
        });

        return source$.pipe(
            rxFilter((event) => !eventTypes || eventTypes.has(event.type)),
            map((event) => ({
                eventName: event.type,
                payload: event,
                replayed: event.replayed,
                emittedAt: event.emittedAt.toISOString(),
            })),
        );
    }

    private toDate(value: string | Date): Date {
        return value instanceof Date ? value : new Date(value);
    }

    private buildStateMachineScopeConfig(
        resolvedRuntimeConfiguration: ResolvedRuntimeConfiguration,
    ): DeploymentStateMachineScopeConfigInput {
        return {
            organization: this.extractStateMachinePolicyPatch(
                resolvedRuntimeConfiguration.organization.metadata,
            ),
            project: this.extractStateMachinePolicyPatch(resolvedRuntimeConfiguration.project.metadata),
            service: this.extractStateMachinePolicyPatch(resolvedRuntimeConfiguration.service.metadata),
            runtime: {
                previewEnabled: resolvedRuntimeConfiguration.effective.deployment.previewEnabled,
                deploymentStrategy: resolvedRuntimeConfiguration.effective.deployment.strategy,
            },
        };
    }

    private async resolveStateMachineScopeConfigForService(input: {
        serviceId: string;
        environment: "production" | "staging" | "preview" | "development";
        sourceType: string;
    }): Promise<DeploymentStateMachineScopeConfigInput | undefined> {
        const runtimeConfigurationSeed = await this.deploymentRepository.getRuntimeConfigurationSeed(input.serviceId);
        if (!runtimeConfigurationSeed) {
            return undefined;
        }

        const resolvedRuntimeConfiguration = runtimeConfigurationAccessor.resolveForDeployment({
            serviceId: input.serviceId,
            projectId: runtimeConfigurationSeed.projectId,
            environment: input.environment,
            sourceType: input.sourceType,
            projectSettings: runtimeConfigurationSeed.projectSettings,
            serviceRecord: runtimeConfigurationSeed.service,
        });

        return this.buildStateMachineScopeConfig(resolvedRuntimeConfiguration);
    }

    private extractStateMachinePolicyPatch(
        metadata: Record<string, unknown> | null | undefined,
    ): Record<string, unknown> | undefined {
        const candidate = metadata?.deploymentStateMachine;
        if (!candidate || typeof candidate !== "object") {
            return undefined;
        }

        return candidate as Record<string, unknown>;
    }

}
