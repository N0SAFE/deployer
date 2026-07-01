import { Injectable } from "@nestjs/common";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { coreDomainEventEnvelopeSchema } from "@repo/contracts-entities";
import { localEventOutbox } from "@/config/drizzle/global/schema/runtime";
import { GlobalDatabaseService } from "@/core/modules/database/services/global-database.service";
import { DeploymentRepository } from "../repositories/deployment.repository";

export interface DeploymentReadModelProjection {
    deploymentId: string;
    lastEventId: string;
    lastEventType: string;
    lastOccurredAt: string;
    lastLogId: string | null;
    lastLevel: string | null;
    lastPhase: string | null;
    lastStep: string | null;
    updatedAt: string;
}

export interface DeploymentProjectionDriftReport {
    deploymentId: string;
    driftDetected: boolean;
    reason: "projection_missing" | "source_log_missing" | "last_log_mismatch" | null;
    projectionLogId: string | null;
    sourceLogId: string | null;
}

@Injectable()

/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys. Used in place of `as Record<string, unknown>`
 * to avoid the runtime lie.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
export class DeploymentReadModelProjectorService {
    private readonly projections = new Map<string, DeploymentReadModelProjection>();
    private lastProcessedCreatedAt: Date | null = null;

    constructor(
        private readonly databaseService: GlobalDatabaseService,
        private readonly deploymentRepository: DeploymentRepository,
    ) {}

    async processOutboxBatch(limit = 200): Promise<number> {
        const conditions = [
            eq(localEventOutbox.topic, "deployment.lifecycle"),
            inArray(localEventOutbox.state, ["pending", "sent"]),
        ];

        if (this.lastProcessedCreatedAt) {
            conditions.push(gt(localEventOutbox.createdAt, this.lastProcessedCreatedAt));
        }

        const rows = await this.databaseService.db
            .select()
            .from(localEventOutbox)
            .where(and(...conditions))
            .orderBy(asc(localEventOutbox.createdAt), asc(localEventOutbox.id))
            .limit(limit);

        let processed = 0;

        for (const row of rows) {
            const parsed = coreDomainEventEnvelopeSchema.safeParse(row.payload);
            if (!parsed.success) {
                continue;
            }

            if (parsed.data.aggregateType !== "deployment") {
                continue;
            }

            const payload =
                parsed.data.payload && typeof parsed.data.payload === "object"
                    ? (parsed.data.payload as Record<string, unknown>)
                    : {};

            this.projections.set(parsed.data.aggregateId, {
                deploymentId: parsed.data.aggregateId,
                lastEventId: parsed.data.eventId,
                lastEventType: parsed.data.eventType,
                lastOccurredAt: parsed.data.occurredAt,
                lastLogId: typeof payload.logId === "string" ? payload.logId : null,
                lastLevel: typeof payload.level === "string" ? payload.level : null,
                lastPhase: typeof payload.phase === "string" ? payload.phase : null,
                lastStep: typeof payload.step === "string" ? payload.step : null,
                updatedAt: new Date().toISOString(),
            });

            this.lastProcessedCreatedAt = row.createdAt;
            processed += 1;
        }

        return processed;
    }

    async rebuildAll(): Promise<number> {
        this.projections.clear();
        this.lastProcessedCreatedAt = null;

        let total = 0;
        while (true) {
            const count = await this.processOutboxBatch(500);
            total += count;
            if (count === 0) {
                break;
            }
        }

        return total;
    }

    getProjection(deploymentId: string): DeploymentReadModelProjection | null {
        return this.projections.get(deploymentId) ?? null;
    }

    getAllProjections(): DeploymentReadModelProjection[] {
        return [...this.projections.values()];
    }

    async detectDrift(deploymentId: string): Promise<DeploymentProjectionDriftReport> {
        const projection = this.projections.get(deploymentId) ?? null;

        if (!projection) {
            return {
                deploymentId,
                driftDetected: true,
                reason: "projection_missing",
                projectionLogId: null,
                sourceLogId: null,
            };
        }

        const logs = await this.deploymentRepository.findLogs(deploymentId, 1, 0);
        const latestLog = logs[0] ?? null;

        if (!latestLog) {
            return {
                deploymentId,
                driftDetected: true,
                reason: "source_log_missing",
                projectionLogId: projection.lastLogId,
                sourceLogId: null,
            };
        }

        if (projection.lastLogId !== latestLog.id) {
            return {
                deploymentId,
                driftDetected: true,
                reason: "last_log_mismatch",
                projectionLogId: projection.lastLogId,
                sourceLogId: latestLog.id,
            };
        }

        return {
            deploymentId,
            driftDetected: false,
            reason: null,
            projectionLogId: projection.lastLogId,
            sourceLogId: latestLog.id,
        };
    }
}
