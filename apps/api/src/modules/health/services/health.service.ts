import { Injectable } from "@nestjs/common";
import { HealthRepository } from "../repositories/health.repository";
import { ReadinessService } from "./readiness.service";
import { AppLifecycleService } from "@deployer/nest-lifecycle";
import { SupervisorOrchestratorService } from "@deployer/nest-supervisor-core/supervisor-orchestrator.service";

@Injectable()
export class HealthService {
    constructor(
        private readonly healthRepository: HealthRepository,
        private readonly lifecycle: AppLifecycleService,
        private readonly supervisors: SupervisorOrchestratorService,
        // The SAME instance the readiness route uses (bound via `useExisting`), so the
        // detailed report and `/health/ready` cannot disagree about a dependency's state.
        private readonly readiness: ReadinessService,
    ) {}

    /**
     * Basic health check — always responds (no DB dependency).
     * Returns the current lifecycle phase so callers can see bootstrap progress.
     */
   getHealth() {
        const snapshot = this.lifecycle.getSnapshot();
        return {
            status: "ok",
            timestamp: new Date(),
            service: "nestjs-api",
            lifecycle: {
                phase: snapshot.phase,
                step: snapshot.step ?? null,
                message: snapshot.message,
            },
        };
    }

    /**
     * Readiness check
     */
    async getReadiness() {
        // Check if all required services are ready
        const dbHealth = await this.healthRepository.checkDatabaseHealth();

        const isReady = dbHealth.status === "ok";

        return {
            status: isReady ? "ready" : "not-ready",
            timestamp: new Date(),
            service: "nestjs-api",
        };
    }

    /**
     * Liveness check
     */
    getLiveness() {
        return {
            status: "alive",
            timestamp: new Date(),
            service: "nestjs-api",
        };
    }

    /**
     * Detailed health check — the contract's report shape.
     *
     * ── WHY `info` / `error` / `details` COME FROM TERMINUS ─────────────────
     * The contract declares those three as loose records ON PURPOSE: they are
     * Terminus' own `HealthCheckResult` fields, passed through unchanged, so a Terminus
     * client or the Terminus UI can consume the response without a translation layer. The
     * flattened `indicators` list sits beside them because that is what a UI actually
     * renders — Terminus' nested records are awkward to iterate.
     *
     * The readiness probe is the source because it already runs the REAL indicators
     * (database, swarm, services, mesh) through `HealthCheckService`, and it reports a
     * failing dependency as a 503 RESULT rather than throwing it — which is what makes it
     * usable here without a try/catch ladder.
     */
    async getDetailedHealth() {
        const probe = await this.readiness.probe();
        const [supervisorHealth, uptime] = await Promise.all([
            this.supervisors.getHealthOfAll(),
            Promise.resolve(this.healthRepository.getUptime()),
        ]);

        const info = probe.body.info ?? {};
        const error = probe.body.error ?? {};

        // `details` is every indicator in BOTH states, which is what distinguishes it from
        // `info` (up only) and `error` (down only). Built from the two Terminus records so
        // there is one source of truth for each verdict.
        const details: Record<string, unknown> = { ...info, ...error };

        // Flattened, renderable list in declaration order: the readiness indicators are
        // declared database → swarm → services → mesh, so a UI shows a stable order instead
        // of whatever key order the records happen to carry.
        //
        // `status` is narrowed to the contract's `up | down` enum rather than passed through:
        // Terminus reports a non-`up` status as a string, and the contract is deliberately
        // two-valued so a client renders one of two dots instead of inventing a third state.
        // `latencyMs` is required by the contract and Terminus does not measure it, so it is
        // reported as 0 — the honest value for "not measured", and better than inventing a
        // number that would look like a real measurement in a chart.
        const indicators = [...READINESS_INDICATOR_NAMES]
            .filter((name) => name in details)
            .map((name) => {
                const detail = details[name] as
                    | { status?: string; message?: string }
                    | undefined;
                return {
                    name,
                    status: detail?.status === "up" ? ("up" as const) : ("down" as const),
                    latencyMs: 0,
                    ...(detail?.message === undefined ? {} : { message: detail.message }),
                    detail: (detail ?? {}),
                };
            });

        return {
            status: probe.statusCode === 200 ? "ok" : "degraded",
            timestamp: new Date(),
            service: "nestjs-api",
            uptime,
            info,
            error,
            details,
            indicators,
            supervisors: supervisorHealth,
        };
    }
}

/**
 * The readiness indicators, in declaration order.
 *
 * Listed once so the controller's flat list and the Terminus records cannot disagree about
 * which checks exist — `ReadinessService` runs exactly these four.
 */
const READINESS_INDICATOR_NAMES = ["database", "swarm", "services", "mesh"] as const;
