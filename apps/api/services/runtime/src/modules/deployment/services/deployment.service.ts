import { createHash, randomUUID } from "crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Context, Effect } from "effect";
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


import { isRecord } from "@deployer/type-guards"
import type { DeploymentListInput } from "@deployer/runtime-contracts/modules/deployment/list";
import type { DeploymentTriggerInput } from "@deployer/runtime-contracts/modules/deployment/crud";
import type { PlatformRole, ProjectRole } from "@deployer/auth";
import type { ApprovalGuardShape } from "@deployer/shared/core/modules/approval/approval.guard";
import type {
    DeploymentProgressEvent,
    DeploymentQueryEvent,
    DeploymentStreamListInput,
    ServiceDeploymentEvent,
} from "@deployer/runtime-contracts/modules/deployment/stream";
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
} from "@deployer/contracts-entities";
import type { EffectHostShape } from "@deployer/nest-effect";
import type { ResolvedRuntimeConfiguration } from "@deployer/shared/core/modules/configuration/schemas/runtime-configuration.schema";
import type { RuntimeConfigurationAccessorServiceShape } from "@deployer/shared/core/modules/configuration/services/runtime-configuration-accessor.service";
import type { DeploymentStateMachineScopeConfigInput } from "@deployer/shared/core/modules/deployment/services/deployment-provider-builder-runner-state-machine.service";
import { deploymentRunnerKindSchema } from "@deployer/shared/core/modules/deployment/services/deployment-provider-builder-runner-state-machine.service";
import type { DeploymentStateMachineShape } from "@deployer/shared/core/modules/deployment/services/deployment-provider-builder-runner-state-machine.service";
import type { DomainRoutingService } from "@deployer/shared/core/modules/domain/services/domain-routing.service";
import type { CoreEventSyncServiceShape } from "@deployer/shared/core/modules/events/index";
import type { ProjectAccessService } from "@deployer/shared/core/modules/project/services/project-access.service";
import type { TraefikConfigRefresherShape } from "@deployer/shared/core/modules/traefik/services/traefik-config-refresher.service";

import { lift } from "../../../core/effects";
import { RuntimeForbidden, RuntimeInvalid, RuntimeNotFound } from "../../../core/runtime.errors";
import type { CodeProviderRegistryShape } from "../../providers/code/shared/code-provider-registry.service";
import type { UploadBundleRegistryShape } from "../../providers/code/upload/services/upload-bundle-registry.service";
import type { DeploymentEventService } from "../events/deployment-event.service";
import type { DeploymentQueueLifecycleShape } from "../queue/deployment-queue-lifecycle.service";
import type { DeploymentRepositoryPort } from "../deployment.ports";
import type { StoragePolicyResolverRegistryShape } from "../storage/policy/storage-policy-resolver-registry.service";
import type { StorageProviderRegistryShape } from "../storage/storage-provider-registry.service";

import type { DeploymentExecutionWorkflowShape } from "./deployment-execution-workflow.service";


const CANCELLABLE_STATUSES = ["pending", "queued", "building", "deploying"] as const;

type StreamReplayInput = {
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

export type DeploymentServicePorts = {
    readonly deploymentRepository: Context.Service.Shape<typeof DeploymentRepositoryPort>;
    readonly deploymentEventService: DeploymentEventService;
    readonly coreEventSyncService: CoreEventSyncServiceShape;
    readonly codeProviders: CodeProviderRegistryShape;
    readonly storageProviders: StorageProviderRegistryShape;
    readonly storagePolicies: StoragePolicyResolverRegistryShape;
    readonly workflow: DeploymentExecutionWorkflowShape;
    readonly queue: DeploymentQueueLifecycleShape;
    readonly deploymentStateMachineService: DeploymentStateMachineShape;
    readonly uploadBundles: UploadBundleRegistryShape;
    readonly projectAccessService: ProjectAccessService["Service"];
    readonly domainRoutingService: Context.Service.Shape<typeof DomainRoutingService>;
    readonly runtimeConfigurationAccessor: RuntimeConfigurationAccessorServiceShape;
    /** Fires a re-converge of the platform ingress when the route table may
     *  have changed (a deployment/preview became live, a rollback moved
     *  the backend container). */
    readonly ingressRefresher: TraefikConfigRefresherShape;
    /** Boundary: the shared access checks and the collaborators above are Effects, and the bodies below still answer Promises. */
    readonly host: Pick<EffectHostShape, "runUnwrapped">;
    /** Cross-service approval guard (`SEC-072`): a production deploy needs a second person without the capability. */
    readonly approvalGuard: ApprovalGuardShape;
};

export function makeDeploymentService(ports: DeploymentServicePorts) {
    const { deploymentRepository, deploymentEventService, coreEventSyncService, codeProviders, storageProviders, storagePolicies, workflow, queue, deploymentStateMachineService, uploadBundles, projectAccessService, domainRoutingService, runtimeConfigurationAccessor, ingressRefresher, host, approvalGuard } = ports;
    const DEPLOYMENT_MUTATION_PLATFORM_ROLES: readonly PlatformRole[] = [
        "superAdmin",
        "admin",
        "operator",
    ];
    const templateProvenanceByDeployment = new Map<string, DeploymentTemplateProvenance>();
    const templateProvenanceByRun = new Map<string, DeploymentTemplateProvenance[]>();
    const compiledSnapshotsById = new Map<string, DeploymentCompiledPlanSnapshot>();
    const compiledSnapshotsByDeployment = new Map<string, DeploymentCompiledPlanSnapshot[]>();
    const compiledSnapshotsByRun = new Map<string, DeploymentCompiledPlanSnapshot>();
    const executionCheckpointsByDeployment = new Map<string, DeploymentExecutionCheckpoint>();
    const executionCheckpointsByRun = new Map<string, DeploymentExecutionCheckpoint>();
    const nodeLifecycleByRun = new Map<string, DeploymentNodeLifecycleEvent[]>();


    /** Registers the deployment namespace on the shared event sync; it needs nothing to stop. */
    function registerEventNamespace(): void {
        coreEventSyncService.registerNamespaceAdapter("deployment", ({ definition, replay, replayLimit }) =>
            toCoreAdapterStream(definition, replay, replayLimit),
        );
    }

    async function uploadBundle(input: { file: File; fileName?: string }) {
        const preferredFileName =
            typeof input.fileName === "string" && input.fileName.trim().length > 0
                ? input.fileName.trim()
                : input.file.name;
        const normalizedFileName = path.basename(preferredFileName);
        const extension = path.extname(normalizedFileName).toLowerCase();
        const allowedExtensions = new Set([".zip", ".tar", ".tgz", ".gz"]);

        if (!allowedExtensions.has(extension)) {
            throw new RuntimeInvalid({ reason: "Unsupported archive format. Allowed formats are: .zip, .tar, .tgz, .gz" });
        }

        const uploadId = randomUUID();
        const uploadsDir = process.env.DEPLOYMENT_UPLOAD_DIR ?? "/tmp/deployer-uploads";
        const targetPath = path.join(uploadsDir, `${uploadId}-${normalizedFileName}`);

        await mkdir(uploadsDir, { recursive: true });
        const bytes = Buffer.from(await input.file.arrayBuffer());
        await writeFile(targetPath, bytes);

        await host.runUnwrapped(uploadBundles.register({
            uploadId,
            uploadPath: targetPath,
            fileName: normalizedFileName,
            fileSize: bytes.byteLength,
            mimeType: input.file.type || "application/octet-stream",
        }));

        return {
            uploadId,
            uploadPath: targetPath,
            fileName: normalizedFileName,
            fileSize: bytes.byteLength,
            mimeType: input.file.type || "application/octet-stream",
        };
    }

    async function listDeployments(input: DeploymentListInput = {} as DeploymentListInput) {
        return deploymentRepository.findMany(input);
    }

    /**
     * List preview environments for a service from the `preview_environments`
     * table (populated by PreviewProvisioningService). Read-only projection.
     */
    async function listServicePreviews(serviceId: string) {
        const rows = await deploymentRepository.findPreviewsByServiceId(serviceId);
        return {
            previews: rows.map((r) => ({
                id: r.id,
                subdomain: r.subdomain,
                fullDomain: r.fullDomain,
                sslEnabled: r.sslEnabled,
                isActive: r.isActive,
                webhookTriggered: r.webhookTriggered,
                expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
                deploymentId: r.deploymentId,
                metadata: r.metadata
                    ? {
                          pullRequestUrl: r.metadata.pullRequestUrl ?? null,
                          branchName: r.metadata.branchName ?? null,
                          lastAccessedAt: r.metadata.lastAccessedAt ?? null,
                          accessCount: r.metadata.accessCount ?? null,
                      }
                    : null,
                createdAt: r.createdAt.toISOString(),
                updatedAt: r.updatedAt.toISOString(),
            })),
        };
    }

    async function getDeploymentById(id: string) {
        const deployment = await deploymentRepository.findById(id);
        if (!deployment) {
            throw new RuntimeNotFound({ reason: `Deployment with id '${id}' not found` });
        }
        return deployment;
    }

    /**
     * B5: promote a preview environment to a stable domain mapping. Requires
     * owner/maintainer/deployer access on the service. Delegates to
     * DomainRoutingService.promotePreviewToStable (idempotent).
     */
    async function promoteServicePreview(
        serviceId: string,
        previewName: string,
        requesterId: string,
        actorPlatformRole: PlatformRole | null = null,
    ) {
        await assertDeploymentServiceAccess(serviceId, requesterId, [
            "owner",
            "maintainer",
            "deployer",
        ], actorPlatformRole);

        const result = await host.runUnwrapped(domainRoutingService.promotePreviewToStable(serviceId, previewName));
        if (!result.promoted) {
            throw new RuntimeInvalid({ reason: result.reason === "subdomain_already_stable"
                    ? `Preview '${previewName}' is already promoted to a stable domain`
                    : result.reason === "no_domain_mapping"
                      ? "Service has no configured domain to promote the preview under"
                      : `Preview promotion failed: ${result.reason ?? "unknown"}` });
        }

        return {
            promoted: true,
            host: result.host,
            reason: null,
            mappingId: result.mappingId ?? null,
        };
    }

    async function assertDeploymentServiceAccess(
        serviceId: string,
        requesterId: string,
        allowedRoles: readonly ProjectRole[],
        requesterPlatformRole: PlatformRole | null = null,
    ): Promise<void> {
        if (
            requesterPlatformRole !== null &&
            DEPLOYMENT_MUTATION_PLATFORM_ROLES.includes(requesterPlatformRole)
        ) {
            return;
        }

        const projectId = await deploymentRepository.getServiceProjectId(serviceId);
        if (!projectId) {
            throw new RuntimeNotFound({ reason: `Service '${serviceId}' not found` });
        }
        const project = await host.runUnwrapped(projectAccessService.findProjectById(projectId));
        if (!project) {
            throw new RuntimeNotFound({ reason: `Project '${projectId}' not found` });
        }
        if (project.ownerId === requesterId) {
            return;
        }
        const collaborator = await host.runUnwrapped(
            projectAccessService.findCollaboratorByUserAndProject(requesterId, projectId),
        );
        if (!collaborator || !allowedRoles.includes(collaborator.role)) {
            throw new RuntimeForbidden({ reason: "You do not have permission to perform this action" });
        }
    }

    async function triggerDeployment(
        input: DeploymentTriggerInput,
        userId: string,
        actorPlatformRole: PlatformRole | null = null,
    ) {
        await assertDeploymentServiceAccess(input.serviceId, userId, [
            "owner",
            "maintainer",
            "deployer",
        ], actorPlatformRole);

        // Deploying to PRODUCTION is a protected action: whoever lacks `deployment:create` needs an approval for THIS
        // service, consumed before anything is queued. Staging and previews keep their normal flow.
        if (input.environment === "production") {
            await host.runUnwrapped(
                approvalGuard.require(userId, "deployment:create", "deployment.create", [input.serviceId]),
            );
        }

        return queueTriggeredDeployment(input, userId);
    }

    /**
     * Trigger a deployment on behalf of the SYSTEM (a webhook, a schedule): nobody is
     * logged in, so there is no membership to check and no user to attribute it to.
     *
     * The caller must already have established the right to act — the controller only
     * reaches this with a verified system-actor claim. Everything else (runtime constraints,
     * state machine, storage) still runs, because it lives in `queueTriggeredDeployment`.
     * `triggeredBy` is stored as null, which the column allows "for webhook triggers".
     */
    async function triggerDeploymentAsSystem(input: DeploymentTriggerInput) {
        return queueTriggeredDeployment(input, null);
    }

    async function queueTriggeredDeployment(input: DeploymentTriggerInput, triggeredBy: string | null) {
        const runtimeConfigurationSeed =
            await deploymentRepository.getRuntimeConfigurationSeed(input.serviceId);

        if (!runtimeConfigurationSeed) {
            throw new RuntimeNotFound({ reason: `Service '${input.serviceId}' not found` });
        }

        const serviceDependencies = await deploymentRepository.getServiceDependencies(input.serviceId);
        const crossProjectDependency = serviceDependencies.find(
            (dependency) => dependency.dependsOnProjectId !== runtimeConfigurationSeed.projectId,
        );

        if (crossProjectDependency) {
            throw new RuntimeInvalid({ reason: `Service dependency '${crossProjectDependency.dependsOnServiceId}' belongs to a different project and cannot be deployed together` });
        }

        const resolvedRuntimeConfiguration = await host.runUnwrapped(runtimeConfigurationAccessor.resolveForDeployment({
            serviceId: input.serviceId,
            projectId: runtimeConfigurationSeed.projectId,
            environment: input.environment,
            sourceType: input.source.sourceType,
            projectSettings: runtimeConfigurationSeed.projectSettings,
            serviceRecord: runtimeConfigurationSeed.service,
        }));
        const stateMachineScopeConfig = buildStateMachineScopeConfig(resolvedRuntimeConfiguration);

        if (!resolvedRuntimeConfiguration.effective.constraints.canDeployToRequestedEnvironment) {
            throw new RuntimeInvalid({ reason: resolvedRuntimeConfiguration.effective.constraints.reason ??
                    "Deployment is blocked by runtime configuration" });
        }

        if (!resolvedRuntimeConfiguration.effective.constraints.providerAllowed) {
            throw new RuntimeInvalid({ reason: "Deployment source provider is not allowed by runtime configuration" });
        }

        if (!resolvedRuntimeConfiguration.effective.constraints.runnerAllowed) {
            throw new RuntimeInvalid({ reason: "Deployment runner is not allowed by runtime configuration" });
        }

        if (input.environment === "preview") {
            const previewTransition = deploymentStateMachineService.evaluatePreviewTransition(
                {
                    operation: "create",
                    environment: input.environment,
                    resolvedPreviewEnabled: resolvedRuntimeConfiguration.effective.deployment.previewEnabled,
                },
                stateMachineScopeConfig,
            );

            if (!previewTransition.canProceed) {
                throw new RuntimeInvalid({ reason: previewTransition.violations.map((violation) => violation.message).join(" ") });
            }
        }

        const sourceCheckout = await host.runUnwrapped(codeProviders.resolveSourceCheckout(input));
        const serviceStorageConfig = await host.runUnwrapped(storagePolicies.resolveServiceStorageConfig({
            serviceId: input.serviceId,
            serviceMetadata: resolvedRuntimeConfiguration.service.metadata,
            source: input.source,
            runtimeConfiguration: resolvedRuntimeConfiguration,
        }));
        const storageBinding = await host.runUnwrapped(storageProviders.resolveStorageBinding(
            input,
            serviceStorageConfig,
        ));

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
        const stateMachine = deploymentStateMachineService.evaluate({
            provider: sourceCheckout?.provider ?? "upload",
            builder: requestedBuilder,
            runner: requestedRuntimeRunner,
            hasContainerImage: Boolean(requestedContainerImage?.trim()),
            hasCustomBuildCommand: Boolean(input.execution?.customCommands?.buildCommand?.trim()),
            hasCustomRunCommand: Boolean(input.execution?.customCommands?.runCommand?.trim()),
        }, stateMachineScopeConfig);

        if (!stateMachine.canProceed) {
            throw new RuntimeInvalid({ reason: stateMachine.violations.map((violation) => violation.message).join(" ") });
        }

        const resolvedBuilder = stateMachine.normalizedBuilder;
        const resolvedRuntimeRunner = stateMachine.normalizedRunner;

        if (
            resolvedRuntimeRunner === "dockerfile" &&
            (!requestedContainerImage || requestedContainerImage.trim().length === 0) &&
            !resolvedBuilder
        ) {
            const sourceProvider = sourceCheckout?.provider ?? input.source.sourceType;
            throw new RuntimeInvalid({ reason: `${sourceProvider} source with runtimeRunner 'dockerfile' requires either an explicit containerImage or compatible execution.builder` });
        }

        const correlationId = randomUUID();

        const deployment = await deploymentRepository.create({
            serviceId: input.serviceId,
            triggeredBy,
            environment: input.environment,
            environmentId: await deploymentRepository.resolveEnvironmentId(input.serviceId, input.environment),
            sourceType: input.source.sourceType,
            sourceConfig: input.source,
        });

        await deploymentRepository.insertLog(deployment.id, {
            level: "info",
            message: "Source provider checkout resolved",
            phase: "queued",
            step: "checkout_resolved",
            stage: "provider",
            correlationId,
            metadata: {
                provider: sourceCheckout?.provider ?? input.source.sourceType,
                resolvedBuilder,
                resolvedRuntimeRunner,
                hasStorageBinding: Boolean(storageBinding),
                structured: true,
            },
        });

        await emitLifecycleQueued(deployment, null, "Deployment queued");

        await enqueueQueueJob({
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
                    triggeredBy,
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

    async function cancelDeployment(id: string, requesterId: string, reason?: string, actorPlatformRole: PlatformRole | null = null) {
        const deployment = await getDeploymentById(id);
        await assertDeploymentServiceAccess(deployment.serviceId, requesterId, [
            "owner",
            "maintainer",
            "deployer",
        ], actorPlatformRole);
        if (!CANCELLABLE_STATUSES.includes(deployment.status as (typeof CANCELLABLE_STATUSES)[number])) {
            throw new RuntimeInvalid({ reason: `Cannot cancel deployment with status '${deployment.status}'. ` +
                    `Only ${CANCELLABLE_STATUSES.join(", ")} deployments can be cancelled.` });
        }
        const cancelledAt = new Date();
        await deploymentRepository.updateStatus(id, "cancelled", {
            cancelReason: reason ?? "user_requested",
            cancelledAt,
        });
        // Stop the work, not just the label: the queued job is cancelled and the worker interrupts the fiber that
        // is building it (killing its child processes).
        await host.runUnwrapped(queue.cancelJobsForDeployment(id, reason ?? "user_requested"));
        const cancelLog = await deploymentRepository.insertLog(id, {
            level: "warn",
            message: "Deployment cancelled",
            phase: "failed",
            stage: "cancel",
            metadata: { reason: reason ?? "user_requested" },
        });
        deploymentEventService.emit(
            "statusChanged",
            { deploymentId: id },
            {
                deploymentId: id,
                status: "cancelled",
                previousStatus: deployment.status,
                timestamp: cancelledAt.toISOString(),
            },
        );
        deploymentEventService.emit(
            "serviceStatusChanged",
            { serviceId: deployment.serviceId },
            {
                serviceId: deployment.serviceId,
                deploymentId: id,
                status: "cancelled",
                timestamp: cancelledAt.toISOString(),
            },
        );
        deploymentEventService.emit(
            "deploymentCancelled",
            { serviceId: deployment.serviceId },
            {
                serviceId: deployment.serviceId,
                deploymentId: id,
                reason: reason,
                timestamp: cancelledAt.toISOString(),
            },
        );
        deploymentEventService.emit("logAppended", { deploymentId: id }, cancelLog);
        return { deploymentId: id, cancelledAt };
    }

    async function rollbackDeployment(
        fromDeploymentId: string,
        targetDeploymentId: string,
        userId: string,
        reason?: string,
        actorPlatformRole: PlatformRole | null = null,
    ) {
        const [fromDeployment, targetDeployment] = await Promise.all([
            getDeploymentById(fromDeploymentId),
            getDeploymentById(targetDeploymentId),
        ]);

        await assertDeploymentServiceAccess(fromDeployment.serviceId, userId, [
            "owner",
            "maintainer",
            "deployer",
        ], actorPlatformRole);

        if (fromDeployment.serviceId !== targetDeployment.serviceId) {
            throw new RuntimeInvalid({ reason: "Both deployments must belong to the same service" });
        }
        if (targetDeployment.status !== "success") {
            throw new RuntimeInvalid({ reason: `Target deployment status is '${targetDeployment.status}', must be 'success' to roll back to` });
        }

        const rollbackStateMachineScopeConfig = await resolveStateMachineScopeConfigForService({
            serviceId: fromDeployment.serviceId,
            environment: fromDeployment.environment,
            sourceType: targetDeployment.sourceType,
        });
        const rollbackTransition = deploymentStateMachineService.evaluateRollbackTransition(
            {
                sourceStatus: fromDeployment.status,
                targetStatus: targetDeployment.status,
                sourceEnvironment: fromDeployment.environment,
                targetEnvironment: targetDeployment.environment,
            },
            rollbackStateMachineScopeConfig,
        );

        if (!rollbackTransition.canProceed) {
            throw new RuntimeInvalid({ reason: rollbackTransition.violations.map((violation) => violation.message).join(" ") });
        }

        const rollback = await deploymentRepository.create({
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
        const rollbackRecord = await deploymentRepository.createRollback({
            fromDeploymentId,
            toDeploymentId: rollback.id,
            triggeredBy: userId,
            reason: reason ?? null,
            metadata: {
                targetDeploymentId,
            },
        });

        const rollbackProjectId = await deploymentRepository.getServiceProjectId(rollback.serviceId);

        await emitLifecycleQueued(rollback, fromDeployment.status, "Rollback deployment queued");

        await enqueueQueueJob({
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

        const rollbackLog = await deploymentRepository.insertLog(rollback.id, {
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
        deploymentEventService.emit(
            "deploymentTriggered",
            { serviceId: rollback.serviceId },
            {
                serviceId: rollback.serviceId,
                deployment: rollback,
                timestamp: now,
            },
        );
        deploymentEventService.emit(
            "rollbackStarted",
            { serviceId: fromDeployment.serviceId },
            {
                serviceId: fromDeployment.serviceId,
                fromDeploymentId,
                toDeploymentId: rollback.id,
                timestamp: now,
            },
        );
        deploymentEventService.emit(
            "serviceStatusChanged",
            { serviceId: rollback.serviceId },
            {
                serviceId: rollback.serviceId,
                deploymentId: rollback.id,
                status: rollback.status,
                timestamp: now,
            },
        );
        deploymentEventService.emit(
            "statusChanged",
            { deploymentId: rollback.id },
            {
                deploymentId: rollback.id,
                status: rollback.status,
                previousStatus: null,
                timestamp: now,
            },
        );
        deploymentEventService.emit(
            "phaseUpdated",
            { deploymentId: rollback.id },
            {
                deploymentId: rollback.id,
                phase: "queued",
                progress: 0,
                timestamp: now,
            },
        );
        deploymentEventService.emit(
            "orchestrationPhaseTransition",
            { deploymentId: rollback.id },
            {
                deploymentId: rollback.id,
                toPhase: "queued",
                progress: 0,
                timestamp: now,
            },
        );
        deploymentEventService.emit(
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
        deploymentEventService.emit("logAppended", { deploymentId: rollback.id }, rollbackLog);
        return rollback;
    }

    async function getDeploymentLogs(
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
        await getDeploymentById(deploymentId); // verify exists
        const [logs, total, buildRetryEvents, deployRetryEvents] = await Promise.all([
            deploymentRepository.findLogs(deploymentId, limit, offset, filters),
            deploymentRepository.countLogs(deploymentId, filters),
            options?.includeRetrySummary
                ? deploymentRepository.countLogs(deploymentId, {
                      step: "build_retry",
                  })
                : Promise.resolve(null),
            options?.includeRetrySummary
                ? deploymentRepository.countLogs(deploymentId, {
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

    async function deleteDeployment(id: string, requesterId: string, actorPlatformRole: PlatformRole | null = null) {
        const deployment = await getDeploymentById(id);
        await assertDeploymentServiceAccess(
            deployment.serviceId,
            requesterId,
            ["owner", "maintainer"],
            actorPlatformRole,
        );
        await deploymentRepository.delete(id);
    }

    async function retryDeployment(id: string, userId: string, actorPlatformRole: PlatformRole | null = null) {
        const deployment = await getDeploymentById(id);
        await assertDeploymentServiceAccess(deployment.serviceId, userId, [
            "owner",
            "maintainer",
            "deployer",
        ], actorPlatformRole);
        const RETRYABLE_STATUSES = ["failed", "cancelled"] as const;
        if (!RETRYABLE_STATUSES.includes(deployment.status as (typeof RETRYABLE_STATUSES)[number])) {
            throw new RuntimeInvalid({ reason: `Cannot retry deployment with status '${deployment.status}'. Only failed or cancelled deployments can be retried.` });
        }
        const retry = await deploymentRepository.create({
            serviceId: deployment.serviceId,
            triggeredBy: userId,
            environment: deployment.environment,
            sourceType: deployment.sourceType,
            sourceConfig: deployment.sourceConfig ?? undefined,
        });
        await emitLifecycleQueued(retry, null, "Retry deployment queued");

        // W10: enqueue the retry into the REAL queue (was a documented no-op).
        // The job runs through the same claim → build → complete flow as a
        // fresh deploy; its context carries the original deployment's source
        // (re-resolved to a checkout so the builder can rebuild without
        // re-triggering provider discovery).
        const projectId = await deploymentRepository.getServiceProjectId(
            deployment.serviceId,
        );
        const correlationId = randomUUID();

        const retrySource = deployment.sourceConfig;
        const sourceCheckout =
            retrySource && "sourceType" in retrySource && retrySource.sourceType
                ? await host.runUnwrapped(codeProviders.resolveSourceCheckout({
                      serviceId: deployment.serviceId,
                      environment: deployment.environment,
                      source: retrySource,
                  }))
                : null;

        await enqueueQueueJob({
            type: "retry",
            idempotencyKey: `retry:${retry.id}`,
            payload: {
                deploymentId: retry.id,
                serviceId: deployment.serviceId,
                projectId: projectId ?? undefined,
                environment: deployment.environment,
                observability: {
                    correlationId,
                    source: "deployment.retry",
                },
                context: {
                    sourceType: deployment.sourceType,
                    sourceConfig: deployment.sourceConfig ?? null,
                    retryOf: id,
                    triggeredBy: userId,
                    correlationId,
                    ...(sourceCheckout ? { sourceCheckout } : {}),
                    ...(sourceCheckout && "runtimeRunner" in sourceCheckout && sourceCheckout.runtimeRunner
                        ? { runtimeRunner: sourceCheckout.runtimeRunner }
                        : {}),
                },
            },
            maxAttempts: 5,
        });
        return retry;
    }

    async function getRollbackHistory(deploymentId: string) {
        await getDeploymentById(deploymentId); // verify exists
        const rollbacks = await deploymentRepository.findRollbacks(deploymentId);
        return { rollbacks };
    }

    async function getDeploymentReplayEvents(deploymentId: string, replayLimit: number): Promise<DeploymentProgressEvent[]> {
        const deployment = await getDeploymentById(deploymentId);
        const logs = await deploymentRepository.findLogs(deploymentId, replayLimit, 0);

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

    async function getServiceReplayEvents(serviceId: string, replayLimit: number): Promise<ServiceDeploymentEvent[]> {
        const deployments = await deploymentRepository.findRecentDeployments({ serviceId }, replayLimit);

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

    async function getFilteredReplayEvents(
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
            deploymentRepository.findRecentDeployments(filters, replayLimit),
            deploymentRepository.findRecentLogs(filters, replayLimit),
        ]);

        const events: DeploymentQueryEvent[] = [];

        for (const item of deployments) {
            const deployment = item.deployment;
            events.push({
                type: "deploymentTriggered",
                deployment,
                emittedAt: toDate(deployment.createdAt),
            });
            events.push({
                type: "statusChanged",
                deploymentId: deployment.id,
                serviceId: deployment.serviceId,
                ...(item.projectId ? { projectId: item.projectId } : {}),
                status: deployment.status,
                environment: deployment.environment,
                emittedAt: toDate(deployment.updatedAt),
            });

            if (deployment.phase) {
                events.push({
                    type: "phaseUpdated",
                    deploymentId: deployment.id,
                    phase: deployment.phase,
                    phaseProgress: deployment.phaseProgress ?? 0,
                    emittedAt: toDate(deployment.updatedAt),
                });
            }

            if (deployment.status === "cancelled") {
                events.push({
                    type: "deploymentCancelled",
                    deploymentId: deployment.id,
                    ...(typeof deployment.metadata?.cancelReason === "string"
                        ? { reason: deployment.metadata.cancelReason }
                        : {}),
                    emittedAt: toDate(deployment.updatedAt),
                });
            }

            if (deployment.metadata?.rollbackFrom) {
                events.push({
                    type: "rollbackStarted",
                    fromDeploymentId: deployment.metadata.rollbackFrom,
                    rollbackDeploymentId: deployment.id,
                    emittedAt: toDate(deployment.updatedAt),
                });
            }
        }

        for (const item of logs) {
            events.push({
                type: "logAppended",
                log: item.log,
                emittedAt: toDate(item.log.timestamp),
            });
        }

        return events.filter((event) => matchesStreamQueryFilters(event, filters));
    }

    async function getProjectServiceIds(projectId: string) {
        return deploymentRepository.findServiceIdsByProject(projectId);
    }

    async function listStreamDefinitions(input: DeploymentStreamListInput | undefined) {
        return deploymentRepository.findStreamMany(input);
    }

    async function getStreamDefinitionById(id: string) {
        const stream = await deploymentRepository.findStreamById(id);
        if (!stream) {
            throw new RuntimeNotFound({ reason: `Deployment stream definition with id '${id}' not found` });
        }
        return stream;
    }

    function getTemplateProvenance(deploymentId: string): DeploymentTemplateProvenance | null {
        return templateProvenanceByDeployment.get(deploymentId) ?? null;
    }

    function upsertTemplateProvenance(
        deploymentId: string,
        input: DeploymentTemplateProvenanceUpsertInput,
    ): Promise<DeploymentTemplateProvenanceUpsertResult> {
        const now = new Date().toISOString();
        const existing = templateProvenanceByDeployment.get(deploymentId);
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

        templateProvenanceByDeployment.set(deploymentId, record);
        if (record.runId) {
            const records = templateProvenanceByRun.get(record.runId) ?? [];
            const next = [...records.filter((item) => item.id !== record.id), record];
            templateProvenanceByRun.set(record.runId, next);
        }

        return Promise.resolve({ persisted: true, provenance: record });
    }

    function getTemplateProvenanceByRun(runId: string): DeploymentTemplateProvenanceByRunResult {
        return {
            runId,
            records: templateProvenanceByRun.get(runId) ?? [],
        };
    }

    function createCompiledPlanSnapshot(
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

        compiledSnapshotsById.set(snapshot.id, snapshot);
        compiledSnapshotsByRun.set(snapshot.runId, snapshot);
        const existing = compiledSnapshotsByDeployment.get(deploymentId) ?? [];
        compiledSnapshotsByDeployment.set(deploymentId, [...existing, snapshot]);

        return { persisted: true, snapshot };
    }

    function listCompiledPlanSnapshots(deploymentId: string): DeploymentListCompiledPlanSnapshotsResult {
        return {
            deploymentId,
            snapshots: compiledSnapshotsByDeployment.get(deploymentId) ?? [],
        };
    }

    function getCompiledPlanSnapshot(snapshotId: string): DeploymentCompiledPlanSnapshot | null {
        return compiledSnapshotsById.get(snapshotId) ?? null;
    }

    function getCompiledPlanSnapshotByRun(runId: string): DeploymentCompiledPlanSnapshotByRunResult {
        return {
            runId,
            snapshot: compiledSnapshotsByRun.get(runId) ?? null,
        };
    }

    function compilePlan(input: DeploymentPlanCompileInput): DeploymentPlanCompileResult {
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

    function compileRollbackEdges(input: DeploymentCompileRollbackEdgesInput): DeploymentCompileRollbackEdgesResult {
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

    /**
     * The job is a row in `deployment_queue_jobs`; the lifecycle service announces it on the typed channel
     * (`onJobQueued`) once it is stored, and the worker claims and executes it. It survives a restart.
     */
    function enqueueQueueJob(input: DeploymentQueueEnqueueInput): Promise<DeploymentQueueEnqueueResult> {
        return host.runUnwrapped(queue.enqueueQueueJob(input));
    }

    async function claimQueueJobs(input: DeploymentQueueClaimInput): Promise<DeploymentQueueClaimResult> {
        const now = Date.now();
        const claimResult = await host.runUnwrapped(queue.claimQueueJobs(input));
        for (const job of claimResult.claimed) {
            await handleClaimedQueueJob(job, now);
        }

        return claimResult;
    }

    async function claimQueueJobByIdempotencyKey(
        idempotencyKey: string,
        input: DeploymentQueueClaimInput,
    ): Promise<DeploymentQueueJob | null> {
        const now = Date.now();
        const claimed = await host.runUnwrapped(queue.claimQueueJobByIdempotencyKey(
            idempotencyKey,
            input,
        ));

        if (!claimed) {
            return null;
        }

        await handleClaimedQueueJob(claimed, now);
        return claimed;
    }

    async function heartbeatQueueJob(jobId: string, input: DeploymentQueueHeartbeatInput): Promise<DeploymentQueueHeartbeatResult> {
        const heartbeat = await host.runUnwrapped(queue.heartbeatQueueJob(jobId, input));
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

    async function completeQueueJob(
        jobId: string,
        input: DeploymentQueueCompleteInput,
    ): Promise<DeploymentQueueTransitionResult> {
        const existing = await host.runUnwrapped(queue.findQueueJobById(jobId));
        if (existing?.workerId !== input.workerId || existing.lockToken !== input.lockToken) {
            throw new RuntimeInvalid({ reason: "Invalid worker/lock token for queue completion" });
        }

        if (existing.type === "deploy" && existing.payload.deploymentId) {
            await host.runUnwrapped(workflow.persistBuildExecutionResult(
                existing.payload.deploymentId,
                input.result,
                existing.payload.observability ?? null,
            ));
        }

        if (existing.type === "retry" && existing.payload.deploymentId) {
            await host.runUnwrapped(workflow.persistBuildExecutionResult(
                existing.payload.deploymentId,
                input.result,
                existing.payload.observability ?? null,
            ));
        }

        if (existing.type === "rollback" && existing.payload.deploymentId) {
            await host.runUnwrapped(workflow.persistRollbackExecutionResult(
                existing.payload.deploymentId,
                getResultString(existing.payload.context, "rollbackId"),
                getResultString(existing.payload.context, "fromDeploymentId"),
                existing.payload.observability ?? null,
                input.result,
            ));
        }

        const completion = await host.runUnwrapped(queue.completeQueueJob(
            jobId,
            input.workerId,
            input.lockToken,
            input.result,
        ));
        if (!completion) {
            throw new RuntimeInvalid({ reason: "Invalid worker/lock token for queue completion" });
        }
        // A deploy, retry, or rollback finished → its container/domain routing
        // may have changed → the ingress must publish the new Host rules.
        if (existing.type === "deploy" || existing.type === "rollback" || existing.type === "retry") {
            ingressRefresher.refresh();
        }
        return completion;
    }

    function getResultString(result: Record<string, unknown> | undefined, key: string): string | null {
        const value = result?.[key];
        return typeof value === "string" && value.trim().length > 0 ? value : null;
    }

    async function handleClaimedQueueJob(job: DeploymentQueueJob, claimedAtMs: number): Promise<void> {
        if ((job.type !== "deploy" && job.type !== "retry") || !job.payload.deploymentId) {
            if (job.type === "rollback" && job.payload.deploymentId) {
                await host.runUnwrapped(workflow.markRollbackExecutionStarted(
                    job.payload.deploymentId,
                    getResultString(job.payload.context, "rollbackId"),
                    getResultString(job.payload.context, "fromDeploymentId"),
                    job.payload.observability ?? null,
                ));
            }
            return;
        }

        await host.runUnwrapped(workflow.markBuildExecutionStarted(
            job.payload.deploymentId,
            new Date(claimedAtMs),
            job.payload.observability ?? null,
        ));
    }

    async function failQueueJob(jobId: string, input: DeploymentQueueFailInput): Promise<DeploymentQueueTransitionResult> {
        const failure = await host.runUnwrapped(queue.failQueueJob(jobId, input));
        if (!failure) {
            throw new RuntimeInvalid({ reason: "Invalid worker/lock token for queue failure" });
        }

        if (failure.failedJob.type === "rollback" && failure.failedJob.payload.deploymentId) {
            void host.runUnwrapped(workflow.persistRollbackExecutionFailure(
                failure.failedJob.payload.deploymentId,
                getResultString(failure.failedJob.payload.context, "rollbackId"),
                getResultString(failure.failedJob.payload.context, "fromDeploymentId"),
                input.error,
            ));
        } else if (failure.failedJob.payload.deploymentId) {
            // W-Queue (Q4): deploy/retry failures now persist to the deployment
            // row (previously only rollback was persisted, leaving deploys stuck
            // at "building" after queue exhaust).
            void host.runUnwrapped(workflow.persistDeploymentExecutionFailure(
                failure.failedJob.payload.deploymentId,
                input.error,
            ));
        }

        return failure.transition;
    }

    function findQueueJobById(jobId: string): Promise<DeploymentQueueJob | null> {
        return host.runUnwrapped(queue.findQueueJobById(jobId));
    }

    function listQueueJobs(input: DeploymentQueueListInput): Promise<DeploymentQueueListResult> {
        return host.runUnwrapped(queue.listQueueJobs(input));
    }

    function listDeadLetterJobs(input: DeploymentDeadLetterListInput): Promise<DeploymentDeadLetterListResult> {
        return host.runUnwrapped(queue.listDeadLetterJobs(input));
    }

    function findDeadLetterJobById(deadLetterJobId: string): Promise<DeploymentDeadLetterJob | null> {
        return host.runUnwrapped(queue.findDeadLetterJobById(deadLetterJobId));
    }

    function replayDeadLetterJob(input: DeploymentDeadLetterReplayInput): Promise<DeploymentDeadLetterReplayResult> {
        return host.runUnwrapped(queue.replayDeadLetterJob(input));
    }

    function listRetryPolicies(input: DeploymentRetryPolicyListInput) {
        return {
            policies: BASE_RETRY_POLICIES.filter((policy) =>
                (!input.jobType || policy.jobType === input.jobType) &&
                (!input.nodeType || policy.nodeType === input.nodeType) &&
                (!input.taskType || policy.taskType === input.taskType) &&
                (!input.enabledOnly || policy.enabled),
            ),
        };
    }

    function resolveRetryPolicy(input: DeploymentRetryPolicyResolveInput): DeploymentRetryPolicyResolveResult {
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

    function cancelExecution(deploymentId: string, input: DeploymentExecutionCancelInput): DeploymentExecutionCancelResult {
        const now = new Date().toISOString();
        const existing = executionCheckpointsByDeployment.get(deploymentId);
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

        executionCheckpointsByDeployment.set(deploymentId, checkpoint);
        executionCheckpointsByRun.set(runId, checkpoint);

        return {
            accepted: true,
            deploymentId,
            runId,
            state: checkpoint.state,
            checkpoint,
            message: "Execution cancellation accepted",
        };
    }

    function resumeExecution(deploymentId: string, input: DeploymentExecutionResumeInput): DeploymentExecutionResumeResult {
        const previous = executionCheckpointsByDeployment.get(deploymentId);
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

        executionCheckpointsByDeployment.set(deploymentId, checkpoint);
        executionCheckpointsByRun.set(runId, checkpoint);

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

    function getExecutionCheckpoint(deploymentId: string): DeploymentExecutionCheckpoint | null {
        return executionCheckpointsByDeployment.get(deploymentId) ?? null;
    }

    function getExecutionCheckpointByRun(runId: string): DeploymentExecutionCheckpointByRunResult {
        return {
            runId,
            checkpoint: executionCheckpointsByRun.get(runId) ?? null,
        };
    }

    function emitNodeLifecycleEvent(
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

        const events = nodeLifecycleByRun.get(runId) ?? [];
        const next = [...events, event].sort((a, b) => a.sequence - b.sequence);
        nodeLifecycleByRun.set(runId, next);

        return { emitted: true, event };
    }

    function listNodeLifecycleEvents(
        runId: string,
        input: Omit<DeploymentNodeLifecycleEventListInput, "runId">,
    ): DeploymentNodeLifecycleEventListResult {
        const events = (nodeLifecycleByRun.get(runId) ?? [])
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

    function streamNodeLifecycleEvents(input: {
        runId: string;
        fromSequence?: number;
        replay: boolean;
        replayLimit: number;
    }): Observable<DeploymentNodeLifecycleEvent> {
        const events = (nodeLifecycleByRun.get(input.runId) ?? [])
            .filter((event) => input.fromSequence === undefined || event.sequence >= input.fromSequence)
            .sort((a, b) => a.sequence - b.sequence);

        const replayEvents = input.replay ? events.slice(-input.replayLimit) : events;

        return from(replayEvents);
    }

    function listPhaseTransitions(input: { from?: string; to?: string }): DeploymentPhaseTransitionsCatalog {
        return {
            transitions: BASE_PHASE_TRANSITIONS.filter((transition) =>
                (!input.from || transition.from === input.from) && (!input.to || transition.to === input.to),
            ),
        };
    }

    function validatePhaseTransition(
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

    async function applyPhaseTransition(
        deploymentId: string,
        input: DeploymentPhaseTransitionApplyInput,
    ): Promise<DeploymentPhaseTransitionApplyResult> {
        const validation = validatePhaseTransition(input);
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
        await deploymentRepository.updatePhase(deploymentId, input.targetPhase, phaseProgress);

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

    function streamDeploymentEvents(input: {
        deploymentId: string;
    } & StreamReplayInput): Observable<StreamEventWithMeta<DeploymentProgressEvent>> {
        const live$ = defer(async () => getDeploymentById(input.deploymentId)).pipe(
            mergeMap((deployment) =>
                mergeEventStreams<DeploymentProgressEvent>([
                    mapEventStream(
                        deploymentEventService.subscribe("statusChanged", {
                            deploymentId: input.deploymentId,
                        }),
                        (event) => ({
                            type: "statusChanged" as const,
                            status: event.status,
                            ...(event.phase ? { phase: event.phase } : {}),
                        }),
                    ),
                    mapEventStream(
                        deploymentEventService.subscribe("phaseUpdated", {
                            deploymentId: input.deploymentId,
                        }),
                        (event) => ({
                            type: "phaseUpdated" as const,
                            phase: event.phase,
                            phaseProgress: event.progress,
                        }),
                    ),
                    mapEventStream(
                        deploymentEventService.subscribe("logAppended", {
                            deploymentId: input.deploymentId,
                        }),
                        (event) => ({ type: "logAppended" as const, log: event }),
                    ),
                    mapEventStream(
                        deploymentEventService.subscribe("deploymentCancelled", {
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
                    mapEventStream(
                        deploymentEventService.subscribe("rollbackStarted", {
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
                    mapEventStream(
                        deploymentEventService.subscribe("rollbackCompleted", {
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

        return toSequencedObservable({
            replay$: input.replay
                ? defer(() => from(getDeploymentReplayEvents(input.deploymentId, input.replayLimit))).pipe(
                      mergeMap((events) => from(events)),
                  )
                : EMPTY,
            live$,
        });
    }

    function streamServiceEvents(input: {
        serviceId: string;
    } & StreamReplayInput): Observable<StreamEventWithMeta<ServiceDeploymentEvent>> {
        const live$ = mergeEventStreams<ServiceDeploymentEvent>([
            mapEventStream(
                deploymentEventService.subscribe("deploymentTriggered", {
                    serviceId: input.serviceId,
                }),
                (event) => ({
                    type: "deploymentTriggered" as const,
                    deployment: event.deployment,
                }),
            ),
            mapEventStream(
                deploymentEventService.subscribe("serviceStatusChanged", {
                    serviceId: input.serviceId,
                }),
                (event) => ({
                    type: "statusChanged" as const,
                    deploymentId: event.deploymentId,
                    status: event.status,
                }),
            ),
            mapEventStream(
                deploymentEventService.subscribe("deploymentCancelled", {
                    serviceId: input.serviceId,
                }),
                (event) => ({
                    type: "deploymentCancelled" as const,
                    deploymentId: event.deploymentId,
                    ...(event.reason ? { reason: event.reason } : {}),
                }),
            ),
        ]);

        return toSequencedObservable({
            replay$: input.replay
                ? defer(() => from(getServiceReplayEvents(input.serviceId, input.replayLimit))).pipe(
                      mergeMap((events) => from(events)),
                  )
                : EMPTY,
            live$,
        });
    }

    function streamQueryEvents(input: {
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
                const projectServiceIds = await getProjectServiceIds(input.projectId);
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
                        mapEventStream(
                            deploymentEventService.subscribe("statusChanged", {
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
                        mapEventStream(
                            deploymentEventService.subscribe("phaseUpdated", {
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
                        mapEventStream(
                            deploymentEventService.subscribe("logAppended", {
                                deploymentId: input.deploymentId,
                            }),
                            (event) => ({ type: "logAppended" as const, log: event }),
                        ),
                    );
                    streams.push(
                        mapEventStream(
                            deploymentEventService.subscribe("metricsSnapshot", {
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
                        mapEventStream(
                            deploymentEventService.subscribe("deploymentTriggered", { serviceId }),
                            (event) => ({
                                type: "deploymentTriggered" as const,
                                deployment: event.deployment,
                            }),
                        ),
                    );
                    streams.push(
                        mapEventStream(
                            deploymentEventService.subscribe("serviceStatusChanged", { serviceId }),
                            (event) => ({
                                type: "statusChanged" as const,
                                deploymentId: event.deploymentId,
                                serviceId: event.serviceId,
                                status: event.status,
                            }),
                        ),
                    );
                    streams.push(
                        mapEventStream(
                            deploymentEventService.subscribe("deploymentCancelled", { serviceId }),
                            (event) => ({
                                type: "deploymentCancelled" as const,
                                deploymentId: event.deploymentId,
                                ...(event.reason ? { reason: event.reason } : {}),
                            }),
                        ),
                    );
                    streams.push(
                        mapEventStream(
                            deploymentEventService.subscribe("rollbackStarted", { serviceId }),
                            (event) => ({
                                type: "rollbackStarted" as const,
                                fromDeploymentId: event.fromDeploymentId,
                                rollbackDeploymentId: event.toDeploymentId,
                            }),
                        ),
                    );
                    streams.push(
                        mapEventStream(
                            deploymentEventService.subscribe("rollbackCompleted", { serviceId }),
                            (event) => ({
                                type: "rollbackCompleted" as const,
                                fromDeploymentId: event.fromDeploymentId,
                                rollbackDeploymentId: event.toDeploymentId,
                                success: event.success,
                            }),
                        ),
                    );
                    streams.push(
                        mapEventStream(
                            deploymentEventService.subscribe("healthCheckUpdated", { serviceId }),
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
                        mapEventStream(
                            deploymentEventService.subscribe("domainRouteUpdated", { serviceId }),
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

                return streams.length > 0 ? mergeEventStreams(streams) : EMPTY;
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
            rxFilter((event) => matchesStreamQueryFilters(event, replayFilters)),
        );

        return toSequencedObservable({
            replay$: input.replay
                ? defer(() =>
                      from(
                          getFilteredReplayEvents(
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

    async function emitLifecycleQueued(
        deployment: Awaited<ReturnType<Context.Service.Shape<typeof DeploymentRepositoryPort>["create"]>>,
        previousStatus: DeploymentStatus | null,
        message: string,
    ) {
        await deploymentRepository.updatePhase(deployment.id, "queued", 0);
        const log = await deploymentRepository.insertLog(deployment.id, {
            level: "info",
            message,
            phase: "queued",
            stage: "queue",
        });

        const now = new Date().toISOString();

        deploymentEventService.emit(
            "deploymentTriggered",
            { serviceId: deployment.serviceId },
            {
                serviceId: deployment.serviceId,
                deployment,
                timestamp: now,
            },
        );

        deploymentEventService.emit(
            "serviceStatusChanged",
            { serviceId: deployment.serviceId },
            {
                serviceId: deployment.serviceId,
                deploymentId: deployment.id,
                status: deployment.status,
                timestamp: now,
            },
        );

        deploymentEventService.emit(
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

        deploymentEventService.emit(
            "phaseUpdated",
            { deploymentId: deployment.id },
            {
                deploymentId: deployment.id,
                phase: "queued",
                progress: 0,
                timestamp: now,
            },
        );

        deploymentEventService.emit(
            "orchestrationPhaseTransition",
            { deploymentId: deployment.id },
            {
                deploymentId: deployment.id,
                toPhase: "queued",
                progress: 0,
                timestamp: now,
            },
        );

        deploymentEventService.emit(
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
            deploymentEventService.emit(
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
            deploymentEventService.emit(
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

        deploymentEventService.emit("logAppended", { deploymentId: deployment.id }, log);
    }

    function mapEventStream<TInput, TOutput extends object>(
        iterable: AsyncIterable<TInput>,
        mapper: (value: TInput) => TOutput | null,
    ): Observable<TOutput> {
        return from(iterable).pipe(
            map((value) => mapper(value)),
            rxFilter((mapped): mapped is TOutput => mapped !== null),
        );
    }

    function mergeEventStreams<T>(streams: Observable<T>[]): Observable<T> {
        return merge(...streams);
    }

    function toSequencedObservable<TEvent extends object>(input: {
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

    function matchesStreamQueryFilters(
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
            const aggregateId = resolveAggregateIdForQueryEvent(event);
            if (!aggregateId || aggregateId !== filters.aggregateId) {
                return false;
            }
        }

        if (filters.since) {
            const eventTime = resolveEventTimestamp(event);
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

    function resolveAggregateIdForQueryEvent(event: DeploymentQueryEvent): string | undefined {
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

    function resolveEventTimestamp(event: DeploymentQueryEvent): Date | undefined {
        switch (event.type) {
            case "deploymentTriggered":
                return toDate(event.deployment.createdAt);
            case "logAppended":
                return toDate(event.log.timestamp);
            default:
                return event.emittedAt;
        }
    }

    function toCoreAdapterStream(
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

        const source$ = streamQueryEvents({
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

    function toDate(value: string | Date): Date {
        return value instanceof Date ? value : new Date(value);
    }

    function buildStateMachineScopeConfig(
        resolvedRuntimeConfiguration: ResolvedRuntimeConfiguration,
    ): DeploymentStateMachineScopeConfigInput {
        return {
            mesh: extractStateMachinePolicyPatch(
                resolvedRuntimeConfiguration.mesh.metadata,
            ),
            project: extractStateMachinePolicyPatch(resolvedRuntimeConfiguration.project.metadata),
            service: extractStateMachinePolicyPatch(resolvedRuntimeConfiguration.service.metadata),
            runtime: {
                previewEnabled: resolvedRuntimeConfiguration.effective.deployment.previewEnabled,
                deploymentStrategy: resolvedRuntimeConfiguration.effective.deployment.strategy,
            },
        };
    }

    async function resolveStateMachineScopeConfigForService(input: {
        serviceId: string;
        environment: "production" | "staging" | "preview" | "development";
        sourceType: string;
    }): Promise<DeploymentStateMachineScopeConfigInput | undefined> {
        const runtimeConfigurationSeed = await deploymentRepository.getRuntimeConfigurationSeed(input.serviceId);
        if (!runtimeConfigurationSeed) {
            return undefined;
        }

        const resolvedRuntimeConfiguration = await host.runUnwrapped(runtimeConfigurationAccessor.resolveForDeployment({
            serviceId: input.serviceId,
            projectId: runtimeConfigurationSeed.projectId,
            environment: input.environment,
            sourceType: input.sourceType,
            projectSettings: runtimeConfigurationSeed.projectSettings,
            serviceRecord: runtimeConfigurationSeed.service,
        }));

        return buildStateMachineScopeConfig(resolvedRuntimeConfiguration);
    }

    function extractStateMachinePolicyPatch(
        metadata: Record<string, unknown> | null | undefined,
    ): Record<string, unknown> | undefined {
        const candidate = metadata?.deploymentStateMachine;
        if (!isRecord(candidate)) {
            return undefined;
        }

        return candidate;
    }

    const methods = lift(
        {
            uploadBundle,
            listDeployments,
            listServicePreviews,
            getDeploymentById,
            promoteServicePreview,
            triggerDeployment,
            triggerDeploymentAsSystem,
            cancelDeployment,
            rollbackDeployment,
            getDeploymentLogs,
            deleteDeployment,
            retryDeployment,
            getRollbackHistory,
            getDeploymentReplayEvents,
            getServiceReplayEvents,
            getFilteredReplayEvents,
            getProjectServiceIds,
            listStreamDefinitions,
            getStreamDefinitionById,
            getTemplateProvenance,
            upsertTemplateProvenance,
            getTemplateProvenanceByRun,
            createCompiledPlanSnapshot,
            listCompiledPlanSnapshots,
            getCompiledPlanSnapshot,
            getCompiledPlanSnapshotByRun,
            compilePlan,
            compileRollbackEdges,
            enqueueQueueJob,
            claimQueueJobs,
            claimQueueJobByIdempotencyKey,
            heartbeatQueueJob,
            completeQueueJob,
            failQueueJob,
            findQueueJobById,
            listQueueJobs,
            listDeadLetterJobs,
            findDeadLetterJobById,
            replayDeadLetterJob,
            listRetryPolicies,
            resolveRetryPolicy,
            cancelExecution,
            resumeExecution,
            getExecutionCheckpoint,
            getExecutionCheckpointByRun,
            emitNodeLifecycleEvent,
            listNodeLifecycleEvents,
            listPhaseTransitions,
            validatePhaseTransition,
            applyPhaseTransition,
            streamDeploymentEvents,
            streamServiceEvents,
            streamQueryEvents,
            streamNodeLifecycleEvents,
        },
        ["streamDeploymentEvents", "streamServiceEvents", "streamQueryEvents", "streamNodeLifecycleEvents"] as const,
    );
    return { ...methods, onStart: () => Effect.sync(registerEventNamespace) };
}

/**
 * The deployment core: triggers, cancels, rollbacks and retries, the queue's claim/heartbeat/complete/fail, the
 * compiled plans and execution checkpoints, and the progress streams.
 *
 * Every method is an Effect that fails with what the body threw (the `Runtime*` refusals reach `serve` as they are);
 * the four `stream*` methods return RxJS Observables. It holds in-memory state (provenance, snapshots, checkpoints),
 * so a module builds it once with `useFactory`, and it registers the deployment event namespace in `onStart`.
 */
export type DeploymentServiceShape = ReturnType<typeof makeDeploymentService>;

export class DeploymentService extends Context.Service<DeploymentService, DeploymentServiceShape>()(
    "runtime/DeploymentService",
) {}
