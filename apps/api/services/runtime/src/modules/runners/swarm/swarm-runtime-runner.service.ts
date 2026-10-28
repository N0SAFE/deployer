/**
 * SwarmRuntimeRunner — deploys user deployments as Swarm services
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

import { Context, Effect, Layer } from "effect";

import { AppError, TimeoutError } from "@deployer/errors";
import type {
    DockerodeServiceSummary,
    DockerodeTaskSummary,
    SwarmHealthcheckConfig,
    SwarmServiceSpecInput,
    SwarmTaskStateCheck,
} from "@deployer/contracts-entities";
import { platformOverlayForPrefix } from "@deployer/nest-docker/services/docker-supervisor-runtime";
import { DockerEngine, type DockerEngineShape } from "@deployer/docker";
import { toDockerServiceSpec } from "@deployer/nest-docker/services/swarm-spec.mapper";
import type { SwarmClusterService } from "@deployer/nest-swarm";
import type { EnvService } from "@deployer/shared/config/env/env.module";
import { verifySwarmRouteAgainstTraefik } from "@deployer/shared/core/modules/traefik/services/swarm-route-verifier";
import { attempt } from "../../../core/effects";
import { RuntimeConflict } from "../../../core/runtime.errors";
import { resolveContainerImage } from "../base/container-image.guard";
import { RunnerEnvPort, RunnerSwarmClusterPort } from "../runners.ports";
import type { DeploymentRuntimeRunner, RuntimeExecutionInput } from "../runtime-runner.interface";
import {
    buildStorageMounts,
    computeTaskStateCheck,
    extractVerifyHost,
    resolvePlacement,
    sanitizeEnvironmentVariables,
    sanitizeExecutorLabels,
} from "./swarm-runner.helpers";

const RUNNER_TYPE = "swarm" as const;

/** The swarm runner also manages the services it deployed (SW-027). */
export type SwarmRuntimeRunnerShape = DeploymentRuntimeRunner & {
    /** Graceful service removal (drains tasks). No-op when the service no longer exists. */
    readonly removeService: (serviceName: string) => Effect.Effect<void, unknown>;
    /** Scale a service to an exact replica count (≥0). */
    readonly scaleService: (serviceName: string, replicas: number) => Effect.Effect<void, unknown>;
    /** Roll back to the previous known-good spec (the engine applies the service's own RollbackConfig). */
    readonly rollbackService: (serviceName: string) => Effect.Effect<void, unknown>;
};

export class SwarmRuntimeRunner extends Context.Service<SwarmRuntimeRunner, SwarmRuntimeRunnerShape>()(
    "runtime/SwarmRuntimeRunner",
) {
    static readonly Live: Layer.Layer<
        SwarmRuntimeRunner,
        never,
        DockerEngine | RunnerSwarmClusterPort | RunnerEnvPort
    > = Layer.effect(
        SwarmRuntimeRunner,
        Effect.gen(function* () {
            return makeSwarmRuntimeRunner({
                docker: yield* DockerEngine,
                cluster: yield* RunnerSwarmClusterPort,
                env: yield* RunnerEnvPort,
            });
        }),
    );
}

export function makeSwarmRuntimeRunner(ports: {
    readonly docker: DockerEngineShape;
    readonly cluster: SwarmClusterService;
    readonly env: EnvService;
}): SwarmRuntimeRunnerShape {
    const { docker, cluster, env } = ports;

    const assertClusterReady = attempt(() => cluster.assertClusterReady());

    const removeService = Effect.fn("SwarmRuntimeRunner.removeService")(function* (serviceName: string) {
        yield* assertClusterReady;
        yield* docker.swarmServices.remove(serviceName);
        yield* Effect.logInfo(`Removed swarm service ${serviceName}`);
    });

    const scaleService = Effect.fn("SwarmRuntimeRunner.scaleService")(function* (serviceName: string, replicas: number) {
        yield* assertClusterReady;
        yield* docker.swarmServices.scale(serviceName, replicas);
        yield* Effect.logInfo(`Scaled swarm service ${serviceName} → ${String(Math.max(0, Math.floor(replicas)))}`);
    });

    const rollbackService = Effect.fn("SwarmRuntimeRunner.rollbackService")(function* (serviceName: string) {
        yield* assertClusterReady;
        yield* docker.swarmServices.rollback(serviceName);
        yield* Effect.logInfo(`Rolled back swarm service ${serviceName}`);
    });

    /** Idempotent create-or-update: an existing service is updated in place, a missing one created. */
    const createOrUpdateService = Effect.fn("SwarmRuntimeRunner.createOrUpdateService")(function* (
        serviceName: string,
        spec: ReturnType<typeof toDockerServiceSpec>,
    ) {
        const existing = yield* docker.swarmServices.inspect(serviceName).pipe(
            Effect.map((summary) => ({ found: true as const, summary })),
            Effect.catchTag("DockerNotFound", () => Effect.succeed({ found: false as const })),
        );
        if (existing.found) {
            yield* docker.swarmServices.update(serviceName, existing.summary.Version.Index, spec, false);
            const summary = yield* docker.swarmServices.inspect(serviceName);
            yield* Effect.logInfo(
                `Updated existing swarm service ${serviceName} (version=${String(existing.summary.Version.Index)})`,
            );
            return { summary, created: false };
        }
        const summary = yield* docker.swarmServices.create(spec);
        yield* Effect.logInfo(`Created swarm service ${serviceName} (id=${summary.ID ?? "unknown"})`);
        return { summary, created: true };
    });

    /** Health gate: wait for tasks to reach Running within the budget; a failed task fails fast. */
    const awaitTaskConvergence = Effect.fn("SwarmRuntimeRunner.awaitTaskConvergence")(function* (
        serviceId: string,
        serviceName: string,
        maxRetries: number,
        retryIntervalMs: number,
    ) {
        let check: SwarmTaskStateCheck = computeTaskStateCheck([], 1);
        let taskList: DockerodeTaskSummary[] = [];
        for (let attemptNumber = 1; attemptNumber <= maxRetries; attemptNumber++) {
            taskList = yield* docker.swarmServices.listTasks(serviceId);
            check = computeTaskStateCheck(taskList, 1);
            yield* Effect.logDebug(
                `Swarm task convergence attempt ${String(attemptNumber)}/${String(maxRetries)}: ${String(check.runningCount)} running, ${String(check.failedCount)} failed`,
            );
            if (check.ready) {
                break;
            }
            if (check.failedCount > 0) {
                return yield* Effect.fail(
                    new RuntimeConflict({
                        reason: `Swarm service ${serviceName} tasks failed to converge (${String(check.failedCount)} failed)`,
                    }),
                );
            }
            if (attemptNumber < maxRetries) {
                yield* Effect.sleep(retryIntervalMs);
            }
        }
        if (!check.ready) {
            return yield* Effect.fail(
                new TimeoutError(
                    `waiting for swarm service ${serviceName} to reach running state`,
                    maxRetries * retryIntervalMs,
                ),
            );
        }
        return { check, taskList };
    });

    const executeRuntime = Effect.fn("SwarmRuntimeRunner.executeRuntime")(function* (input: RuntimeExecutionInput) {
        yield* assertClusterReady;

        const { deployment, artifact, healthGateConfig, executorOptions, convergenceConfig } = input;
        const containerImage = yield* Effect.try({
            try: () => resolveContainerImage(artifact, deployment, RUNNER_TYPE),
            catch: (cause) => cause,
        });
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
            "deployer.runtime_runner": RUNNER_TYPE,
            "deployer.image_ref": containerImage,
            ...(deployment.projectId ? { "deployer.project_id": deployment.projectId } : {}),
            ...sanitizeExecutorLabels(executorOptions?.labels),
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
            const projectId = deployment.projectId;
            yield* docker.networks.ensureOverlay({
                    name: overlayName,
                    driver: "overlay",
                    attachable: true,
                    ingress: false,
                    labels: { "deployer.project_id": projectId, "deployer.managed": "true" },
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
        const platformOverlay = platformOverlayForPrefix(env.get("DEPLOYER_PREFIX"));
        yield* docker.networks.ensureOverlay({
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

        const placement = resolvePlacement(input);
        const specInput: SwarmServiceSpecInput = {
            name: serviceName,
            image: containerImage,
            mode: "replicated",
            replicas: 1,
            env: sanitizeEnvironmentVariables(executorOptions?.environmentVariables),
            command: [],
            args: executorOptions?.startupCommand ? ["sh", "-lc", executorOptions.startupCommand] : [],
            labels: managedLabels,
            containerLabels: {},
            mounts: yield* Effect.try({ try: () => buildStorageMounts(input), catch: (cause) => cause }),
            placementPreferences: placement.preferences,
            placementConstraints: placement.constraints,
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

        yield* Effect.logInfo(
            `Deploying swarm service ${serviceName} (image=${containerImage}, attachments=${networks.length > 0 ? networks.map((n) => n.target).join(",") : "none"})`,
        );

        const start = Date.now();
        const { summary: serviceSummary, created }: { summary: DockerodeServiceSummary; created: boolean } =
            yield* createOrUpdateService(serviceName, spec);

        // Docker types `ID` as optional; a service we just created or
        // inspected must have one. Fail fast rather than assert a string.
        const serviceId = serviceSummary.ID;
        if (serviceId === undefined) {
            return yield* Effect.fail(
                new AppError(`Swarm service ${serviceName} was inspected without an ID`, "SWARM_SERVICE_MISSING_ID", {
                    serviceName,
                }),
            );
        }

        const maxRetries = Math.max(1, healthGateConfig.maxRetries);
        const retryIntervalMs = Math.max(500, healthGateConfig.retryIntervalMs);
        const { check, taskList } = yield* awaitTaskConvergence(serviceId, serviceName, maxRetries, retryIntervalMs);

        const verifiedAt = new Date().toISOString();
        yield* Effect.logInfo(
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
                syncedAt: verifiedAt as string | null,
            },
            healthSummary: taskList.map((task) => ({
                id: task.ID,
                state: task.Status.State,
                nodeId: task.NodeID ?? null,
            })) as unknown,
            attempts: 1,
            verifiedAt,
        };

        let routeVerification = fallbackRouteVerification;
        const verifyHost = extractVerifyHost(input);
        if (verifyHost) {
            const probe = yield* attempt(() =>
                verifySwarmRouteAgainstTraefik(verifyHost, {
                    maxAttempts: convergenceConfig?.traefikSyncMaxAttempts ?? 3,
                    retryDelayMs: convergenceConfig?.retryBaseDelayMs ?? 250,
                }),
            ).pipe(
                Effect.map((result) => ({ ok: true as const, result })),
                Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
            );
            if (probe.ok) {
                const { result } = probe;
                yield* Effect.logInfo(
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
            } else {
                yield* Effect.logWarning(
                    `Traefik route verification probe failed for ${verifyHost}: ${
                        probe.error instanceof Error ? probe.error.message : String(probe.error)
                    }`,
                );
            }
        }

        return {
            containerId: serviceId,
            containerName: serviceName,
            containerImage,
            routeVerification,
            healthGate: {
                passed: true as const,
                containerId: serviceId,
                healthCheckUrl,
                maxRetries,
                retryIntervalMs,
                verifiedAt,
            },
            serviceId,
            serviceName,
            taskIds: taskList.map((task) => task.ID),
            managedRuntime: {
                managedBy: "deployment_service" as const,
                managedReason: "deployment_execution",
                deploymentId: deployment.deploymentId,
                serviceId: deployment.serviceId,
                projectId: deployment.projectId ?? null,
                imageRef: containerImage,
                networkMode,
                labels: managedLabels,
            },
        };
    });

    return { runnerType: RUNNER_TYPE, executeRuntime, removeService, scaleService, rollbackService };
}
