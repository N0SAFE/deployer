import { Injectable } from "@nestjs/common";
import type { DependencyTemplateConfig } from "@repo/api-contracts/common/template";

export type GateStatus = "pending" | "passing" | "failing" | "timeout";

export interface ServiceGateResult {
    serviceId: string;
    status: GateStatus;
    attempts: number;
    lastCheckedAt: string;
    reason?: string;
}

export type GateCheckFn = (serviceId: string) => Promise<boolean>;

/**
 * Options for a readiness gate evaluation cycle.
 * A cycle checks all `dependencyServiceIds` before allowing the
 * dependent service to proceed.
 */
export interface ReadinessGateOptions {
    /**
     * Service IDs that must pass before the dependent may be deployed.
     * Typically: every `dependsOn` entry for a service in the DAG.
     */
    dependencyServiceIds: string[];
    /**
     * Async check function — returns true if the service is healthy/ready.
     * Injected by the caller; typically polls a health-check endpoint or
     * listens to a deployment status event.
     */
    checkFn: GateCheckFn;
    /**
     * Retry policy from DependencyTemplateConfig.
     * `maxAttempts` = max polling attempts per service.
     * `backoffMs`   = wait between retries.
     */
    retryPolicy: DependencyTemplateConfig["retryPolicy"];
    /**
     * Whether to gate on required dependencies only, or all (including optional).
     * Default: only required dependencies (mirrors `gateOnDependencyHealth` flag).
     */
    gateOnDependencyHealth?: boolean;
    /** Override the absolute maximum wait ms across all retries. Default: 5 minutes. */
    maxWaitMs?: number;
}

export interface GateEvaluation {
    passed: boolean;
    results: ServiceGateResult[];
    failedServices: string[];
    timedOutServices: string[];
}

/**
 * T040 — Dependency-aware readiness gates.
 *
 * Evaluates whether all services that a given service depends on are healthy
 * before that service may proceed to deployment. Uses the retry policy from
 * `DependencyTemplateConfig` and is compatible with both polling and
 * event-driven callers.
 *
 * This service is pure-logic; it does **not** hold timers or subscriptions.
 * Callers are responsible for injecting the `checkFn` and awaiting the result.
 */
@Injectable()
export class FleetReadinessGateService {
    async evaluate(options: ReadinessGateOptions): Promise<GateEvaluation> {
        const {
            dependencyServiceIds,
            checkFn,
            retryPolicy,
            maxWaitMs = 5 * 60 * 1000,
        } = options;

        const deadline = Date.now() + maxWaitMs;
        const results: ServiceGateResult[] = [];

        await Promise.all(
            dependencyServiceIds.map(async (serviceId) => {
                const result = await this.pollOne(serviceId, checkFn, retryPolicy, deadline);
                results.push(result);
            }),
        );

        const failedServices = results.filter((r) => r.status === "failing").map((r) => r.serviceId);
        const timedOutServices = results.filter((r) => r.status === "timeout").map((r) => r.serviceId);
        const passed = failedServices.length === 0 && timedOutServices.length === 0;

        return { passed, results, failedServices, timedOutServices };
    }

    private async pollOne(
        serviceId: string,
        checkFn: GateCheckFn,
        retryPolicy: DependencyTemplateConfig["retryPolicy"],
        deadline: number,
    ): Promise<ServiceGateResult> {
        const { maxAttempts, backoffMs } = retryPolicy;
        let attempts = 0;

        while (attempts < maxAttempts) {
            if (Date.now() > deadline) {
                return {
                    serviceId,
                    status: "timeout",
                    attempts,
                    lastCheckedAt: new Date().toISOString(),
                    reason: "Exceeded maximum wait time",
                };
            }

            attempts++;
            try {
                const healthy = await checkFn(serviceId);
                if (healthy) {
                    return {
                        serviceId,
                        status: "passing",
                        attempts,
                        lastCheckedAt: new Date().toISOString(),
                    };
                }
            } catch {
                // checkFn threw — treat as unhealthy and continue retry
            }

            if (attempts < maxAttempts && Date.now() + backoffMs <= deadline) {
                await this.sleep(backoffMs);
            }
        }

        return {
            serviceId,
            status: "failing",
            attempts,
            lastCheckedAt: new Date().toISOString(),
            reason: `Did not pass after ${String(maxAttempts)} attempts`,
        };
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
