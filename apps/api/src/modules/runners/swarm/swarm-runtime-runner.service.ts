/**
 * SwarmRuntimeRunnerService — deploys user deployments as Swarm services
 * through the dockerode SDK (no CLI), behind the `DeploymentRuntimeRunner`
 * contract.
 *
 * Flow: cluster-ready gate → build canonical `SwarmServiceSpecInput` →
 * `toDockerServiceSpec` (pure mapper) → idempotent create/update →
 * wait for tasks to reach `running` within the health-gate budget.
 *
 * Swarm owns convergence: the service UpdateConfig uses
 * `FailureAction: rollback` + healthchecks, so the engine itself rolls back
 * failed updates. This runner adds the platform-level exec contract
 * (typed result, task-state verification, inventory-friendly labels).
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AppError, BadRequestError, ConflictError, TimeoutError } from "@repo/errors";
import type {
    DockerodeServiceSummary,
    DockerodeTaskSummary,
    SwarmHealthcheckConfig,
    SwarmServiceSpecInput,
    SwarmTaskStateCheck,
} from "@repo/contracts-entities";
import { SwarmClusterService } from "@repo/nest-swarm";
import { verifySwarmRouteAgainstTraefik } from "@/core/modules/traefik/services/swarm-route-verifier";
import { parsePlacementPolicyLabel, toSwarmPlacement } from "@repo/nest-swarm";
import { DockerService } from "@repo/nest-docker/services/docker.service";
import { platformOverlayForPrefix } from "@repo/nest-docker/services/docker-supervisor-runtime";
import { EnvService } from "@/config/env/env.module";
import {
    type DeploymentRuntimeRunner,
    type DeploymentRuntimeRunnerType,
    type RuntimeExecutionInput,
    type RuntimeExecutionResult,
} from "../runtime-runner.interface";
import { toDockerServiceSpec } from "@repo/nest-docker/services/swarm-spec.mapper";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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

@Injectable()
export class SwarmRuntimeRunnerService implements DeploymentRuntimeRunner {
    readonly runnerType: DeploymentRuntimeRunnerType = "swarm";
    private readonly logger = new Logger(SwarmRuntimeRunnerService.name);

    constructor(
        private readonly dockerService: DockerService,
        private readonly clusterService: SwarmClusterService,
        private readonly env: EnvService,
    ) {}

    /**
     * SW-027 — graceful service removal (drains tasks). No-op when the
     * service no longer exists.
     */
    async removeService(serviceName: string): Promise<void> {
        await this.clusterService.assertClusterReady();
        await this.dockerService.removeSwarmService(serviceName);
        this.logger.log(`Removed swarm service ${serviceName}`);
    }

    /**
     * SW-027 — scale a service to an exact replica count (≥0).
     */
    async scaleService(serviceName: string, replicas: number): Promise<void> {
        await this.clusterService.assertClusterReady();
        await this.dockerService.scaleSwarmService(serviceName, replicas);
        this.logger.log(`Scaled swarm service ${serviceName} → ${String(Math.max(0, Math.floor(replicas)))}`);
    }

    /**
     * SW-027 — roll back a service to its previous known-good spec (engine
     * applies the service's own RollbackConfig).
     */
    async rollbackService(serviceName: string): Promise<void> {
        await this.clusterService.assertClusterReady();
        await this.dockerService.rollbackSwarmService(serviceName);
        this.logger.log(`Rolled back swarm service ${serviceName}`);
    }

    async executeRuntime(input: RuntimeExecutionInput): Promise<RuntimeExecutionResult> {
        await this.clusterService.assertClusterReady();

        const { deployment, artifact, healthGateConfig, executorOptions, convergenceConfig } = input;
        const containerImage =
            artifact.containerImage ?? deployment.deploymentContainerImage ?? "nginx:alpine";
        const serviceName =
            deployment.deploymentContainerName
            ?? `deployer-${deployment.serviceId.slice(0, 12)}-${deployment.deploymentId.slice(0, 8)}`;
        const networkMode = deployment.networkMode ?? null;

        const managedLabels: Record<string, string> = {
            "deployer.managed": "true",
            "deployer.managed_by": "deployment_service",
            "deployer.managed_reason": "deployment_execution",
            "deployer.deployment_id": deployment.deploymentId,
            "deployer.service_id": deployment.serviceId,
            "deployer.runtime_runner": this.runnerType,
            "deployer.image_ref": containerImage,
            ...(deployment.projectId ? { "deployer.project_id": deployment.projectId } : {}),
            ...this.sanitizeExecutorLabels(executorOptions?.labels),
        };

        const healthCheckUrl = deployment.healthCheckUrl ?? null;
        const healthcheck: SwarmHealthcheckConfig = healthCheckUrl
            ? {
                  test: ["CMD-SHELL", `wget --no-verbose --tries=1 --spider "${healthCheckUrl}" || exit 1`],
                  intervalMs: healthGateConfig.retryIntervalMs,
                  timeoutMs: Math.max(5_000, healthGateConfig.retryIntervalMs),
                  retries: Math.min(5, Math.max(1, healthGateConfig.maxRetries)),
              }
            : null;

        const networks: SwarmServiceSpecInput["networks"] = [];
        if (networkMode && networkMode !== "host" && networkMode !== "none") {
            // ── `bridge` IS NOT A JOINABLE SWARM NETWORK ─────────────────────────
            // A swarm task cannot attach to the engine's default `bridge`: that
            // network is NODE-LOCAL, so a task scheduled on another node would
            // fail to join it outright. The service-config default really is the
            // literal string `"bridge"` (see `service-config-defaults`), so
            // forwarding it blindly made every default-configured deployment
            // depend on landing on the same node as... nothing, since no other
            // task is on it either.
            //
            // Skipped rather than rejected: the platform overlay below is what
            // makes the service reachable, and failing a deploy over a default
            // the operator never chose would be worse than ignoring it.
            if (networkMode !== "bridge") {
                // Alias the service name on every network it joins: a swarm service
                // without aliases only answers to its own name, which breaks the
                // alias-based URLs this platform persists.
                networks.push({ target: networkMode, aliases: [serviceName] });
            }
        }
        if (deployment.projectId) {
            const overlayName = `deployer-${deployment.projectId}`;
            await this.dockerService.ensureOverlayNetwork({
                name: overlayName,
                driver: "overlay",
                attachable: true,
                ingress: false,
                labels: {
                    "deployer.project_id": deployment.projectId,
                    "deployer.managed": "true",
                },
                enableIpv6: false,
            });
            if (!networks.some((attachment) => attachment.target === overlayName)) {
                networks.push({ target: overlayName, aliases: [serviceName] });
            }
        }

        // ── THE PLATFORM OVERLAY: HOW TRAEFIK REACHES THIS SERVICE ───────────
        // WITHOUT THIS THE DEPLOYMENT IS UNREACHABLE. The platform routes a
        // deployed hostname to `http://<containerName>:<port>` — a NAME, which
        // resolves only on a network the ingress is also attached to. Traefik
        // sits on `deployer-platform-overlay`, while the project overlay above is
        // a DIFFERENT network, and nothing joined the two: the route existed, the
        // service ran, and every request through the ingress answered 502 because
        // the backend name resolved nowhere Traefik could see.
        //
        // So the service is attached to BOTH: its project overlay (sibling
        // services reach it there) and the platform overlay (the ingress reaches
        // it there). That is what makes a workload publishable at all.
        const platformOverlay = platformOverlayForPrefix(this.env.get("DEPLOYER_PREFIX"));
        await this.dockerService.ensureOverlayNetwork({
            name: platformOverlay,
            driver: "overlay",
            attachable: true,
            ingress: false,
            labels: { "deployer.managed": "true", "deployer.platform": "true" },
            enableIpv6: false,
        });
        if (!networks.some((attachment) => attachment.target === platformOverlay)) {
            // Aliased by service name for the same reason as every other
            // attachment: the route's backend is the NAME, and Traefik resolves it
            // on this network.
            networks.push({ target: platformOverlay, aliases: [serviceName] });
        }

        const specInput: SwarmServiceSpecInput = {
            name: serviceName,
            image: containerImage,
            mode: "replicated",
            replicas: 1,
            env: this.sanitizeEnvironmentVariables(executorOptions?.environmentVariables),
            command: [],
            args: executorOptions?.startupCommand ? ["sh", "-lc", executorOptions.startupCommand] : [],
            labels: managedLabels,
            containerLabels: {},
            mounts: this.buildStorageMounts(input),
            placementPreferences: this.resolvePlacement(input).preferences,
            placementConstraints: this.resolvePlacement(input).constraints,
            resourcesLimits: {
                ...(typeof deployment.cpuShares === "number" && deployment.cpuShares > 0
                    ? { nanoCpus: Math.trunc(deployment.cpuShares * 1_000_000_000) }
                    : {}),
                ...(typeof deployment.memoryLimitBytes === "number" && deployment.memoryLimitBytes > 0
                    ? { memoryBytes: Math.trunc(deployment.memoryLimitBytes) }
                    : {}),
            },
            resourcesReservations: {},
            // Each overlay is attached with the service name as its DNS alias, so
            // sibling services and Traefik reach this deployment by the same name
            // they already use.
            networks,
            healthcheck,
            updateConfig: {
                parallelism: 1,
                delayMs: 0,
                order: "start-first",
                failureAction: "rollback",
            },
            endpointPorts: [],
            capabilitiesAdd: [],
            // USER WORKLOADS keep the default VIP endpoint: they may be scaled to
            // many replicas, so the load-balanced name is what consumers want.
            endpointMode: "vip",
            // Give workloads a window to shut down on their own terms.
            stopGracePeriodSeconds: 30,
        };
        const spec = toDockerServiceSpec(specInput);

        this.logger.log(
            `Deploying swarm service ${serviceName} (image=${containerImage}, attachments=${networks.length > 0 ? networks.map((n) => n.target).join(",") : "none"})`,
        );

        // ── Idempotent create-or-update ──────────────────────────────────────
        const start = Date.now();
        let serviceSummary: DockerodeServiceSummary;
        let created = false;
        try {
            const existing = await this.dockerService.inspectSwarmService(serviceName);
            await this.dockerService.updateSwarmService(serviceName, existing.Version.Index, spec, false);
            serviceSummary = await this.dockerService.inspectSwarmService(serviceName);
            this.logger.log(`Updated existing swarm service ${serviceName} (version=${String(existing.Version.Index)})`);
        } catch (error: unknown) {
            if (error instanceof NotFoundException) {
                serviceSummary = await this.dockerService.createSwarmService(spec);
                created = true;
                this.logger.log(`Created swarm service ${serviceName} (id=${serviceSummary.ID ?? "unknown"})`);
            } else {
                throw error;
            }
        }

        // Docker types `ID` as optional; a service we just created or
        // inspected must have one. Fail fast rather than assert a string.
        if (serviceSummary.ID === undefined) {
            throw new AppError(
                `Swarm service ${serviceName} was inspected without an ID`,
                "SWARM_SERVICE_MISSING_ID",
                { serviceName },
            );
        }

        // ── Health gate: wait for tasks to reach Running within budget ───────
        const maxRetries = Math.max(1, healthGateConfig.maxRetries);
        const retryIntervalMs = Math.max(500, healthGateConfig.retryIntervalMs);
        let check: SwarmTaskStateCheck = computeTaskStateCheck([], 1);
        let taskList: DockerodeTaskSummary[] = [];
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            taskList = await this.dockerService.listSwarmServiceTasks(serviceSummary.ID);
            check = computeTaskStateCheck(taskList, 1);
            this.logger.debug(
                `Swarm task convergence attempt ${String(attempt)}/${String(maxRetries)}: ${String(check.runningCount)} running, ${String(check.failedCount)} failed`,
            );
            if (check.ready) {
                break;
            }
            if (check.failedCount > 0) {
                const failedTask = taskList.find(
                    (task) => task.Status.State === "failed" || task.Status.State === "rejected",
                );
                throw new ConflictError(
                    `Swarm service ${serviceName} tasks failed to converge (${String(check.failedCount)} failed)`,
                    serviceName,
                    {
                        deploymentId: deployment.deploymentId,
                        taskId: failedTask?.ID ?? null,
                        taskError: failedTask?.Status.Err ?? failedTask?.Status.State ?? "unknown",
                    },
                );
            }
            if (attempt < maxRetries) {
                await sleep(retryIntervalMs);
            }
        }
        if (!check.ready) {
            throw new TimeoutError(
                `waiting for swarm service ${serviceName} to reach running state`,
                maxRetries * retryIntervalMs,
            );
        }

        const verifiedAt = new Date().toISOString();
        this.logger.log(
            `Swarm service ${serviceName} converged (${String(check.runningCount)} running, created=${String(created)}, durationMs=${String(Date.now() - start)})`,
        );

        // SW-023: with the Traefik swarm provider, routes converge from labels.
        // Verify-only probe (never writes config); fallback to the label-based
        // statement when the Traefik API is unreachable (converges async).
        const fallbackRouteVerification = {
            applied: true,
            syncResult: {
                configId: serviceName,
                configName: serviceName,
                action: "labels_applied",
                message: "Traefik swarm provider converges from service labels",
                syncedAt: verifiedAt,
            },
            healthSummary: taskList.map((task) => ({
                id: task.ID,
                state: task.Status.State,
                nodeId: task.NodeID ?? null,
            })),
            attempts: 1,
            verifiedAt,
        };

        let routeVerification = fallbackRouteVerification;
        const verifyHost = this.extractVerifyHost(input);
        if (verifyHost) {
            try {
                const result = await verifySwarmRouteAgainstTraefik(verifyHost, {
                    maxAttempts: convergenceConfig?.traefikSyncMaxAttempts ?? 3,
                    retryDelayMs: convergenceConfig?.retryBaseDelayMs ?? 250,
                });
                this.logger.log(
                    `Traefik swarm route verification for ${verifyHost}: ${
                        result.verified ? "converged" : "pending"
                    }${result.routerName ? ` (router=${result.routerName})` : ""}${!result.verified && result.error ? ` — ${result.error}` : ""}`,
                );
                routeVerification = {
                    ...fallbackRouteVerification,
                    syncResult: {
                        ...fallbackRouteVerification.syncResult,
                        action: result.verified ? "verified" : "labels_applied",
                        message: result.verified
                            ? `Traefik route converged (router=${result.routerName ?? "unknown"})`
                            : fallbackRouteVerification.syncResult.message,
                    },
                    attempts: Math.max(1, result.attempts),
                };
            } catch (verifyError: unknown) {
                this.logger.warn(
                    `Traefik route verification probe failed for ${verifyHost}: ${
                        verifyError instanceof Error ? verifyError.message : String(verifyError)
                    }`,
                );
            }
        }

        return {
            containerId: serviceSummary.ID,
            containerName: serviceName,
            containerImage,
            routeVerification,
            healthGate: {
                passed: true,
                containerId: serviceSummary.ID,
                healthCheckUrl,
                maxRetries,
                retryIntervalMs,
                verifiedAt,
            },
            serviceId: serviceSummary.ID,
            serviceName,
            taskIds: taskList.map((task) => task.ID),
            managedRuntime: {
                managedBy: "deployment_service",
                managedReason: "deployment_execution",
                deploymentId: deployment.deploymentId,
                serviceId: deployment.serviceId,
                projectId: deployment.projectId ?? null,
                imageRef: containerImage,
                networkMode,
                labels: managedLabels,
            },
        };
    }

    /**
     * Best-effort host to verify against Traefik's swarm provider: derive from
     * the health-check URL host when it is a real hostname (not localhost/IP).
     * Returns null when there is nothing meaningful to probe.
     */
    private extractVerifyHost(input: RuntimeExecutionInput): string | null {
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
    private resolvePlacement(input: RuntimeExecutionInput): { constraints: string[]; preferences: { spreadDescriptor: string }[] } {
        const policy = parsePlacementPolicyLabel(input.executorOptions?.labels?.["deployer.placement"]);
        return toSwarmPlacement({ policy, tenantId: input.deployment.projectId ?? undefined });
    }

    private sanitizeExecutorLabels(labels?: Record<string, string>): Record<string, string> {
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

    private sanitizeEnvironmentVariables(environmentVariables?: Record<string, string>): string[] {
        if (!environmentVariables) {
            return [];
        }
        return Object.entries(environmentVariables)
            .filter(([key]) => key.length > 0)
            .map(([key, value]) => `${key}=${value}`);
    }

    private buildStorageMounts(input: RuntimeExecutionInput): SwarmServiceSpecInput["mounts"] {
        const binding = input.storageBinding;
        if (!binding) {
            return [];
        }
        if (binding.storageType !== "volume") {
            throw new BadRequestError(
                "Swarm runtime runner supports 'volume' storage bindings only; use the direct docker runner for local/s3/nfs storage",
                {
                    storageType: binding.storageType,
                    deploymentId: input.deployment.deploymentId,
                },
            );
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
}