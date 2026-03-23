import { Injectable } from "@nestjs/common";
import type { DependencyTemplateConfig } from "@repo/api-contracts/common/template";
import type { ServiceDag } from "./service-dag.service";

export interface FailureDomain {
    /** Logical domain name (e.g. "frontend", "data-pipeline") */
    name: string;
    serviceIds: string[];
}

export interface ContainmentInput {
    /** The service that failed */
    failedServiceId: string;
    /** How the fleet is divided into isolation domains */
    domains: FailureDomain[];
    dag: ServiceDag;
    failureIsolation: DependencyTemplateConfig["failureIsolation"];
}

export interface ContainmentResult {
    /** Whether the failure can be contained within the failed service's domain */
    containable: boolean;
    /** Domain that the failed service belongs to (or "undomained" if none) */
    failedDomain: string;
    /** Services within the failure domain that are at risk */
    atRiskServices: string[];
    /** Services that should be isolated (no direct/transitive dependency on failed service, different domain) */
    safeServices: string[];
    /** Services that cross domain boundaries and need manual review */
    crossDomainRisk: string[];
}

/**
 * T042 — Partial failure containment and failure domain boundaries.
 *
 * Evaluates whether a service failure can be contained within its declared
 * failure domain and which services are at risk vs safe.
 *
 * Failure domains are user-defined groupings that represent blast-radius
 * boundaries. A failure is "containable" when:
 *  - The failed service's transitive dependents all belong to the same domain, OR
 *  - The failure isolation policy is "service" (only the failing service is affected)
 *
 * Cross-domain risk services are those with a transitive dependency path crossing
 * into a different domain — these are flagged for manual review.
 */
@Injectable()
export class FleetFailureContainmentService {
    assess(input: ContainmentInput): ContainmentResult {
        const { failedServiceId, domains, dag, failureIsolation } = input;

        const domainOf = this.buildDomainIndex(domains);
        const failedDomain = domainOf.get(failedServiceId) ?? "undomained";

        if (failureIsolation === "service") {
            // Service-level isolation: only the failed service is affected
            const domainServices = domains.find((d) => d.name === failedDomain)?.serviceIds ?? [failedServiceId];
            const safeServices = [...dag.nodes.keys()].filter(
                (id) => id !== failedServiceId && !domainServices.includes(id),
            );
            return {
                containable: true,
                failedDomain,
                atRiskServices: [],
                safeServices,
                crossDomainRisk: [],
            };
        }

        // Compute transitive dependents (services that may be impacted by the failure)
        const impacted = this.getTransitiveDependents(dag, failedServiceId);
        const impactedDomains = new Set(impacted.map((id) => domainOf.get(id) ?? "undomained"));

        const atRiskServices: string[] = [];
        const crossDomainRisk: string[] = [];
        const safeServices: string[] = [];

        for (const id of dag.nodes.keys()) {
            if (id === failedServiceId) continue;
            if (impacted.includes(id)) {
                const domain = domainOf.get(id) ?? "undomained";
                if (domain === failedDomain) {
                    atRiskServices.push(id);
                } else {
                    crossDomainRisk.push(id);
                }
            } else {
                safeServices.push(id);
            }
        }

        // Containable if dependents don't cross domain boundaries
        const containable = crossDomainRisk.length === 0 && !impactedDomains.has("undomained");

        return {
            containable,
            failedDomain,
            atRiskServices,
            safeServices,
            crossDomainRisk,
        };
    }

    private buildDomainIndex(domains: FailureDomain[]): Map<string, string> {
        const index = new Map<string, string>();
        for (const domain of domains) {
            for (const serviceId of domain.serviceIds) {
                index.set(serviceId, domain.name);
            }
        }
        return index;
    }

    private getTransitiveDependents(dag: ServiceDag, serviceId: string): string[] {
        const visited = new Set<string>();
        const queue = [serviceId];
        while (queue.length > 0) {
            const current = queue.shift();
            if (current === undefined) break;
            const node = dag.nodes.get(current);
            if (!node) continue;
            for (const dep of node.dependents) {
                if (!visited.has(dep)) {
                    visited.add(dep);
                    queue.push(dep);
                }
            }
        }
        visited.delete(serviceId);
        return [...visited];
    }
}
