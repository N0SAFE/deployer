import { Injectable } from "@nestjs/common";

export type DeploymentStatus = "pending" | "queued" | "building" | "deploying" | "success" | "failed" | "cancelled";

export interface ServiceDesiredState {
    serviceId: string;
    /** The deployment ID that should be running */
    expectedDeploymentId: string;
    /** The image/ref that should be running */
    expectedImageRef: string;
}

export interface ServiceActualState {
    serviceId: string;
    /** The deployment ID that is currently live */
    currentDeploymentId: string | undefined;
    /** The image/ref that is actually running */
    currentImageRef: string | undefined;
    /** The last known deployment status */
    lastStatus: DeploymentStatus;
}

export type DriftSeverity = "none" | "minor" | "major";

export interface ServiceDriftRecord {
    serviceId: string;
    severity: DriftSeverity;
    driftType: "deployment_id_mismatch" | "image_ref_mismatch" | "both_mismatch" | "never_deployed" | "failed";
}

export interface DriftReconciliationReport {
    scannedAt: string;
    driftDetected: boolean;
    totalServices: number;
    driftedServices: ServiceDriftRecord[];
    /** Service IDs that are in-sync */
    cleanServices: string[];
}

/**
 * T044 — Drift reconciliation loop (desired vs actual state).
 *
 * Compares the desired state of each service (what should be running) against
 * the actual state (what is currently running) and produces a drift report.
 *
 * Severity:
 * - `none`   — desired == actual
 * - `minor`  — deployment IDs mismatch but image ref matches (potentially harmless)
 * - `major`  — image ref mismatch, never deployed, or last deployment failed
 *
 * This service is a pure-logic detector. Acting on drift (re-triggering deployments)
 * is a concern of the caller (e.g. a scheduled job, webhook, or fleet controller).
 */
@Injectable()
export class DriftReconciliationService {
    reconcile(
        desired: ServiceDesiredState[],
        actual: ServiceActualState[],
    ): DriftReconciliationReport {
        const actualMap = new Map(actual.map((s) => [s.serviceId, s]));
        const driftedServices: ServiceDriftRecord[] = [];
        const cleanServices: string[] = [];

        for (const want of desired) {
            const have = actualMap.get(want.serviceId);

            if (have?.currentDeploymentId === undefined) {
                driftedServices.push({ serviceId: want.serviceId, severity: "major", driftType: "never_deployed" });
                continue;
            }

            if (have.lastStatus === "failed" || have.lastStatus === "cancelled") {
                driftedServices.push({ serviceId: want.serviceId, severity: "major", driftType: "failed" });
                continue;
            }

            const idMismatch = have.currentDeploymentId !== want.expectedDeploymentId;
            const imageMismatch = have.currentImageRef !== want.expectedImageRef;

            if (idMismatch && imageMismatch) {
                driftedServices.push({ serviceId: want.serviceId, severity: "major", driftType: "both_mismatch" });
            } else if (imageMismatch) {
                driftedServices.push({ serviceId: want.serviceId, severity: "major", driftType: "image_ref_mismatch" });
            } else if (idMismatch) {
                driftedServices.push({ serviceId: want.serviceId, severity: "minor", driftType: "deployment_id_mismatch" });
            } else {
                cleanServices.push(want.serviceId);
            }
        }

        return {
            scannedAt: new Date().toISOString(),
            driftDetected: driftedServices.length > 0,
            totalServices: desired.length,
            driftedServices,
            cleanServices,
        };
    }
}
