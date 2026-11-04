import { Cause, Context, Effect } from "effect";

import type { ServiceLifecycleShape } from "@deployer/nest-effect";
import type { SwarmClusterShape } from "@deployer/swarm";

import { attempt } from "../../../core/effects";

import type { DeploymentQueueLifecycleShape } from "./deployment-queue-lifecycle.service";
import type { OrphanedDeploymentsPort } from "../deployment.ports";
import type { DeploymentRow } from "../repositories/deployment.repository";

const RECONCILE_START_DELAY = "3 seconds";
const ORPHAN_SCAN_LIMIT = 500;

/**
 * W-Queue (Q3) — startup reconciliation of orphaned in-flight deployments.
 *
 * The queue is fully in-process (typed in-memory lifecycle store; Bull removed):
 * a process crash wipes the queue while the DB deployment row stays at
 * `status = "building"` forever (no sweeper existed). On boot, this service
 * finds every `building` row and marks it `failed` with a clear reason + log.
 *
 * Decision (documented in provider-e2e-first-deploy-plan.mdx, W-Queue item 3):
 *   - RE-EXECUTION on startup is NOT attempted because the deployment row does
 *     NOT persist the full queue-job payload (executionPlan / storageBinding /
 *     runtimeConfiguration live only in the in-memory job). Re-enqueuing from
 *     the row would produce a silently degraded build — forbidden by doctrine.
 *   - `retryDeployment` (deployment.service) re-enqueues a COMPLETE payload
 *     from the persisted source config, so operators resume via the existing
 *     retry path instead of a half-informed auto-resume.
 *   - This keeps the system truthful: no zombie `building` rows, failed state
 *     is user-visible, and nothing degrades silently.
 */
export type DeploymentQueueReconciliationShape = ServiceLifecycleShape & {
    /**
     * Mark every `building` deployment row as failed (or adopted, when its Swarm service survived).
     * Resolves to the ids of reconciled deployments; fails with whatever the repository refused with.
     */
    readonly reconcileOrphanedInFlightDeployments: () => Effect.Effect<string[], unknown>;
};

export class DeploymentQueueReconciliation extends Context.Service<
    DeploymentQueueReconciliation,
    DeploymentQueueReconciliationShape
>()("runtime/DeploymentQueueReconciliation") {}

export type DeploymentQueueReconciliationPorts = {
    readonly deployments: Context.Service.Shape<typeof OrphanedDeploymentsPort>;
    readonly queue: Pick<DeploymentQueueLifecycleShape, "hasLiveJobForDeployment">;
    /** SW-026: swarm-aware adoption — when the engine already owns the service (deployer.deployment_id label
     *  match), a crash that wiped the queue must adopt the deployment as success, not fail it. Absent when swarm is off. */
    readonly swarm?: Pick<SwarmClusterShape, "assertClusterReady" | "listSwarmServicesForDeployment"> | undefined;
};

export function makeDeploymentQueueReconciliation(
    ports: DeploymentQueueReconciliationPorts,
): DeploymentQueueReconciliationShape {
    const { deployments, queue, swarm } = ports;

    /**
     * True when a live Swarm service carries the `deployer.deployment_id` label for the given deployment.
     * False when swarm is disabled, the engine is not in a cluster, or no matching service exists.
     */
    const hasLiveSwarmService = (deploymentId: string): Effect.Effect<boolean> =>
        swarm === undefined
            ? Effect.succeed(false)
            : Effect.gen(function* () {
                  yield* swarm.assertClusterReady();
                  const services = yield* swarm.listSwarmServicesForDeployment(deploymentId);
                  return services.length > 0;
              }).pipe(Effect.catch(() => Effect.succeed(false)));

    const reconcileOrphanedInFlightDeployments = (): Effect.Effect<string[], unknown> =>
        Effect.gen(function* () {
            const page = yield* attempt(() =>
                deployments.findMany({
                    limit: ORPHAN_SCAN_LIMIT,
                    offset: 0,
                    sortBy: "createdAt",
                    sortDirection: "asc",
                    filter: {
                        status: { operator: "eq", value: "building" },
                    },
                }),
            );

            const reconciled: string[] = [];
            for (const deployment of page.data) {
                // Skip if a queue job for this deployment is somehow still alive
                // (e.g. test harnesses or a sibling process) — only reconcile rows
                // with NO live queue job, so we never fail an actively-running build.
                if (yield* queue.hasLiveJobForDeployment(deployment.id)) {
                    continue;
                }

                // SW-026: adopt deployments whose Swarm service survived the crash
                // (engine owns the desired state — the platform only lost the job,
                // not the service). Never fail a still-running swarm service.
                if (yield* hasLiveSwarmService(deployment.id)) {
                    yield* attempt(() =>
                        deployments.updateStatus(deployment.id, "success", {
                            ...(deployment.metadata ?? {}),
                            swarmAdoptedAt: new Date().toISOString(),
                            swarmAdoptedReason:
                                "Swarm service discovered alive after restart; deployment adopted rather than failed.",
                        } as DeploymentRow["metadata"]),
                    );

                    yield* attempt(() =>
                        deployments.insertLog(deployment.id, {
                            level: "info",
                            message:
                                "Deployment adopted: Swarm service still running after restart; engine owns the convergence.",
                            phase: "success",
                            step: "startup_reconcile",
                            stage: "deploy",
                            correlationId: deployment.id,
                            metadata: {
                                structured: true,
                                reason: "startup_reconcile_adopt",
                            },
                        }),
                    );

                    yield* Effect.logInfo(
                        `Reconciled orphaned deployment '${deployment.id}' (status building → success, swarm service alive)`,
                    );
                    reconciled.push(deployment.id);
                    continue;
                }

                yield* attempt(() =>
                    deployments.updateStatus(deployment.id, "failed", {
                        ...(deployment.metadata ?? {}),
                        crashReconciledAt: new Date().toISOString(),
                        crashReconciledReason:
                            "API restarted while the deployment was building; the in-flight execution was lost. Use retry to re-run with a complete payload.",
                    } as DeploymentRow["metadata"]),
                );

                yield* attempt(() =>
                    deployments.insertLog(deployment.id, {
                        level: "error",
                        message:
                            "Deployment reconciled as failed: API restarted while building and the in-flight queue execution was lost. Retry to re-run.",
                        phase: "failed",
                        step: "startup_reconcile",
                        stage: "build",
                        correlationId: deployment.id,
                        metadata: {
                            structured: true,
                            reason: "startup_reconcile_crash",
                        },
                    }),
                );

                yield* Effect.logWarning(
                    `Reconciled orphaned deployment '${deployment.id}' (status building → failed after crash)`,
                );
                reconciled.push(deployment.id);
            }

            if (reconciled.length > 0) {
                yield* Effect.logInfo(
                    `Startup reconciliation: marked ${String(reconciled.length)} orphaned deployment(s) as failed/adopted`,
                );
            }

            return reconciled;
        });

    return {
        // One pass shortly after boot, once the queue's own sweep has had the chance to announce live jobs.
        run: () =>
            Effect.sleep(RECONCILE_START_DELAY).pipe(
                Effect.andThen(reconcileOrphanedInFlightDeployments()),
                Effect.catchCause((cause) =>
                    Effect.logError(`Failed to reconcile orphaned deployments: ${Cause.pretty(cause)}`),
                ),
                Effect.asVoid,
            ),
        reconcileOrphanedInFlightDeployments,
    };
}
