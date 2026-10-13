import { describe, it, expect, beforeEach } from "vitest";
import { ServiceDagService } from "./service-dag.service";
import { FleetFailureContainmentService } from "./fleet-failure-containment.service";
import type { FailureDomain } from "./fleet-failure-containment.service";

describe("FleetFailureContainmentService", () => {
    let dagSvc: ServiceDagService;
    let containment: FleetFailureContainmentService;

    beforeEach(() => {
        dagSvc = new ServiceDagService();
        containment = new FleetFailureContainmentService();
    });

    const domains: FailureDomain[] = [
        { name: "frontend", serviceIds: ["web", "worker"] },
        { name: "backend", serviceIds: ["api", "gateway"] },
    ];

    describe("service isolation", () => {
        it("is always containable", () => {
            const dag = dagSvc.build([
                { serviceId: "web", dependsOnServiceId: "api", isRequired: true },
            ]);
            const result = containment.assess({
                failedServiceId: "web",
                domains,
                dag,
                failureIsolation: "service",
            });
            expect(result.containable).toBe(true);
            expect(result.failedDomain).toBe("frontend");
        });
    });

    describe("project/fleet isolation", () => {
        it("is containable when all impacted services are in the same domain", () => {
            // worker depends on web — both in frontend domain
            const dag = dagSvc.build([
                { serviceId: "worker", dependsOnServiceId: "web", isRequired: true },
            ]);
            const result = containment.assess({
                failedServiceId: "web",
                domains,
                dag,
                failureIsolation: "fleet",
            });
            expect(result.containable).toBe(true);
            expect(result.atRiskServices).toContain("worker");
            expect(result.crossDomainRisk).toHaveLength(0);
        });

        it("is not containable when a dependent is in a different domain", () => {
            // gateway (backend) depends on web (frontend)
            const dag = dagSvc.build([
                { serviceId: "gateway", dependsOnServiceId: "web", isRequired: true },
            ]);
            const result = containment.assess({
                failedServiceId: "web",
                domains,
                dag,
                failureIsolation: "fleet",
            });
            expect(result.containable).toBe(false);
            expect(result.crossDomainRisk).toContain("gateway");
        });

        it("marks services with no impacted relationship as safe", () => {
            // worker depends on web; api+gateway are independent (own edges)
            const dag = dagSvc.build([
                { serviceId: "worker", dependsOnServiceId: "web", isRequired: true },
                { serviceId: "gateway", dependsOnServiceId: "api", isRequired: true },
            ]);
            const result = containment.assess({
                failedServiceId: "web",
                domains,
                dag,
                failureIsolation: "fleet",
            });
            // api and gateway have no dependency path to/from web
            expect(result.safeServices).toContain("api");
            expect(result.safeServices).toContain("gateway");
        });
    });
});
