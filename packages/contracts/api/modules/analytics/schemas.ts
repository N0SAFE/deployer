import z from "zod/v4";

export const timeRangeSchema = z.enum(["1h", "6h", "12h", "1d", "3d", "7d", "30d", "90d", "1y"]);

export const dateRangeSchema = z.object({
    start: z.date(),
    end: z.date(),
});

export const analyticsResourceUsageSchema = z.object({
    timestamp: z.date(),
    cpu: z.object({
        usage: z.number().min(0).max(100),
        cores: z.number(),
    }),
    memory: z.object({
        used: z.number(),
        total: z.number(),
        percentage: z.number().min(0).max(100),
    }),
    disk: z.object({
        used: z.number(),
        total: z.number(),
        percentage: z.number().min(0).max(100),
    }),
    network: z.object({
        inbound: z.number(),
        outbound: z.number(),
    }),
});

export const applicationMetricsSchema = z.object({
    timestamp: z.date(),
    requestCount: z.number(),
    responseTime: z.object({
        average: z.number(),
        p50: z.number(),
        p95: z.number(),
        p99: z.number(),
    }),
    errorRate: z.number().min(0).max(100),
    activeConnections: z.number(),
    throughput: z.number(),
});

export const databaseMetricsSchema = z.object({
    timestamp: z.date(),
    connections: z.object({
        active: z.number(),
        idle: z.number(),
        max: z.number(),
    }),
    queries: z.object({
        total: z.number(),
        slow: z.number(),
        failed: z.number(),
    }),
    performance: z.object({
        averageQueryTime: z.number(),
        cacheHitRatio: z.number().min(0).max(100),
        deadlocks: z.number(),
    }),
    storage: z.object({
        size: z.number(),
        indexSize: z.number(),
        growth: z.number(),
    }),
});

export const deploymentAnalyticsSchema = z.object({
    timestamp: z.date(),
    deploymentsCount: z.number(),
    successRate: z.number().min(0).max(100),
    averageDeployTime: z.number(),
    failureReasons: z.array(
        z.object({
            reason: z.string(),
            count: z.number(),
        }),
    ),
    rollbackCount: z.number(),
});

export const analyticsServiceHealthSchema = z.object({
    serviceName: z.string(),
    status: z.enum(["healthy", "degraded", "unhealthy", "unknown"]),
    uptime: z.number(),
    lastCheck: z.date(),
    checks: z.array(
        z.object({
            name: z.string(),
            status: z.enum(["pass", "fail", "warn"]),
            message: z.string().optional(),
            timestamp: z.date(),
        }),
    ),
});

export const userActivitySchema = z.object({
    timestamp: z.date(),
    userId: z.string(),
    action: z.string(),
    resource: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    ipAddress: z.string().optional(),
    userAgent: z.string().optional(),
});

export const activitySummarySchema = z.object({
    period: z.string(),
    totalActions: z.number(),
    uniqueUsers: z.number(),
    topActions: z.array(
        z.object({
            action: z.string(),
            count: z.number(),
        }),
    ),
    topResources: z.array(
        z.object({
            resource: z.string(),
            count: z.number(),
        }),
    ),
});

export const reportConfigurationSchema = z.object({
    name: z.string(),
    description: z.string().optional(),
    metrics: z.array(z.string()),
    filters: z.record(z.string(), z.unknown()).optional(),
    schedule: z.enum(["none", "daily", "weekly", "monthly"]).default("none"),
    recipients: z.array(z.string()).optional(),
});

export const analyticsReportSchema = z.object({
    id: z.string(),
    name: z.string(),
    generatedAt: z.date(),
    period: dateRangeSchema,
    summary: z.object({
        totalDeployments: z.number(),
        totalUsers: z.number(),
        totalRequests: z.number(),
        averageResponseTime: z.number(),
        errorRate: z.number(),
    }),
    resourceUsage: z.array(analyticsResourceUsageSchema),
    applicationMetrics: z.array(applicationMetricsSchema),
    databaseMetrics: z.array(databaseMetricsSchema),
    deploymentAnalytics: z.array(deploymentAnalyticsSchema),
    serviceHealth: z.array(analyticsServiceHealthSchema),
    userActivity: activitySummarySchema.optional(),
});

export const getMetricsInputSchema = z.object({
    timeRange: timeRangeSchema.default("1d"),
    granularity: z.enum(["minute", "hour", "day"]).default("hour"),
    metrics: z.array(z.string()).optional(),
    services: z.array(z.string()).optional(),
});

export const getUsageInputSchema = z.object({
    timeRange: timeRangeSchema.default("1d"),
    resource: z.enum(["cpu", "memory", "disk", "network", "all"]).default("all"),
    aggregation: z.enum(["average", "max", "min", "sum"]).default("average"),
});

export const getActivityInputSchema = z.object({
    timeRange: timeRangeSchema.default("1d"),
    userId: z.string().optional(),
    action: z.string().optional(),
    resource: z.string().optional(),
    limit: z.coerce.number().min(1).max(1000).default(100),
    offset: z.coerce.number().min(0).default(0),
});

export const generateReportInputSchema = z.object({
    period: dateRangeSchema,
    includeResourceUsage: z.boolean().default(true),
    includeApplicationMetrics: z.boolean().default(true),
    includeDatabaseMetrics: z.boolean().default(true),
    includeDeploymentAnalytics: z.boolean().default(true),
    includeServiceHealth: z.boolean().default(true),
    includeUserActivity: z.boolean().default(false),
    format: z.enum(["json", "pdf", "csv"]).default("json"),
});
