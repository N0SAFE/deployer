import { Injectable, Logger } from "@nestjs/common";
import * as systeminformation from "systeminformation";
import { NotFoundError } from "@repo/errors";
import { analyticsReportSchema } from "@repo/api-contracts/modules/analytics/schemas";
import {
    AnalyticsRepository,
    type AnalyticsDeploymentRow,
} from "../repositories/analytics.repository";

type TimeRange = "1h" | "6h" | "12h" | "1d" | "3d" | "7d" | "30d" | "90d" | "1y";
type Granularity = "minute" | "hour" | "day";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const TIME_RANGE_MS: Record<TimeRange, number> = {
    "1h": 1 * HOUR,
    "6h": 6 * HOUR,
    "12h": 12 * HOUR,
    "1d": 1 * DAY,
    "3d": 3 * DAY,
    "7d": 7 * DAY,
    "30d": 30 * DAY,
    "90d": 90 * DAY,
    "1y": 365 * DAY,
};

const GRANULARITY_MS: Record<Granularity, number> = {
    minute: 60 * 1000,
    hour: HOUR,
    day: DAY,
};

interface DockerSnapshot {
    ok: boolean;
    cpuPercent: number;
    cores: number;
    memoryUsed: number;
    memoryTotal: number;
    memoryPercent: number;
    diskUsed: number;
    diskTotal: number;
    diskPercent: number;
    networkInbound: number;
    networkOutbound: number;
    containerCount: number;
}

const EMPTY_SNAPSHOT: DockerSnapshot = {
    ok: false,
    cpuPercent: 0,
    cores: 0,
    memoryUsed: 0,
    memoryTotal: 0,
    memoryPercent: 0,
    diskUsed: 0,
    diskTotal: 0,
    diskPercent: 0,
    networkInbound: 0,
    networkOutbound: 0,
    containerCount: 0,
};

const SUCCESS_STATUSES = new Set(["success"]);
const IN_PROGRESS_STATUSES = new Set(["pending", "queued", "building", "deploying"]);

@Injectable()
export class AnalyticsService {
    private readonly logger = new Logger(AnalyticsService.name);

    constructor(private readonly repository: AnalyticsRepository) {}

    async getResourceMetrics(timeRange: string, granularity: string, _services?: string[]) {
        const snapshot = await this.dockerSnapshot();
        const { start, bucketMs, bucketCount } = this.bucketPlan(timeRange, granularity);

        if (!snapshot.ok) {
            return { data: [], timeRange, granularity, dataSource: "unavailable" as const };
        }

        const data = Array.from({ length: bucketCount }, (_, index) => ({
            timestamp: new Date(start.getTime() + index * bucketMs),
            cpu: { usage: round1(snapshot.cpuPercent), cores: snapshot.cores },
            memory: {
                used: snapshot.memoryUsed,
                total: snapshot.memoryTotal,
                percentage: round1(snapshot.memoryPercent),
            },
            disk: {
                used: snapshot.diskUsed,
                total: snapshot.diskTotal,
                percentage: round1(snapshot.diskPercent),
            },
            network: { inbound: snapshot.networkInbound, outbound: snapshot.networkOutbound },
        }));

        return { data, timeRange, granularity, dataSource: "docker" as const };
    }

    async getApplicationMetrics(timeRange: string, granularity: string, _services?: string[]) {
        return { data: [], timeRange, granularity, dataSource: "unavailable" as const };
    }

    async getDatabaseMetrics(timeRange: string, granularity: string, _services?: string[]) {
        return { data: [], timeRange, granularity, dataSource: "unavailable" as const };
    }

    async getDeploymentMetrics(timeRange: string, granularity: string, services?: string[]) {
        const { start, end, bucketMs, bucketCount } = this.bucketPlan(timeRange, granularity);
        const serviceIds = await this.resolveServiceIds(services);
        const deployments = await this.repository.deploymentsInRange(start, end, serviceIds);
        const rollbacks = await this.repository.rollbacksInRange(start, end);

        const buckets = Array.from({ length: bucketCount }, (_, index) => ({
            timestamp: new Date(start.getTime() + index * bucketMs),
            deploymentsCount: 0,
            successRate: 0,
            averageDeployTime: 0,
            failureReasons: [] as Array<{ reason: string; count: number }>,
            rollbackCount: 0,
        }));

        const failureReasonsByBucket = new Map<number, Map<string, number>>();

        for (const deployment of deployments) {
            const index = this.bucketIndex(deployment.createdAt, start, bucketMs, bucketCount);
            // bucketIndex is clamped to [0, bucketCount-1] — safe
            const bucket = buckets[index]!;
            bucket.deploymentsCount += 1;

            if (SUCCESS_STATUSES.has(deployment.status)) {
                const duration = this.deploymentDurationMs(deployment);
                bucket.averageDeployTime = this.rollingAverage(
                    bucket.averageDeployTime,
                    bucket.deploymentsCount - 1,
                    duration,
                );
            }

            const reason = this.failureReason(deployment);
            if (reason) {
                const reasons = failureReasonsByBucket.get(index) ?? new Map<string, number>();
                reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
                failureReasonsByBucket.set(index, reasons);
            }
        }

        for (const rollback of rollbacks) {
            const index = this.bucketIndex(rollback.createdAt, start, bucketMs, bucketCount);
            buckets[index]!.rollbackCount += 1;
        }

        for (let index = 0; index < buckets.length; index++) {
            const bucket = buckets[index]!;
            if (bucket.deploymentsCount > 0) {
                const reasons = failureReasonsByBucket.get(index);
                if (reasons) {
                    bucket.failureReasons = [...reasons.entries()]
                        .map(([reason, count]) => ({ reason, count }))
                        .sort((a, b) => b.count - a.count)
                        .slice(0, 5);
                }
            }
        }

        const total = deployments.length;
        const successful = deployments.filter((d) => SUCCESS_STATUSES.has(d.status)).length;
        const successRate = total > 0 ? round1((successful / total) * 100) : 0;
        for (const bucket of buckets) {
            if (bucket.deploymentsCount > 0) {
                bucket.successRate = successRate;
            }
        }

        return { data: buckets, timeRange, granularity, dataSource: "deployments" as const };
    }

    async getServiceHealth(services?: string[]) {
        const rows = await this.repository.serviceRows(services);
        const serviceIds = rows.map((row) => row.id);
        const latestByService = await this.repository.latestDeploymentPerService(serviceIds);
        const timestamp = new Date();

        const data = rows.map((row) => {
            const latest = latestByService.get(row.id);
            const status = this.deriveStatus(latest);
            const lastSuccess = latest && SUCCESS_STATUSES.has(latest.status) ? latest.deployCompletedAt : null;

            return {
                serviceName: row.name,
                status,
                uptime: lastSuccess ? Math.max(0, (Date.now() - lastSuccess.getTime()) / 1000) : 0,
                lastCheck: timestamp,
                checks: latest
                    ? [
                          {
                              name: "Latest deployment",
                              status: latest.status === "success" ? ("pass" as const) : latest.status === "failed" ? ("fail" as const) : ("warn" as const),
                              message: latest.status === "failed" ? truncate(latest.errorMessage ?? "deployment failed", 160) : `status: ${latest.status}`,
                              timestamp: latest.createdAt,
                          },
                      ]
                    : [{ name: "No deployments yet", status: "warn" as const, message: "no deployment record", timestamp }],
            };
        });

        return { data, timestamp, dataSource: "services" as const };
    }

    async getRealTimeMetrics(services?: string[]) {
        const snapshot = await this.dockerSnapshot();
        const rows = await this.repository.serviceRows(services);
        const latestByService = await this.repository.latestDeploymentPerService(rows.map((row) => row.id));

        const serviceStates = rows.map((row) => {
            const latest = latestByService.get(row.id);
            const status = this.deriveStatus(latest);
            const lastSuccess = latest && SUCCESS_STATUSES.has(latest.status) ? latest.deployCompletedAt : null;
            return {
                name: row.name,
                status,
                responseTime: 0,
                uptime: lastSuccess ? Math.max(0, (Date.now() - lastSuccess.getTime()) / 1000) : 0,
            };
        });

        return {
            timestamp: new Date(),
            system: {
                cpu: round1(snapshot.cpuPercent),
                memory: round1(snapshot.memoryPercent),
                disk: round1(snapshot.diskPercent),
                network: { inbound: snapshot.networkInbound, outbound: snapshot.networkOutbound },
            },
            application: {
                activeConnections: 0,
                requestsPerSecond: 0,
                averageResponseTime: 0,
                errorRate: 0,
            },
            services: serviceStates,
            dataSource: snapshot.ok ? ("docker" as const) : ("unavailable" as const),
        };
    }

    async getResourceUsage(timeRange: string, _resource: string, _aggregation: string) {
        const snapshot = await this.dockerSnapshot();
        const { start, bucketMs, bucketCount } = this.bucketPlan(timeRange, "hour");

        if (!snapshot.ok) {
            return {
                data: [],
                summary: { peak: this.emptyUsage(), average: this.emptyUsage(), minimum: this.emptyUsage() },
                timeRange,
                dataSource: "unavailable" as const,
            };
        }

        const sample = this.snapshotToUsage(snapshot);
        const data = Array.from({ length: bucketCount }, (_, index) => ({
            ...sample,
            timestamp: new Date(start.getTime() + index * bucketMs),
        }));

        return {
            data,
            summary: { peak: sample, average: sample, minimum: sample },
            timeRange,
            dataSource: "docker" as const,
        };
    }

    async getUserActivity(_timeRange: string, _userId?: string, _action?: string, _resource?: string, limit = 100 as number, offset = 0 as number) {
        return { data: [], total: 0, limit, offset, dataSource: "unavailable" as const };
    }

    async getActivitySummary(_period: string, _granularity: string, _limit = 30 as number) {
        return { data: [], totalPeriods: 0, dataSource: "unavailable" as const };
    }

    async getApiUsage(timeRange: string, _groupBy: string, _limit = 20 as number) {
        return {
            data: [],
            total: { requests: 0, errors: 0, dataTransferred: 0, uniqueUsers: 0 },
            timeRange,
            dataSource: "unavailable" as const,
        };
    }

    async getDeploymentUsage(timeRange: string, projectId?: string, userId?: string) {
        void userId;
        const { start, end, bucketMs, bucketCount } = this.bucketPlan(timeRange, "day");
        const serviceIds = projectId ? await this.serviceIdsByProject(projectId) : undefined;
        const deployments = await this.repository.deploymentsInRange(start, end, serviceIds);
        const rollbacks = await this.repository.rollbacksInRange(start, end);
        const rollbackCountByDay = new Map<number, number>();
        for (const rollback of rollbacks) {
            const index = this.bucketIndex(rollback.createdAt, start, bucketMs, bucketCount);
            rollbackCountByDay.set(index, (rollbackCountByDay.get(index) ?? 0) + 1);
        }

        const data = Array.from({ length: bucketCount }, (_, index) => {
            const dayStart = start.getTime() + index * bucketMs;
            const dayEnd = dayStart + bucketMs;
            const dayDeployments = deployments.filter(
                (d) => d.createdAt.getTime() >= dayStart && d.createdAt.getTime() < dayEnd,
            );
            const successes = dayDeployments.filter((d) => SUCCESS_STATUSES.has(d.status)).length;
            const failures = dayDeployments.filter((d) => d.status === "failed").length;
            const durations = dayDeployments
                .map((d) => this.deploymentDurationMs(d))
                .filter((duration) => duration > 0);
            return {
                date: new Date(dayStart),
                deployments: dayDeployments.length,
                successes,
                failures,
                rollbacks: rollbackCountByDay.get(index) ?? 0,
                averageDuration: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
            };
        }).filter((row) => row.deployments > 0 || row.rollbacks > 0);

        const successful = deployments.filter((d) => SUCCESS_STATUSES.has(d.status)).length;
        const durations = deployments.map((d) => this.deploymentDurationMs(d)).filter((duration) => duration > 0);

        const projectCounts = new Map<string, number>();
        for (const deployment of deployments) {
            projectCounts.set(deployment.serviceId, (projectCounts.get(deployment.serviceId) ?? 0) + 1);
        }
        const projectServiceIds = [...projectCounts.keys()];
        const projectNames = await this.repository.projectNamesByIds(projectServiceIds);
        const mostActiveProjects = [...projectCounts.entries()]
            .filter(([id]) => projectNames.has(id))
            .map(([id, count]) => ({ projectId: id, projectName: projectNames.get(id) ?? id, deploymentCount: count }))
            .sort((a, b) => b.deploymentCount - a.deploymentCount)
            .slice(0, 5);

        return {
            data,
            summary: {
                totalDeployments: deployments.length,
                successRate: deployments.length > 0 ? round1((successful / deployments.length) * 100) : 0,
                averageDeployTime: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
                mostActiveProjects,
                mostActiveUsers: [],
            },
            timeRange,
            dataSource: "deployments" as const,
        };
    }

    async getStorageUsage(timeRange: string, _breakdown: string) {
        const snapshot = await this.dockerSnapshot();
        const { start, bucketMs, bucketCount } = this.bucketPlan(timeRange, "day");
        const trends = Array.from({ length: bucketCount }, (_, index) => ({
            date: new Date(start.getTime() + index * bucketMs),
            totalUsed: snapshot.ok ? snapshot.diskUsed : 0,
            filesCount: 0,
        }));
        return {
            data: [],
            total: {
                used: snapshot.ok ? snapshot.diskUsed : 0,
                allocated: 0,
                available: snapshot.ok ? snapshot.diskTotal - snapshot.diskUsed : 0,
                files: 0,
                averageFileSize: 0,
            },
            trends,
            dataSource: snapshot.ok ? ("docker" as const) : ("unavailable" as const),
        };
    }

    async generateReport(input: unknown) {
        const body = input as {
            period: { start: Date; end: Date };
            includeResourceUsage?: boolean;
            includeApplicationMetrics?: boolean;
            includeDatabaseMetrics?: boolean;
            includeDeploymentAnalytics?: boolean;
            includeServiceHealth?: boolean;
            includeUserActivity?: boolean;
            format?: "json" | "pdf" | "csv";
        };
        const period = body?.period;
        if (!period?.start || !period?.end) {
            throw new NotFoundError("Report period is required");
        }
        const start = new Date(period.start);
        const end = new Date(period.end);
        const format = body.format ?? "json";

        const resourceUsage = body.includeResourceUsage !== false ? await this.getResourceUsage("30d", "all", "average") : undefined;
        const applicationMetrics = body.includeApplicationMetrics !== false ? await this.getApplicationMetrics("30d", "hour") : undefined;
        const databaseMetrics = body.includeDatabaseMetrics !== false ? await this.getDatabaseMetrics("30d", "hour") : undefined;
        const deploymentAnalytics = body.includeDeploymentAnalytics !== false ? await this.getDeploymentMetrics("30d", "day") : undefined;
        const serviceHealth = body.includeServiceHealth !== false ? await this.getServiceHealth() : undefined;

        const totalDeployments = deploymentAnalytics?.data.reduce((sum: number, d: { deploymentsCount: number }) => sum + d.deploymentsCount, 0) ?? 0;

        const content = {
            id: "",
            name: `Analytics report — ${formatTime(start)} → ${formatTime(end)}`,
            generatedAt: new Date(),
            period: { start, end },
            summary: {
                totalDeployments,
                totalUsers: 0,
                totalRequests: 0,
                averageResponseTime: 0,
                errorRate: 0,
            },
            resourceUsage: resourceUsage?.data ?? [],
            applicationMetrics: applicationMetrics?.data ?? [],
            databaseMetrics: databaseMetrics?.data ?? [],
            deploymentAnalytics: deploymentAnalytics?.data ?? [],
            serviceHealth: serviceHealth?.data ?? [],
            userActivity: undefined,
        };

        const sections = [
            body.includeResourceUsage !== false && "resourceUsage",
            body.includeApplicationMetrics !== false && "applicationMetrics",
            body.includeDatabaseMetrics !== false && "databaseMetrics",
            body.includeDeploymentAnalytics !== false && "deploymentAnalytics",
            body.includeServiceHealth !== false && "serviceHealth",
        ].filter(Boolean) as string[];

        const sizeBytes = format === "json" ? Buffer.byteLength(JSON.stringify(content), "utf8") : 0;
        const { id } = await this.repository.createReport({
            name: content.name,
            format,
            periodStart: start,
            periodEnd: end,
            sections,
            content,
            sizeBytes,
            status: "completed",
        });
        content.id = id;

        return {
            reportId: id,
            status: "completed" as const,
            message: `Report generated (${format}, sections: ${sections.join(", ") || "none"})`,
            estimatedCompletion: new Date(),
        };
    }

    async getReport(reportId: string) {
        const report = await this.repository.getReport(reportId);
        if (!report || report.content == null) {
            throw new NotFoundError(`Report ${reportId} not found`);
        }
        // The persisted JSON is validated against the contract schema at the
        // read boundary — a corrupt/legacy row surfaces as a parse error rather
        // than silently flowing to the UI.
        return analyticsReportSchema.parse(report.content);
    }

    async listReports(limit: number, offset: number, status?: string) {
        const { data, total } = await this.repository.listReports(limit, offset, status);
        return {
            data: data.map((row) => ({
                id: row.id,
                name: row.name,
                status: row.status as "pending" | "generating" | "completed" | "failed",
                generatedAt: row.generatedAt ?? undefined,
                period: { start: row.periodStart, end: row.periodEnd },
                format: row.format as "json" | "pdf" | "csv",
                size: row.size,
            })),
            total,
            limit,
            offset,
        };
    }

    async deleteReport(reportId: string) {
        const deleted = await this.repository.deleteReport(reportId);
        return {
            success: deleted,
            message: deleted ? `Report ${reportId} deleted` : `Report ${reportId} not found`,
        };
    }

    async downloadReport(reportId: string) {
        const report = await this.repository.getReport(reportId);
        if (!report) {
            throw new NotFoundError(`Report ${reportId} not found`);
        }
        return {
            downloadUrl: `/api/analytics/reports/${reportId}/download`,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            format: report.format as "json" | "pdf" | "csv",
            size: report.size,
        };
    }

    async createReportConfig(input: unknown) {
        const body = input as {
            name: string;
            description?: string;
            metrics: string[];
            filters?: Record<string, unknown>;
            schedule?: "none" | "daily" | "weekly" | "monthly";
            recipients?: string[];
        };
        const { id } = await this.repository.createReportConfig({
            name: body.name,
            description: body.description,
            metrics: body.metrics,
            filters: body.filters,
            schedule: body.schedule ?? "none",
            recipients: body.recipients,
        });
        return {
            id,
            name: body.name,
            description: body.description,
            metrics: body.metrics,
            filters: body.filters,
            schedule: body.schedule ?? "none",
            recipients: body.recipients ?? [],
            createdAt: new Date(),
            updatedAt: new Date(),
        };
    }

    async listReportConfigs(limit: number, offset: number) {
        const { data, total } = await this.repository.listReportConfigs(limit, offset);
        return {
            data: data.map((row) => ({
                id: row.id,
                name: row.name,
                description: row.description ?? undefined,
                metrics: row.metrics,
                filters: row.filters ?? undefined,
                schedule: row.schedule as "none" | "daily" | "weekly" | "monthly",
                recipients: row.recipients,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
            })),
            total,
            limit,
            offset,
        };
    }

    async updateReportConfig(configId: string, updates: Record<string, unknown>) {
        const updated = await this.repository.updateReportConfig(configId, {
            name: updates.name as string | undefined,
            description: (updates.description as string | null | undefined) ?? null,
            metrics: updates.metrics as string[] | undefined,
            filters: (updates.filters as Record<string, unknown> | null | undefined) ?? null,
            schedule: updates.schedule as "none" | "daily" | "weekly" | "monthly" | undefined,
            recipients: updates.recipients as string[] | undefined,
        });
        if (!updated) {
            throw new NotFoundError(`Report configuration ${configId} not found`);
        }
        const configs = await this.repository.listReportConfigs(100, 0);
        const config = configs.data.find((row) => row.id === configId);
        return {
            id: configId,
            name: config?.name ?? (updates.name as string | undefined) ?? "Report config",
            description: config?.description ?? undefined,
            metrics: config?.metrics ?? (updates.metrics as string[] | undefined) ?? [],
            filters: config?.filters ?? undefined,
            schedule: (config?.schedule ?? updates.schedule ?? "none") as "none" | "daily" | "weekly" | "monthly",
            recipients: config?.recipients ?? (updates.recipients as string[] | undefined) ?? [],
            createdAt: config?.createdAt ?? new Date(),
            updatedAt: new Date(),
        };
    }

    async deleteReportConfig(configId: string) {
        const deleted = await this.repository.deleteReportConfig(configId);
        return {
            success: deleted,
            message: deleted ? `Report configuration ${configId} deleted` : `Report configuration ${configId} not found`,
        };
    }

    private async dockerSnapshot(): Promise<DockerSnapshot> {
        try {
            const cpu = await systeminformation.cpu();
            const fs = await systeminformation.fsSize();
            const stats = await systeminformation.dockerContainerStats();

            let cpuPercent = 0;
            let memoryUsed = 0;
            let memoryTotal = 0;
            for (const stat of stats) {
                cpuPercent += Number(stat.cpuPercent ?? 0);
                memoryUsed += Number(stat.memUsage ?? 0);
                memoryTotal += Number(stat.memLimit ?? 0);
            }
            const count = stats.length;
            if (count > 0) cpuPercent /= count;

            let diskUsed = 0;
            let diskTotal = 0;
            for (const entry of fs) {
                diskUsed += Number(entry.used ?? 0);
                diskTotal += Number(entry.size ?? 0);
            }
            const rx = stats.reduce((sum, stat) => sum + Number((stat as { netIO?: { rx?: number } }).netIO?.rx ?? 0), 0);
            const wx = stats.reduce((sum, stat) => sum + Number((stat as { netIO?: { wx?: number } }).netIO?.wx ?? 0), 0);

            return {
                ok: true,
                cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : 0,
                cores: cpu.cores,
                memoryUsed,
                memoryTotal,
                memoryPercent: memoryTotal > 0 ? (memoryUsed / memoryTotal) * 100 : 0,
                diskUsed,
                diskTotal,
                diskPercent: diskTotal > 0 ? (diskUsed / diskTotal) * 100 : 0,
                networkInbound: rx,
                networkOutbound: wx,
                containerCount: count,
            };
        } catch (error) {
            this.logger.warn(`docker snapshot unavailable: ${error instanceof Error ? error.message : String(error)}`);
            return EMPTY_SNAPSHOT;
        }
    }

    private bucketPlan(timeRange: string, granularity: string): { start: Date; end: Date; bucketMs: number; bucketCount: number } {
        const windowMs = TIME_RANGE_MS[(timeRange as TimeRange) ?? "1d"] ?? DAY;
        const bucketMs = GRANULARITY_MS[(granularity as Granularity) ?? "hour"] ?? HOUR;
        const end = Date.now();
        const start = end - windowMs;
        const bucketCount = Math.max(1, Math.min(200, Math.floor(windowMs / bucketMs)));
        return { start: new Date(start), end: new Date(end), bucketMs, bucketCount };
    }

    private bucketIndex(timestamp: Date, start: Date, bucketMs: number, bucketCount: number): number {
        const raw = Math.floor((timestamp.getTime() - start.getTime()) / bucketMs);
        if (raw < 0) return 0;
        if (raw >= bucketCount) return bucketCount - 1;
        return raw;
    }

    private deploymentDurationMs(deployment: AnalyticsDeploymentRow): number {
        if (deployment.deployCompletedAt) {
            const duration = deployment.deployCompletedAt.getTime() - deployment.createdAt.getTime();
            if (duration > 0) return duration;
        }
        return 0;
    }

    private failureReason(deployment: AnalyticsDeploymentRow): string | null {
        if (deployment.status !== "failed") return null;
        const raw = deployment.errorMessage;
        if (!raw || raw.trim().length === 0) return "unknown failure";
        return truncate(raw, 120);
    }

    private rollingAverage(current: number, countSoFar: number, nextValue: number): number {
        if (countSoFar === 0) return nextValue;
        return Math.round(current + (nextValue - current) / (countSoFar + 1));
    }

    private deriveStatus(latest: AnalyticsDeploymentRow | undefined): "healthy" | "degraded" | "unhealthy" | "unknown" {
        if (!latest) return "unknown";
        if (SUCCESS_STATUSES.has(latest.status)) return "healthy";
        if (IN_PROGRESS_STATUSES.has(latest.status)) return "degraded";
        return "unhealthy";
    }

    private snapshotToUsage(snapshot: DockerSnapshot, timestamp = new Date()) {
        return {
            timestamp,
            cpu: { usage: round1(snapshot.cpuPercent), cores: snapshot.cores },
            memory: { used: snapshot.memoryUsed, total: snapshot.memoryTotal, percentage: round1(snapshot.memoryPercent) },
            disk: { used: snapshot.diskUsed, total: snapshot.diskTotal, percentage: round1(snapshot.diskPercent) },
            network: { inbound: snapshot.networkInbound, outbound: snapshot.networkOutbound },
        };
    }

    private emptyUsage() {
        return {
            timestamp: new Date(),
            cpu: { usage: 0, cores: 0 },
            memory: { used: 0, total: 0, percentage: 0 },
            disk: { used: 0, total: 0, percentage: 0 },
            network: { inbound: 0, outbound: 0 },
        };
    }

    private async resolveServiceIds(services?: string[]): Promise<string[] | undefined> {
        if (!services || services.length === 0) return undefined;
        const rows = await this.repository.serviceRows(services);
        return rows.map((row) => row.id);
    }

    private async serviceIdsByProject(projectId: string): Promise<string[]> {
        const rows = await this.repository.serviceRows();
        return rows.filter((row) => row.projectId === projectId).map((row) => row.id);
    }
}

function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

function truncate(value: string, max: number): string {
    if (value.length <= max) return value;
    return `${value.slice(0, max - 1)}…`;
}

function formatTime(date: Date): string {
    return date.toISOString().slice(0, 10);
}
