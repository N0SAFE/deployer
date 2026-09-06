import { Injectable, Logger, Optional } from "@nestjs/common";
import type { OnModuleInit } from "@nestjs/common";
import type { OnModuleDestroy } from "@nestjs/common";
import { SwarmClusterService } from "@/core/modules/swarm/services/swarm-cluster.service";
import { DeploymentRepository } from "./../repositories/deployment.repository";
import type { DeploymentQueueLifecycleService } from "./deployment-queue-lifecycle.service";
import type { DeploymentRow } from "./../repositories/deployment.repository";

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
@Injectable()
export class DeploymentQueueReconciliationService implements OnModuleInit, OnModuleDestroy {
    private static readonly RECONCILE_START_DELAY_MS = 3_000;
    private static readonly ORPHAN_SCAN_LIMIT = 500;

    private readonly logger = new Logger(DeploymentQueueReconciliationService.name);
    private timer: NodeJS.Timeout | null = null;

    constructor(
        private readonly deploymentRepository: DeploymentRepository,
        @Optional() private readonly queueLifecycle?: DeploymentQueueLifecycleService,
        /** SW-026: swarm-aware adoption — when the engine already owns the
         *  service (deployer.deployment_id label match), a crash that wiped
         *  the queue must adopt the deployment as success, not fail it. */
        @Optional() private readonly swarmClusterService?: SwarmClusterService,
    ) {}

    onModuleInit(): void {
        this.timer = setTimeout(
            () => {
                void this.reconcileOrphanedInFlightDeployments().catch((error: unknown) => {
                    this.logger.error(
                        `Failed to reconcile orphaned deployments: ${
                            error instanceof Error ? error.message : String(error)
                        }`,
                    );
                });
            },
            DeploymentQueueReconciliationService.RECONCILE_START_DELAY_MS,
        );
    }

    onModuleDestroy(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    /**
     * Mark every `building` deployment row as failed.
     * @returns the ids of reconciled deployments.
     */
    async reconcileOrphanedInFlightDeployments(): Promise<string[]> {
        const page = await this.deploymentRepository.findMany({
            limit: DeploymentQueueReconciliationService.ORPHAN_SCAN_LIMIT,
            offset: 0,
            sortBy: "createdAt",
            sortDirection: "asc",
            filter: {
                status: { operator: "eq", value: "building" },
            },
        });

        const reconciled: string[] = [];
        for (const deployment of page.data) {
            // Skip if a queue job for this deployment is somehow still alive
            // (e.g. test harnesses or a sibling process) — only reconcile rows
            // with NO live queue job, so we never fail an actively-running build.
            if (this.queueLifecycle?.hasLiveJobForDeployment(deployment.id)) {
                continue;
            }

            // SW-026: adopt deployments whose Swarm service survived the crash
            // (engine owns the desired state — the platform only lost the job,
            // not the service). Never fail a still-running swarm service.
            if (await this.hasLiveSwarmService(deployment.id)) {
                await this.deploymentRepository.updateStatus(
                    deployment.id,
                    "success",
                    {
                        ...(deployment.metadata ?? {}),
                        swarmAdoptedAt: new Date().toISOString(),
                        swarmAdoptedReason:
                            "Swarm service discovered alive after restart; deployment adopted rather than failed.",
                    } as DeploymentRow["metadata"],
                );

                await this.deploymentRepository.insertLog(deployment.id, {
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
                });

                this.logger.log(
                    `Reconciled orphaned deployment '${deployment.id}' (status building → success, swarm service alive)`,
                );
                reconciled.push(deployment.id);
                continue;
            }

            await this.deploymentRepository.updateStatus(
                deployment.id,
                "failed",
                {
                    ...(deployment.metadata ?? {}),
                    crashReconciledAt: new Date().toISOString(),
                    crashReconciledReason:
                        "API restarted while the deployment was building; the in-flight execution was lost. Use retry to re-run with a complete payload.",
                } as DeploymentRow["metadata"],
            );

            await this.deploymentRepository.insertLog(deployment.id, {
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
            });

            this.logger.warn(
                `Reconciled orphaned deployment '${deployment.id}' (status building → failed after crash)`,
            );
            reconciled.push(deployment.id);
        }

        if (reconciled.length > 0) {
            this.logger.log(
                `Startup reconciliation: marked ${String(reconciled.length)} orphaned deployment(s) as failed/adopted`,
            );
        }

        return reconciled;
    }

    /**
     * True when a live Swarm service carries the `deployer.deployment_id`
     * label for the given deployment. False when swarm is disabled, the
     * engine is not in a cluster, or no matching service exists.
     */
    private async hasLiveSwarmService(deploymentId: string): Promise<boolean> {
        if (!this.swarmClusterService) {
            return false;
        }
        try {
            await this.swarmClusterService.assertClusterReady();
            const services = await this.swarmClusterService.listSwarmServicesForDeployment(deploymentId);
            return services.length > 0;
        } catch {
            return false;
        }
    }
}