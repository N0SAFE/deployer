import type { DockerodeTaskSummary, SwarmServiceSpecInput, SwarmTaskStateCheck } from "@deployer/contracts-entities";
import { parsePlacementPolicyLabel, toSwarmPlacement } from "@deployer/swarm";
import { RuntimeInvalid } from "../../../core/runtime.errors";
import type { RuntimeExecutionInput } from "../runtime-runner.interface";

/**
 * The swarm runner's pure decisions: what a task list means, where a workload may be scheduled,
 * and what its labels, env and storage become on the service spec. None of it touches the cluster.
 */

export function computeTaskStateCheck(tasks: DockerodeTaskSummary[], replicas: number): SwarmTaskStateCheck {
    const runningCount = tasks.filter((task) => task.Status.State === "running").length;
    const failedCount = tasks.filter(
        (task) => task.Status.State === "failed" || task.Status.State === "rejected",
    ).length;
    return {
        runningCount,
        failedCount,
        totalCount: tasks.length,
        ready: runningCount >= replicas && failedCount === 0 && tasks.length >= replicas,
    };
}

/**
 * Best-effort host to verify against Traefik's swarm provider: derive from
 * the health-check URL host when it is a real hostname (not localhost/IP).
 * Returns null when there is nothing meaningful to probe.
 */
export function extractVerifyHost(input: RuntimeExecutionInput): string | null {
    const url = input.deployment.healthCheckUrl;
    if (!url) {
        return null;
    }
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        if (host === "localhost" || host === "127.0.0.1" || host === "::1" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
            return null;
        }
        return host;
    } catch {
        return null;
    }
}

/**
 * Placement resolution (P6): executor label `deployer.placement` maps to
 * Swarm constraints/preferences. Default = no constraints → user
 * workloads schedule on ALL nodes (managers included) — shared nodes.
 */
export function resolvePlacement(input: RuntimeExecutionInput): {
    constraints: string[];
    preferences: { spreadDescriptor: string }[];
} {
    const policy = parsePlacementPolicyLabel(input.executorOptions?.labels?.["deployer.placement"]);
    return toSwarmPlacement({ policy, tenantId: input.deployment.projectId ?? undefined });
}

export function sanitizeExecutorLabels(labels?: Record<string, string>): Record<string, string> {
    if (!labels) {
        return {};
    }
    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(labels)) {
        if (key.length > 0 && value.length > 0) {
            sanitized[key] = value;
        }
    }
    return sanitized;
}

export function sanitizeEnvironmentVariables(environmentVariables?: Record<string, string>): string[] {
    if (!environmentVariables) {
        return [];
    }
    return Object.entries(environmentVariables)
        .filter(([key]) => key.length > 0)
        .map(([key, value]) => `${key}=${value}`);
}

export function buildStorageMounts(input: RuntimeExecutionInput): SwarmServiceSpecInput["mounts"] {
    const binding = input.storageBinding;
    if (!binding) {
        return [];
    }
    if (binding.storageType !== "volume") {
        throw new RuntimeInvalid({
            reason: "Swarm runtime runner supports 'volume' storage bindings only; use the direct docker runner for local/s3/nfs storage",
        });
    }
    return [
        {
            type: "volume",
            source: `deployer-storage-${input.deployment.deploymentId}`,
            target: binding.mountPath,
            readOnly: false,
        },
    ];
}
