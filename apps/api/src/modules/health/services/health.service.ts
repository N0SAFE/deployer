import { Injectable } from "@nestjs/common";
import { HealthRepository } from "../repositories/health.repository";
import { AppLifecycleService } from "@/core/modules/lifecycle";

@Injectable()
export class HealthService {
    constructor(
        private readonly healthRepository: HealthRepository,
        private readonly lifecycle: AppLifecycleService,
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
     * Detailed health check
     */
    async getDetailedHealth() {
        const dbHealth = await this.healthRepository.checkDatabaseHealth();
        const memory = this.healthRepository.getMemoryInfo();
        const uptime = this.healthRepository.getUptime();

        const isHealthy = dbHealth.status === "ok";

        return {
            status: isHealthy ? "ok" : "degraded",
            timestamp: new Date(),
            service: "nestjs-api",
            uptime,
            memory,
            database: dbHealth,
        };
    }
}
