import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import z from "zod/v4";
import {
    analyticsResourceUsageSchema,
    userActivitySchema,
    activitySummarySchema,
    getActivityInputSchema,
    getUsageInputSchema,
    analyticsDataSourceSchema,
} from "./schemas";

const analyticsResourceUsageOutputSchema = z.object({
    data: z.array(analyticsResourceUsageSchema),
    summary: z.object({
        peak: analyticsResourceUsageSchema,
        average: analyticsResourceUsageSchema,
        minimum: analyticsResourceUsageSchema,
    }),
    timeRange: z.string(),
    dataSource: analyticsDataSourceSchema.default("unavailable"),
});

const analyticsUserActivityOutputSchema = z.object({
    data: z.array(userActivitySchema),
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    dataSource: analyticsDataSourceSchema.default("unavailable"),
});

const analyticsActivitySummaryQuerySchema = z
    .object({
        period: z.enum(["hour", "day", "week", "month"]).default("day"),
        granularity: z.enum(["hour", "day", "week"]).default("day"),
        limit: z.coerce.number().min(1).max(100).default(30),
    })
    .optional();

const analyticsActivitySummaryOutputSchema = z.object({
    data: z.array(activitySummarySchema),
    totalPeriods: z.number(),
    dataSource: analyticsDataSourceSchema.default("unavailable"),
});

const analyticsApiUsageQuerySchema = z
    .object({
        timeRange: z.enum(["1h", "6h", "12h", "1d", "3d", "7d", "30d"]).default("1d"),
        groupBy: z.enum(["endpoint", "method", "status", "user"]).default("endpoint"),
        limit: z.coerce.number().min(1).max(100).default(20),
    })
    .optional();

const analyticsApiUsageOutputSchema = z.object({
    data: z.array(
        z.object({
            key: z.string(),
            requests: z.number(),
            errors: z.number(),
            averageResponseTime: z.number(),
            dataTransferred: z.number(),
        }),
    ),
    total: z.object({
        requests: z.number(),
        errors: z.number(),
        dataTransferred: z.number(),
        uniqueUsers: z.number(),
    }),
    timeRange: z.string(),
    dataSource: analyticsDataSourceSchema.default("unavailable"),
});

const analyticsDeploymentUsageQuerySchema = z
    .object({
        timeRange: z.enum(["1d", "3d", "7d", "30d", "90d"]).default("30d"),
        projectId: z.string().optional(),
        userId: z.string().optional(),
    })
    .optional();

const analyticsDeploymentUsageOutputSchema = z.object({
    data: z.array(
        z.object({
            date: z.date(),
            deployments: z.number(),
            successes: z.number(),
            failures: z.number(),
            rollbacks: z.number(),
            averageDuration: z.number(),
        }),
    ),
    summary: z.object({
        totalDeployments: z.number(),
        successRate: z.number(),
        averageDeployTime: z.number(),
        mostActiveProjects: z.array(
            z.object({
                projectId: z.string(),
                projectName: z.string(),
                deploymentCount: z.number(),
            }),
        ),
        mostActiveUsers: z.array(
            z.object({
                userId: z.string(),
                userName: z.string(),
                deploymentCount: z.number(),
            }),
        ),
    }),
    dataSource: analyticsDataSourceSchema.default("unavailable"),
});

const analyticsStorageUsageQuerySchema = z
    .object({
        timeRange: z.enum(["1d", "7d", "30d", "90d"]).default("30d"),
        breakdown: z.enum(["project", "service", "user", "type"]).default("project"),
    })
    .optional();

const analyticsStorageUsageOutputSchema = z.object({
    data: z.array(
        z.object({
            key: z.string(),
            used: z.number(),
            allocated: z.number(),
            files: z.number(),
            growth: z.number(),
        }),
    ),
    total: z.object({
        used: z.number(),
        allocated: z.number(),
        available: z.number(),
        files: z.number(),
        averageFileSize: z.number(),
    }),
    trends: z.array(
        z.object({
            date: z.date(),
            totalUsed: z.number(),
            filesCount: z.number(),
        }),
    ),
    dataSource: analyticsDataSourceSchema.default("unavailable"),
});

const analyticsResourceUsageOps = standard.zod(analyticsResourceUsageOutputSchema, "analyticsResourceUsage");
const analyticsUserActivityOps = standard.zod(analyticsUserActivityOutputSchema, "analyticsUserActivity");
const analyticsActivitySummaryOps = standard.zod(analyticsActivitySummaryOutputSchema, "analyticsActivitySummary");
const analyticsApiUsageOps = standard.zod(analyticsApiUsageOutputSchema, "analyticsApiUsage");
const analyticsDeploymentUsageOps = standard.zod(analyticsDeploymentUsageOutputSchema, "analyticsDeploymentUsage");
const analyticsStorageUsageOps = standard.zod(analyticsStorageUsageOutputSchema, "analyticsStorageUsage");

export const analyticsGetResourceUsageContract = analyticsResourceUsageOps
    .list()
    .path("/usage/resources")
    .input((input) => input.query(getUsageInputSchema.optional()))
    .output(analyticsResourceUsageOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const analyticsGetUserActivityContract = analyticsUserActivityOps
    .list()
    .path("/usage/activity")
    .input((input) => input.query(getActivityInputSchema.optional()))
    .output(analyticsUserActivityOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const analyticsGetActivitySummaryContract = analyticsActivitySummaryOps
    .list()
    .path("/usage/activity/summary")
    .input((input) => input.query(analyticsActivitySummaryQuerySchema))
    .output(analyticsActivitySummaryOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const analyticsGetApiUsageContract = analyticsApiUsageOps
    .list()
    .path("/usage/api")
    .input((input) => input.query(analyticsApiUsageQuerySchema))
    .output(analyticsApiUsageOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const analyticsGetDeploymentUsageContract = analyticsDeploymentUsageOps
    .list()
    .path("/usage/deployments")
    .input((input) => input.query(analyticsDeploymentUsageQuerySchema))
    .output(analyticsDeploymentUsageOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const analyticsGetStorageUsageContract = analyticsStorageUsageOps
    .list()
    .path("/usage/storage")
    .input((input) => input.query(analyticsStorageUsageQuerySchema))
    .output(analyticsStorageUsageOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();
