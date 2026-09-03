import { Injectable } from "@nestjs/common";
import { GlobalDatabaseService } from "@/core/modules/database/services/global-database.service";
import {
    deployments,
    deploymentRollbacks,
    services,
    projects,
} from "@/config/drizzle/global/schema/deployment";
import { user } from "@/config/drizzle/global/schema/auth";
import {
    analyticsReports,
    analyticsReportConfigs,
} from "@/config/drizzle/global/schema/analytics";
import { and, asc, count, desc, eq, gte, inArray, lte, type SQL } from "drizzle-orm";

/** A deployment row projected to the fields analytics needs (dates coerced). */
export interface AnalyticsDeploymentRow {
    id: string;
    serviceId: string;
    status: string;
    createdAt: Date;
    deployCompletedAt: Date | null;
    errorMessage: string | null;
}

export interface AnalyticsServiceRow {
    id: string;
    name: string;
    projectId: string;
}

export interface AnalyticsRollbackRow {
    deploymentId: string | null;
    status: string;
    createdAt: Date;
}

/**
 * Analytics data access.
 *
 * REAL sources only:
 *  - deployments + deploymentRollbacks tables → deployment metrics / usage
 *  - services + latest deployment state         → service health
 *  - analyticsReports / analyticsReportConfigs  → persisted reports
 *
 * Metrics that have no connected telemetry source are deliberately NOT queried
 * here — the service returns an honest empty payload instead of fabricated
 * numbers.
 */
@Injectable()
export class AnalyticsRepository {
    constructor(private readonly databaseService: GlobalDatabaseService) {}

    /** Deployments created inside [start, end); optionally scoped to services. */
    async deploymentsInRange(start: Date, end: Date, serviceIds?: string[]): Promise<AnalyticsDeploymentRow[]> {
        const db = this.databaseService.db;
        const where: SQL[] = [gte(deployments.createdAt, start), lte(deployments.createdAt, end)];
        if (serviceIds && serviceIds.length > 0) {
            where.push(inArray(deployments.serviceId, serviceIds));
        }
        const rows = await db
            .select({
                id: deployments.id,
                serviceId: deployments.serviceId,
                status: deployments.status,
                createdAt: deployments.createdAt,
                deployCompletedAt: deployments.deployCompletedAt,
                errorMessage: deployments.errorMessage,
            })
            .from(deployments)
            .where(and(...where))
            .orderBy(asc(deployments.createdAt));

        // Date fields arrive as strings/Date depending on driver — coerce at the
        // read boundary (documented analytics boundary).
        return rows.map((row) => ({
            id: row.id,
            serviceId: row.serviceId,
            status: String(row.status),
            createdAt: this.toDate(row.createdAt),
            deployCompletedAt: row.deployCompletedAt == null ? null : this.toDate(row.deployCompletedAt),
            errorMessage: row.errorMessage,
        }));
    }

    /** Rollbacks recorded inside [start, end) — timed by start (or completion). */
    async rollbacksInRange(start: Date, end: Date): Promise<AnalyticsRollbackRow[]> {
        const db = this.databaseService.db;
        const startTs = deploymentRollbacks.startedAt;
        const rows = await db
            .select({
                deploymentId: deploymentRollbacks.fromDeploymentId,
                status: deploymentRollbacks.status,
                startedAt: deploymentRollbacks.startedAt,
                completedAt: deploymentRollbacks.completedAt,
            })
            .from(deploymentRollbacks)
            .where(
                and(
                    gte(startTs, start),
                    lte(startTs, end),
                ),
            );

        return rows.map((row) => ({
            deploymentId: row.deploymentId,
            status: String(row.status),
            createdAt: this.toDate(row.startedAt ?? row.completedAt ?? new Date(0)),
        }));
    }

    /** All service rows (id/name/projectId), optionally filtered by name list. */
    async serviceRows(serviceNames?: string[]): Promise<AnalyticsServiceRow[]> {
        const db = this.databaseService.db;
        const where = serviceNames && serviceNames.length > 0 ? inArray(services.name, serviceNames) : undefined;
        const rows = where
            ? await db.select({ id: services.id, name: services.name, projectId: services.projectId }).from(services).where(where)
            : await db.select({ id: services.id, name: services.name, projectId: services.projectId }).from(services);
        return rows.map((row) => ({ id: row.id, name: row.name, projectId: row.projectId }));
    }

    /** Latest deployment row per service id (most recent createdAt). */
    async latestDeploymentPerService(serviceIds: string[]): Promise<Map<string, AnalyticsDeploymentRow>> {
        if (serviceIds.length === 0) return new Map();
        const all = await this.deploymentsInRange(new Date(0), new Date(Date.now() + 24 * 60 * 60 * 1000), serviceIds);
        const latest = new Map<string, AnalyticsDeploymentRow>();
        for (const row of all) {
            const existing = latest.get(row.serviceId);
            if (!existing || row.createdAt.getTime() > existing.createdAt.getTime()) {
                latest.set(row.serviceId, row);
            }
        }
        return latest;
    }

    /** Project names for the given ids (deployment-usage summary). */
    async projectNamesByIds(ids: string[]): Promise<Map<string, string>> {
        if (ids.length === 0) return new Map();
        const db = this.databaseService.db;
        const rows = await db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, ids));
        return new Map(rows.map((row) => [row.id, row.name]));
    }

    /** User names for the given ids (deployment-usage summary). */
    async userNamesByIds(ids: string[]): Promise<Map<string, string>> {
        if (ids.length === 0) return new Map();
        const db = this.databaseService.db;
        const rows = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids));
        return new Map(rows.map((row) => [row.id, row.name ?? row.id]));
    }

    // ─── Reports ────────────────────────────────────────────────────────────

    async createReport(input: {
        name: string;
        format: "json" | "pdf" | "csv";
        periodStart: Date;
        periodEnd: Date;
        sections: string[];
        content: unknown;
        sizeBytes: number;
        status: "pending" | "generating" | "completed" | "failed";
    }): Promise<{ id: string }> {
        const db = this.databaseService.db;
        const [row] = await db
            .insert(analyticsReports)
            .values({
                name: input.name,
                format: input.format,
                periodStart: input.periodStart,
                periodEnd: input.periodEnd,
                sections: input.sections,
                content: input.content,
                sizeBytes: input.sizeBytes,
                status: input.status,
                generatedAt: input.status === "completed" ? new Date() : null,
            })
            .returning({ id: analyticsReports.id });
        if (!row) {
            throw new Error("Failed to persist analytics report");
        }
        return { id: row.id };
    }

    async listReports(limit: number, offset: number, status?: string): Promise<{
        data: Array<{
            id: string;
            name: string;
            status: string;
            generatedAt: Date | null;
            periodStart: Date;
            periodEnd: Date;
            format: string;
            size: number;
        }>;
        total: number;
    }> {
        const db = this.databaseService.db;
        const where = status ? eq(analyticsReports.status, status as never) : undefined;
        const [totalRow] = await (where ? db.select({ value: count() }).from(analyticsReports).where(where) : db.select({ value: count() }).from(analyticsReports));
        const rows = where
            ? await db
                  .select()
                  .from(analyticsReports)
                  .where(where)
                  .orderBy(desc(analyticsReports.createdAt))
                  .limit(limit)
                  .offset(offset)
            : await db
                  .select()
                  .from(analyticsReports)
                  .orderBy(desc(analyticsReports.createdAt))
                  .limit(limit)
                  .offset(offset);
        return {
            data: rows.map((row) => ({
                id: row.id,
                name: row.name,
                status: String(row.status),
                generatedAt: row.generatedAt == null ? null : this.toDate(row.generatedAt),
                periodStart: this.toDate(row.periodStart),
                periodEnd: this.toDate(row.periodEnd),
                format: String(row.format),
                size: row.sizeBytes ?? 0,
            })),
            total: totalRow?.value ?? 0,
        };
    }

    async getReport(id: string): Promise<{ id: string; name: string; status: string; generatedAt: Date | null; periodStart: Date; periodEnd: Date; format: string; size: number; content: unknown; sections: string[]; errorMessage: string | null } | null> {
        const db = this.databaseService.db;
        const [row] = await db.select().from(analyticsReports).where(eq(analyticsReports.id, id)).limit(1);
        if (!row) return null;
        return {
            id: row.id,
            name: row.name,
            status: String(row.status),
            generatedAt: row.generatedAt == null ? null : this.toDate(row.generatedAt),
            periodStart: this.toDate(row.periodStart),
            periodEnd: this.toDate(row.periodEnd),
            format: String(row.format),
            size: row.sizeBytes ?? 0,
            content: row.content,
            sections: row.sections ?? [],
            errorMessage: row.errorMessage,
        };
    }

    async deleteReport(id: string): Promise<boolean> {
        const db = this.databaseService.db;
        const [row] = await db.delete(analyticsReports).where(eq(analyticsReports.id, id)).returning({ id: analyticsReports.id });
        return row != null;
    }

    async createReportConfig(input: {
        name: string;
        description?: string;
        metrics: string[];
        filters?: Record<string, unknown>;
        schedule: "none" | "daily" | "weekly" | "monthly";
        recipients?: string[];
    }): Promise<{ id: string }> {
        const db = this.databaseService.db;
        const [row] = await db
            .insert(analyticsReportConfigs)
            .values({
                name: input.name,
                description: input.description,
                metrics: input.metrics,
                filters: input.filters,
                schedule: input.schedule,
                recipients: input.recipients ?? [],
            })
            .returning({ id: analyticsReportConfigs.id });
        if (!row) {
            throw new Error("Failed to persist analytics report configuration");
        }
        return { id: row.id };
    }

    async listReportConfigs(limit: number, offset: number): Promise<{
        data: Array<{
            id: string;
            name: string;
            description: string | null;
            metrics: string[];
            filters: Record<string, unknown> | null;
            schedule: string;
            recipients: string[];
            createdAt: Date;
            updatedAt: Date;
        }>;
        total: number;
    }> {
        const db = this.databaseService.db;
        const [totalRow] = await db.select({ value: count() }).from(analyticsReportConfigs);
        const rows = await db
            .select()
            .from(analyticsReportConfigs)
            .orderBy(desc(analyticsReportConfigs.createdAt))
            .limit(limit)
            .offset(offset);
        return {
            data: rows.map((row) => ({
                id: row.id,
                name: row.name,
                description: row.description,
                metrics: row.metrics ?? [],
                filters: row.filters ?? null,
                schedule: String(row.schedule),
                recipients: row.recipients ?? [],
                createdAt: this.toDate(row.createdAt),
                updatedAt: this.toDate(row.updatedAt),
            })),
            total: totalRow?.value ?? 0,
        };
    }

    async updateReportConfig(
        id: string,
        updates: {
            name?: string;
            description?: string | null;
            metrics?: string[];
            filters?: Record<string, unknown> | null;
            schedule?: "none" | "daily" | "weekly" | "monthly";
            recipients?: string[];
        },
    ): Promise<boolean> {
        const db = this.databaseService.db;
        const [row] = await db
            .update(analyticsReportConfigs)
            .set({
                name: updates.name,
                description: updates.description,
                metrics: updates.metrics,
                filters: updates.filters,
                schedule: updates.schedule,
                recipients: updates.recipients,
                updatedAt: new Date(),
            })
            .where(eq(analyticsReportConfigs.id, id))
            .returning({ id: analyticsReportConfigs.id });
        return row != null;
    }

    async deleteReportConfig(id: string): Promise<boolean> {
        const db = this.databaseService.db;
        const [row] = await db
            .delete(analyticsReportConfigs)
            .where(eq(analyticsReportConfigs.id, id))
            .returning({ id: analyticsReportConfigs.id });
        return row != null;
    }

    /** Coerce a driver-dependent timestamp to a real Date (analysis boundary). */
    private toDate(value: Date | string): Date {
        return value instanceof Date ? value : new Date(value);
    }
}