import { describe, it, expect, beforeEach } from "vitest";
import { DriftReconciliationService } from "./drift-reconciliation.service";
import type { ServiceDesiredState, ServiceActualState } from "./drift-reconciliation.service";

describe("DriftReconciliationService", () => {
    let service: DriftReconciliationService;

    beforeEach(() => {
        service = new DriftReconciliationService();
    });

    it("reports no drift for perfectly matching states", () => {
        const desired: ServiceDesiredState[] = [
            { serviceId: "svc-1", expectedDeploymentId: "dep-1", expectedImageRef: "img:v1" },
        ];
        const actual: ServiceActualState[] = [
            { serviceId: "svc-1", currentDeploymentId: "dep-1", currentImageRef: "img:v1", lastStatus: "success" },
        ];
        const report = service.reconcile(desired, actual);
        expect(report.driftDetected).toBe(false);
        expect(report.cleanServices).toContain("svc-1");
        expect(report.driftedServices).toHaveLength(0);
    });

    it("detects never-deployed service as major drift", () => {
        const desired: ServiceDesiredState[] = [
            { serviceId: "svc-1", expectedDeploymentId: "dep-1", expectedImageRef: "img:v1" },
        ];
        const actual: ServiceActualState[] = [];
        const report = service.reconcile(desired, actual);
        expect(report.driftDetected).toBe(true);
        expect(report.driftedServices[0]?.driftType).toBe("never_deployed");
        expect(report.driftedServices[0]?.severity).toBe("major");
    });

    it("detects image ref mismatch as major drift", () => {
        const desired: ServiceDesiredState[] = [
            { serviceId: "svc-1", expectedDeploymentId: "dep-1", expectedImageRef: "img:v2" },
        ];
        const actual: ServiceActualState[] = [
            { serviceId: "svc-1", currentDeploymentId: "dep-1", currentImageRef: "img:v1", lastStatus: "success" },
        ];
        const report = service.reconcile(desired, actual);
        expect(report.driftedServices[0]?.driftType).toBe("image_ref_mismatch");
        expect(report.driftedServices[0]?.severity).toBe("major");
    });

    it("detects deployment ID mismatch (same image) as minor drift", () => {
        const desired: ServiceDesiredState[] = [
            { serviceId: "svc-1", expectedDeploymentId: "dep-2", expectedImageRef: "img:v1" },
        ];
        const actual: ServiceActualState[] = [
            { serviceId: "svc-1", currentDeploymentId: "dep-1", currentImageRef: "img:v1", lastStatus: "success" },
        ];
        const report = service.reconcile(desired, actual);
        expect(report.driftedServices[0]?.driftType).toBe("deployment_id_mismatch");
        expect(report.driftedServices[0]?.severity).toBe("minor");
    });

    it("detects failed last status as major drift", () => {
        const desired: ServiceDesiredState[] = [
            { serviceId: "svc-1", expectedDeploymentId: "dep-1", expectedImageRef: "img:v1" },
        ];
        const actual: ServiceActualState[] = [
            { serviceId: "svc-1", currentDeploymentId: "dep-1", currentImageRef: "img:v1", lastStatus: "failed" },
        ];
        const report = service.reconcile(desired, actual);
        expect(report.driftedServices[0]?.driftType).toBe("failed");
    });
});
