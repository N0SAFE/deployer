import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

const DEFAULT_CPU_CORES = 4;
const DEFAULT_TOTAL_MEMORY_BYTES = 16 * 1024 * 1024 * 1024;

@Injectable()
export class AnalyticsService {
    getResourceMetrics(timeRange: string, granularity: string, _services?: string[]) {
        const now = Date.now();
        const data = Array.from({ length: 24 }, (_, index) => ({
            timestamp: new Date(now - (23 - index) * 60 * 60 * 1000),
            cpu: {
                usage: Math.random() * 80 + 10,
                cores: DEFAULT_CPU_CORES,
            },
            memory: {
                used: Math.random() * 8 * 1024 * 1024 * 1024,
                total: DEFAULT_TOTAL_MEMORY_BYTES,
                percentage: Math.random() * 80 + 10,
            },
            disk: {
                used: Math.random() * 100 * 1024 * 1024 * 1024,
                total: 500 * 1024 * 1024 * 1024,
                percentage: Math.random() * 60 + 20,
            },
            network: {
                inbound: Math.random() * 1_000_000,
                outbound: Math.random() * 500_000,
            },
        }));

        return { data, timeRange, granularity };
    }

    getApplicationMetrics(timeRange: string, granularity: string, _services?: string[]) {
        const now = Date.now();
        const data = Array.from({ length: 24 }, (_, index) => ({
            timestamp: new Date(now - (23 - index) * 60 * 60 * 1000),
            requestCount: Math.floor(Math.random() * 1000) + 100,
            responseTime: {
                average: Math.random() * 200 + 50,
                p50: Math.random() * 150 + 40,
                p95: Math.random() * 500 + 200,
                p99: Math.random() * 1000 + 500,
            },
            errorRate: Math.random() * 5,
            activeConnections: Math.floor(Math.random() * 100) + 10,
            throughput: Math.random() * 50 + 10,
        }));

        return { data, timeRange, granularity };
    }

    getDatabaseMetrics(timeRange: string, granularity: string, _services?: string[]) {
        const now = Date.now();
        const data = Array.from({ length: 24 }, (_, index) => ({
            timestamp: new Date(now - (23 - index) * 60 * 60 * 1000),
            connections: {
                active: Math.floor(Math.random() * 20) + 5,
                idle: Math.floor(Math.random() * 10) + 2,
                max: 100,
            },
            queries: {
                total: Math.floor(Math.random() * 1000) + 100,
                slow: Math.floor(Math.random() * 10),
                failed: Math.floor(Math.random() * 5),
            },
            performance: {
                averageQueryTime: Math.random() * 100 + 10,
                cacheHitRatio: Math.random() * 20 + 80,
                deadlocks: Math.floor(Math.random() * 3),
            },
            storage: {
                size: Math.random() * 10 * 1024 * 1024 * 1024,
                indexSize: Math.random() * 2 * 1024 * 1024 * 1024,
                growth: Math.random() * 100 * 1024 * 1024,
            },
        }));

        return { data, timeRange, granularity };
    }

    getDeploymentMetrics(timeRange: string, granularity: string, _services?: string[]) {
        const now = Date.now();
        const data = Array.from({ length: 7 }, (_, index) => ({
            timestamp: new Date(now - (6 - index) * 24 * 60 * 60 * 1000),
            deploymentsCount: Math.floor(Math.random() * 10) + 1,
            successRate: Math.random() * 20 + 80,
            averageDeployTime: Math.random() * 300 + 60,
            failureReasons: [
                { reason: "Build failed", count: Math.floor(Math.random() * 3) },
                { reason: "Tests failed", count: Math.floor(Math.random() * 2) },
                { reason: "Network timeout", count: Math.floor(Math.random() * 2) },
            ],
            rollbackCount: Math.floor(Math.random() * 2),
        }));

        return { data, timeRange, granularity };
    }

    getServiceHealth(services?: string[]) {
        const selectedServices = services ?? ["api", "database", "cache", "proxy"];

        const data = selectedServices.map((serviceName) => ({
            serviceName,
            status: ["healthy", "degraded", "unhealthy"][Math.floor(Math.random() * 3)] as
                | "healthy"
                | "degraded"
                | "unhealthy",
            uptime: Math.random() * 86400 * 30,
            lastCheck: new Date(),
            checks: [
                {
                    name: "HTTP Health Check",
                    status: ["pass", "fail", "warn"][Math.floor(Math.random() * 3)] as
                        | "pass"
                        | "fail"
                        | "warn",
                    message: "Service responding normally",
                    timestamp: new Date(),
                },
                {
                    name: "Dependency Connectivity",
                    status: "pass" as const,
                    timestamp: new Date(),
                },
            ],
        }));

        return { data, timestamp: new Date() };
    }

    getRealTimeMetrics(services?: string[]) {
        const selectedServices = services ?? ["api", "database", "cache"];

        return {
            timestamp: new Date(),
            system: {
                cpu: Math.random() * 80 + 10,
                memory: Math.random() * 80 + 10,
                disk: Math.random() * 60 + 20,
                network: {
                    inbound: Math.random() * 1_000_000,
                    outbound: Math.random() * 500_000,
                },
            },
            application: {
                activeConnections: Math.floor(Math.random() * 100) + 10,
                requestsPerSecond: Math.random() * 50 + 10,
                averageResponseTime: Math.random() * 200 + 50,
                errorRate: Math.random() * 5,
            },
            services: selectedServices.map((name) => ({
                name,
                status: ["healthy", "degraded", "unhealthy"][Math.floor(Math.random() * 3)] as
                    | "healthy"
                    | "degraded"
                    | "unhealthy",
                responseTime: Math.random() * 100 + 10,
                uptime: Math.random() * 86400 * 30,
            })),
        };
    }

    getResourceUsage(timeRange: string, _resource: string, _aggregation: string) {
        const data = this.getResourceMetrics(timeRange, "hour").data;
        const first = data[0];

        if (!first) {
            throw new Error("No resource metrics available");
        }

        const peak = data.reduce((acc, current) => ({
            ...current,
            cpu: { ...current.cpu, usage: Math.max(acc.cpu.usage, current.cpu.usage) },
            memory: { ...current.memory, percentage: Math.max(acc.memory.percentage, current.memory.percentage) },
            disk: { ...current.disk, percentage: Math.max(acc.disk.percentage, current.disk.percentage) },
            network: {
                inbound: Math.max(acc.network.inbound, current.network.inbound),
                outbound: Math.max(acc.network.outbound, current.network.outbound),
            },
        }), first);

        const minimum = data.reduce((acc, current) => ({
            ...current,
            cpu: { ...current.cpu, usage: Math.min(acc.cpu.usage, current.cpu.usage) },
            memory: { ...current.memory, percentage: Math.min(acc.memory.percentage, current.memory.percentage) },
            disk: { ...current.disk, percentage: Math.min(acc.disk.percentage, current.disk.percentage) },
            network: {
                inbound: Math.min(acc.network.inbound, current.network.inbound),
                outbound: Math.min(acc.network.outbound, current.network.outbound),
            },
        }), first);

        const count = data.length;
        const average = {
            timestamp: new Date(),
            cpu: {
                usage: data.reduce((sum, entry) => sum + entry.cpu.usage, 0) / count,
                cores: DEFAULT_CPU_CORES,
            },
            memory: {
                used: data.reduce((sum, entry) => sum + entry.memory.used, 0) / count,
                total: DEFAULT_TOTAL_MEMORY_BYTES,
                percentage: data.reduce((sum, entry) => sum + entry.memory.percentage, 0) / count,
            },
            disk: {
                used: data.reduce((sum, entry) => sum + entry.disk.used, 0) / count,
                total: 500 * 1024 * 1024 * 1024,
                percentage: data.reduce((sum, entry) => sum + entry.disk.percentage, 0) / count,
            },
            network: {
                inbound: data.reduce((sum, entry) => sum + entry.network.inbound, 0) / count,
                outbound: data.reduce((sum, entry) => sum + entry.network.outbound, 0) / count,
            },
        };

        return {
            data,
            summary: { peak, average, minimum },
            timeRange,
        };
    }

    getUserActivity(
        _timeRange: string,
        userId?: string,
        action?: string,
        resource?: string,
        limit = 100,
        offset = 0,
    ) {
        const actions = ["login", "deploy", "view", "update", "delete"] as const;
        const resources = ["project", "service", "deployment", "environment"] as const;

        const data = Array.from({ length: Math.min(limit, 50) }, () => ({
            timestamp: new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000),
            userId: userId ?? `user-${String(Math.floor(Math.random() * 10) + 1)}`,
            action: action ?? actions[Math.floor(Math.random() * actions.length)] ?? "view",
            resource: resource ?? resources[Math.floor(Math.random() * resources.length)] ?? "project",
            details: {
                ip: `192.168.1.${String(Math.floor(Math.random() * 255))}`,
                userAgent: "Mozilla/5.0 (Chrome)",
            },
            ipAddress: `192.168.1.${String(Math.floor(Math.random() * 255))}`,
            userAgent: "Mozilla/5.0 (Chrome)",
        }));

        return {
            data,
            total: 500,
            limit,
            offset,
        };
    }

    getActivitySummary(_period: string, _granularity: string, limit: number) {
        const data = Array.from({ length: Math.min(limit, 30) }, (_, i) => ({
            period: `2024-01-${String(i + 1).padStart(2, "0")}`,
            totalActions: Math.floor(Math.random() * 1000) + 100,
            uniqueUsers: Math.floor(Math.random() * 50) + 10,
            topActions: [
                { action: "deploy", count: Math.floor(Math.random() * 100) + 20 },
                { action: "view", count: Math.floor(Math.random() * 200) + 50 },
                { action: "update", count: Math.floor(Math.random() * 80) + 15 },
            ],
            topResources: [
                { resource: "project", count: Math.floor(Math.random() * 150) + 30 },
                { resource: "service", count: Math.floor(Math.random() * 120) + 25 },
                { resource: "deployment", count: Math.floor(Math.random() * 100) + 20 },
            ],
        }));

        return {
            data,
            totalPeriods: 365,
        };
    }

    getApiUsage(timeRange: string, _groupBy: string, _limit: number) {
        return {
            data: [],
            total: {
                requests: 0,
                errors: 0,
                dataTransferred: 0,
                uniqueUsers: 0,
            },
            timeRange,
        };
    }

    getDeploymentUsage(_timeRange: string, _projectId?: string, _userId?: string) {
        return {
            data: [],
            summary: {
                totalDeployments: 0,
                successRate: 0,
                averageDeployTime: 0,
                mostActiveProjects: [],
                mostActiveUsers: [],
            },
        };
    }

    getStorageUsage(_timeRange: string, _breakdown: string) {
        return {
            data: [],
            total: {
                used: 0,
                allocated: 0,
                available: 0,
                files: 0,
                averageFileSize: 0,
            },
            trends: [],
        };
    }

    generateReport(period: { start: Date; end: Date }, _format: "json" | "pdf" | "csv") {
        return {
            reportId: `report-${randomUUID()}`,
            status: "pending" as const,
            message: `Report generation started for ${period.start.toISOString()} - ${period.end.toISOString()}`,
            estimatedCompletion: new Date(Date.now() + 5 * 60 * 1000),
        };
    }

    getReport(reportId: string) {
        return {
            id: reportId,
            status: "generating" as const,
            progress: 45,
        };
    }

    listReports(limit: number, offset: number) {
        return {
            data: [],
            total: 0,
            limit,
            offset,
        };
    }

    deleteReport(reportId: string) {
        return {
            success: true,
            message: `Report ${reportId} deleted successfully`,
        };
    }

    downloadReport(reportId: string) {
        return {
            downloadUrl: `http://localhost:3000/api/analytics/reports/${reportId}/download`,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            format: "json" as const,
            size: 1024 * 1024,
        };
    }

    createReportConfig(input: {
        name: string;
        description?: string;
        metrics: string[];
        filters?: Record<string, unknown>;
        schedule: "none" | "daily" | "weekly" | "monthly";
        recipients?: string[];
    }) {
        return {
            id: `config-${randomUUID()}`,
            ...input,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
    }

    listReportConfigs(limit: number, offset: number) {
        return {
            data: [],
            total: 0,
            limit,
            offset,
        };
    }

    updateReportConfig(
        configId: string,
        updates: {
            name?: string;
            description?: string;
            metrics?: string[];
            filters?: Record<string, unknown>;
            schedule?: "none" | "daily" | "weekly" | "monthly";
            recipients?: string[];
        },
    ) {
        return {
            id: configId,
            name: updates.name ?? "Updated Report Config",
            description: updates.description,
            metrics: updates.metrics ?? [],
            filters: updates.filters,
            schedule: updates.schedule ?? "none",
            recipients: updates.recipients,
            createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
            updatedAt: new Date(),
        };
    }

    deleteReportConfig(configId: string) {
        return {
            success: true,
            message: `Report configuration ${configId} deleted successfully`,
        };
    }
}
