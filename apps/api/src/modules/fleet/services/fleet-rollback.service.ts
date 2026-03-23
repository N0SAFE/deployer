import { Injectable } from "@nestjs/common";
import type { DependencyTemplateConfig } from "@repo/api-contracts/common/template";
import type { ServiceDag } from "./service-dag.service";

export type FleetRollbackScope = "local" | "full";

export interface ServiceDeploymentRef {
    serviceId: string;
    /** ID of the deployment to roll back (current deployed deployment) */
    deploymentId: string;
    /** ID of the last known-good deployment to roll back TO */
    lastGoodDeploymentId: string | undefined;
}

export interface FleetRollbackRequest {
    /** Service that triggered the rollback decision */
    failedServiceId: string;
    /** Reason description (surfaced in deployment audit trail) */
    reason: string;
    /** All services in the fleet with their deployment refs */
    fleet: ServiceDeploymentRef[];
    dag: ServiceDag;
    failureIsolation: DependencyTemplateConfig["failureIsolation"];
}

export interface FleetRollbackDecision {
    scope: FleetRollbackScope;
    /** Services that will be rolled back, in reverse dependency order */
    targetServices: ServiceDeploymentRef[];
    /** Services excluded from rollback (no last-good deployment or outside failure domain) */
    excludedServices: { serviceId: string; reason: string }[];
}

/**
 * T041 — Fleet rollback semantics.
 *
 * Determines rollback scope (local vs full) and which services should be
 * rolled back, in which order, based on the failure isolation policy:
 *
 * - `service` isolation → `local` rollback: only the failed service
 * - `project` isolation → `full` rollback: all services reachable to the failed
 *                         service in the DAG (dependents + transitive chain)
 * - `fleet` isolation   → `full` rollback: all services in the fleet
 *
 * Services without a `lastGoodDeploymentId` are excluded from rollback
 * and flagged in `excludedServices`.
 */
@Injectable()
export class FleetRollbackService {
    decide(request: FleetRollbackRequest): FleetRollbackDecision {
        const { failedServiceId, fleet, dag, failureIsolation } = request;

        const fleetMap = new Map(fleet.map((s) => [s.serviceId, s]));
        const excluded: { serviceId: string; reason: string }[] = [];

        let rollbackCandidateIds: string[];

        switch (failureIsolation) {
            case "service":
                rollbackCandidateIds = [failedServiceId];
                break;
            case "project":
                rollbackCandidateIds = this.getImpactedServiceIds(failedServiceId, dag, fleet.map((s) => s.serviceId));
                break;
            case "fleet":
                rollbackCandidateIds = fleet.map((s) => s.serviceId);
                break;
        }

        // Build final list: only include services that have a last-good deployment
        const targets: ServiceDeploymentRef[] = [];
        for (const id of rollbackCandidateIds) {
            const ref = fleetMap.get(id);
            if (!ref) continue;
            if (!ref.lastGoodDeploymentId) {
                excluded.push({ serviceId: id, reason: "No previous successful deployment to roll back to" });
            } else {
                targets.push(ref);
            }
        }

        // Sort targets in reverse topological order (dependents first, then dependencies)
        const sortedTargets = this.sortReverseTopological(targets, dag);
        const scope: FleetRollbackScope = rollbackCandidateIds.length === 1 ? "local" : "full";

        return { scope, targetServices: sortedTargets, excludedServices: excluded };
    }

    /**
     * Returns all services that are transitively impacted by a failure in `failedServiceId`:
     * the service itself + all services that (directly or transitively) depend on it.
     */
    private getImpactedServiceIds(failedServiceId: string, dag: ServiceDag, allIds: string[]): string[] {
        const impacted = new Set<string>([failedServiceId]);
        const queue = [failedServiceId];
        while (queue.length > 0) {
            const current = queue.shift();
            if (current === undefined) break;
            const node = dag.nodes.get(current);
            if (node === undefined) continue;
            for (const dep of node.dependents) {
                if (!impacted.has(dep) && allIds.includes(dep)) {
                    impacted.add(dep);
                    queue.push(dep);
                }
            }
        }
        return [...impacted];
    }

    /**
     * Sort services so that services with the most dependents come first
     * (tear-down dependents before restoring their dependencies).
     */
    private sortReverseTopological(targets: ServiceDeploymentRef[], dag: ServiceDag): ServiceDeploymentRef[] {
        return [...targets].sort((a, b) => {
            const aDepCount = dag.nodes.get(a.serviceId)?.dependents.length ?? 0;
            const bDepCount = dag.nodes.get(b.serviceId)?.dependents.length ?? 0;
            return bDepCount - aDepCount; // most dependents first
        });
    }
}
