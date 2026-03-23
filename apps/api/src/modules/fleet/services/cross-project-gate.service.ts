import { Injectable } from "@nestjs/common";

export type CrossProjectGateMode = "block" | "warn" | "skip";

export interface CrossProjectDependency {
    /** Service ID in the current project */
    localServiceId: string;
    /** ID of the external service (in another project) that must be ready */
    remoteServiceId: string;
    remoteProjectId: string;
}

export interface CrossProjectGateConfig {
    /**
     * `block` — deployment halts if a cross-project dependency is not healthy
     * `warn`  — deployment proceeds but a warning event is emitted
     * `skip`  — all cross-project gate checks are bypassed
     */
    mode: CrossProjectGateMode;
    /** Async check: returns true if `remoteServiceId` in `remoteProjectId` is ready */
    checkFn: (remoteProjectId: string, remoteServiceId: string) => Promise<boolean>;
}

export interface CrossProjectGateServiceResult {
    satisfied: boolean;
    blocked: CrossProjectDependency[];
    warned: CrossProjectDependency[];
    skipped: boolean;
}

/**
 * T043 — Cross-project dependency gates (configurable).
 *
 * Evaluates cross-project service dependencies before allowing a deployment
 * to proceed. The gate operates in one of three modes:
 *
 * - `block`: any unhealthy remote dependency halts deployment
 * - `warn`:  unhealthy dependencies emit a warning but do not block
 * - `skip`:  gate is entirely bypassed (no checks run)
 */
@Injectable()
export class CrossProjectGateService {
    async evaluate(
        dependencies: CrossProjectDependency[],
        config: CrossProjectGateConfig,
    ): Promise<CrossProjectGateServiceResult> {
        if (config.mode === "skip") {
            return { satisfied: true, blocked: [], warned: [], skipped: true };
        }

        const blocked: CrossProjectDependency[] = [];
        const warned: CrossProjectDependency[] = [];

        await Promise.all(
            dependencies.map(async (dep) => {
                const ready = await config.checkFn(dep.remoteProjectId, dep.remoteServiceId);
                if (!ready) {
                    if (config.mode === "block") {
                        blocked.push(dep);
                    } else {
                        warned.push(dep);
                    }
                }
            }),
        );

        return {
            satisfied: blocked.length === 0,
            blocked,
            warned,
            skipped: false,
        };
    }
}
