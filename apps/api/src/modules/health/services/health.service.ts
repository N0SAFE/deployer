import { Injectable } from "@nestjs/common";
import { HealthRepository } from "../repositories/health.repository";
import { AppLifecycleService } from "@repo/nest-lifecycle";
import { SupervisorOrchestratorService } from "@/core/modules/supervisors/supervisor-orchestrator.service";

@Injectable()
export class HealthService {
    constructor(
        private readonly healthRepository: HealthRepository,
        private readonly lifecycle: AppLifecycleService,
        private readonly supervisors: SupervisorOrchestratorService,
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
     * Detailed health check — includes every registered platform supervisor.
     * Overall status degrades when the database is unhealthy OR any supervisor
     * reports unhealthy (convergence failed / probe failing).
     */
    async getDetailedHealth() {
        const dbHealth = await this.healthRepository.checkDatabaseHealth();
        const memory = this.healthRepository.getMemoryInfo();
        const uptime = this.healthRepository.getUptime();
        const supervisorHealth = await this.supervisors.getHealthOfAll();

        const allSupervisorsHealthy = supervisorHealth.every((s) => s.healthy);
        const isHealthy = dbHealth.status === "ok" && allSupervisorsHealthy;

        return {
            status: isHealthy ? "ok" : "degraded",
            timestamp: new Date(),
            service: "nestjs-api",
            uptime,
            memory,
            database: dbHealth,
            supervisors: supervisorHealth,
        };
    }
}
