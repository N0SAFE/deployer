import type { DeploymentObservabilityContext, RuntimeRunnerOptions } from "@deployer/contracts-entities";
import type { DeploymentStorageBinding } from "../deployment/storage/base/storage-provider.interface";

export type BuildArtifactResult = {
    containerImage: string | null;
    containerName: string | null;
    artifactDigest: string | null;
    artifactSizeBytes: number | null;
    buildLogsUrl: string | null;
}

export type HealthGateConfig = {
    maxRetries: number;
    retryIntervalMs: number;
}

export type RuntimeExecutorOptions = {
    labels?: Record<string, string>;
    startupCommand?: string;
    environmentVariables?: Record<string, string>;
}

export type RuntimeConvergenceConfig = {
    traefikSyncMaxAttempts: number;
    retryBaseDelayMs: number;
}

export type RuntimeDeploymentContext = {
    deploymentId: string;
    serviceId: string;
    projectId?: string | null;
    deploymentContainerName: string | null;
    deploymentContainerImage: string | null;
    healthCheckUrl: string | null;
    cpuShares?: number;
    memoryLimitBytes?: number;
    networkMode?: string;
}

/** Derived from the SSOT discriminated union (entities/deployment/runtime-runner-options.schema.ts). */
export type RuntimeRunnerExecutionOptions = RuntimeRunnerOptions;

export type RuntimeExecutionInput = {
    deployment: RuntimeDeploymentContext;
    artifact: BuildArtifactResult;
    healthGateConfig: HealthGateConfig;
    runtimeRunnerOptions?: RuntimeRunnerExecutionOptions;
    executorOptions?: RuntimeExecutorOptions;
    convergenceConfig?: RuntimeConvergenceConfig;
    storageBinding?: DeploymentStorageBinding | null;
    observability?: DeploymentObservabilityContext | null;
}

export type RuntimeExecutionResult = {
    containerId: string;
    containerName: string;
    containerImage: string;
    /** Swarm services resolve to a service id/name + tasks instead of a plain container. */
    serviceId?: string | null;
    serviceName?: string | null;
    taskIds?: string[];
    routeVerification: {
        applied: boolean;
        syncResult: {
            configId: string;
            configName: string;
            action: string;
            message: string;
            syncedAt: string | null;
        };
        healthSummary: unknown;
        attempts: number;
        verifiedAt: string;
    };
    healthGate: {
        passed: true;
        containerId: string;
        healthCheckUrl: string | null;
        maxRetries: number;
        retryIntervalMs: number;
        verifiedAt: string;
    };
    managedRuntime?: {
        managedBy: "deployment_service" | "orphan";
        managedReason: string;
        deploymentId: string | null;
        serviceId: string | null;
        projectId: string | null;
        imageRef: string;
        networkMode: string | null;
        labels: Record<string, string>;
    };
}

export const DEPLOYMENT_RUNTIME_RUNNER_TYPES = [
    "docker",
    "dockerfile",
    "docker_compose",
    "nixpacks",
    "buildpack",
    "railpack",
    "swarm",
] as const;

export type DeploymentRuntimeRunnerType = (typeof DEPLOYMENT_RUNTIME_RUNNER_TYPES)[number];

export type DeploymentRuntimeRunner = {
    readonly runnerType: DeploymentRuntimeRunnerType;
    executeRuntime(input: RuntimeExecutionInput): Promise<RuntimeExecutionResult>;
}
