import { describe, it, expect, beforeEach } from "vitest";
import { ServiceDagService } from "./service-dag.service";
import { FleetRollbackService } from "./fleet-rollback.service";
import type { ServiceDeploymentRef } from "./fleet-rollback.service";

const mkRef = (serviceId: string, deploymentId: string, lastGoodDeploymentId?: string): ServiceDeploymentRef => ({
    serviceId,
    deploymentId,
    lastGoodDeploymentId,
});

describe("FleetRollbackService", () => {
    let dagSvc: ServiceDagService;
    let rollbackSvc: FleetRollbackService;

    beforeEach(() => {
        dagSvc = new ServiceDagService();
        rollbackSvc = new FleetRollbackService();
    });

    describe("service isolation — local rollback", () => {
        it("rolls back only the failed service", () => {
            const dag = dagSvc.build([
                { serviceId: "A", dependsOnServiceId: "B", isRequired: true },
            ]);
            const decision = rollbackSvc.decide({
                failedServiceId: "B",
                reason: "health check failed",
                fleet: [mkRef("A", "dep-a", "dep-a-prev"), mkRef("B", "dep-b", "dep-b-prev")],
                dag,
                failureIsolation: "service",
            });
            expect(decision.scope).toBe("local");
            expect(decision.targetServices.map((s) => s.serviceId)).toEqual(["B"]);
        });
    });

    describe("project isolation — full rollback of impacted services", () => {
        it("includes failed service + transitive dependents", () => {
            // A depends on B, B depends on C; C fails
            const dag = dagSvc.build([
                { serviceId: "A", dependsOnServiceId: "B", isRequired: true },
                { serviceId: "B", dependsOnServiceId: "C", isRequired: true },
            ]);
            const decision = rollbackSvc.decide({
                failedServiceId: "C",
                reason: "OOM",
                fleet: [
                    mkRef("A", "dep-a", "dep-a-prev"),
                    mkRef("B", "dep-b", "dep-b-prev"),
                    mkRef("C", "dep-c", "dep-c-prev"),
                ],
                dag,
                failureIsolation: "project",
            });
            expect(decision.scope).toBe("full");
            expect(decision.targetServices.map((s) => s.serviceId).sort()).toEqual(["A", "B", "C"]);
        });
    });

    describe("fleet isolation — all services", () => {
        it("rolls back every service in the fleet", () => {
            const dag = dagSvc.build([
                { serviceId: "X", dependsOnServiceId: "Y", isRequired: true },
            ]);
            const decision = rollbackSvc.decide({
                failedServiceId: "Y",
                reason: "disk full",
                fleet: [mkRef("X", "dep-x", "dep-x-prev"), mkRef("Y", "dep-y", "dep-y-prev")],
                dag,
                failureIsolation: "fleet",
            });
            expect(decision.scope).toBe("full");
            expect(decision.targetServices).toHaveLength(2);
        });
    });

    describe("exclusion — no last-good deployment", () => {
        it("excludes services without a previous deployment", () => {
            const dag = dagSvc.build([
                { serviceId: "A", dependsOnServiceId: "B", isRequired: true },
            ]);
            const decision = rollbackSvc.decide({
                failedServiceId: "B",
                reason: "crash",
                fleet: [
                    mkRef("A", "dep-a"),             // no lastGoodDeploymentId
                    mkRef("B", "dep-b", "dep-b-prev"),
                ],
                dag,
                failureIsolation: "fleet",
            });
            expect(decision.excludedServices.map((s) => s.serviceId)).toContain("A");
            expect(decision.targetServices.map((s) => s.serviceId)).not.toContain("A");
        });
    });
});
