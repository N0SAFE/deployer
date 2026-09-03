import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import z from "zod/v4";
import {
    analyticsResourceUsageSchema,
    applicationMetricsSchema,
    databaseMetricsSchema,
    deploymentAnalyticsSchema,
    analyticsServiceHealthSchema,
    getMetricsInputSchema,
    analyticsDataSourceSchema,
} from "./schemas";

const analyticsResourceMetricsOutputSchema = z.object({
    data: z.array(analyticsResourceUsageSchema),
    timeRange: z.string(),
    granularity: z.string(),
    dataSource: analyticsDataSourceSchema.default("unavailable"),
});

const analyticsApplicationMetricsOutputSchema = z.object({
    data: z.array(applicationMetricsSchema),
    timeRange: z.string(),
    granularity: z.string(),
    dataSource: analyticsDataSourceSchema.default("unavailable"),
});

const analyticsDatabaseMetricsOutputSchema = z.object({
    data: z.array(databaseMetricsSchema),
    timeRange: z.string(),
    granularity: z.string(),
    dataSource: analyticsDataSourceSchema.default("unavailable"),
});

const analyticsDeploymentMetricsOutputSchema = z.object({
    data: z.array(deploymentAnalyticsSchema),
    timeRange: z.string(),
    granularity: z.string(),
    dataSource: analyticsDataSourceSchema.default("unavailable"),
});

const analyticsServiceHealthQuerySchema = z
    .object({
        services: z.array(z.string()).optional(),
    })
    .optional();

const analyticsServiceHealthOutputSchema = z.object({
    data: z.array(analyticsServiceHealthSchema),
    timestamp: z.date(),
    dataSource: analyticsDataSourceSchema.default("unavailable"),
});

const analyticsRealtimeMetricsOutputSchema = z.object({
    timestamp: z.date(),
    system: z.object({
        cpu: z.number(),
        memory: z.number(),
        disk: z.number(),
        network: z.object({
            inbound: z.number(),
            outbound: z.number(),
        }),
    }),
    application: z.object({
        activeConnections: z.number(),
        requestsPerSecond: z.number(),
        averageResponseTime: z.number(),
        errorRate: z.number(),
    }),
    services: z.array(
        z.object({
            name: z.string(),
            status: z.enum(["healthy", "degraded", "unhealthy", "unknown"]),
            responseTime: z.number(),
            uptime: z.number(),
        }),
    ),
    dataSource: analyticsDataSourceSchema.default("unavailable"),
});

const analyticsResourceMetricsOps = standard.zod(analyticsResourceMetricsOutputSchema, "analyticsResourceMetrics");
const analyticsApplicationMetricsOps = standard.zod(analyticsApplicationMetricsOutputSchema, "analyticsApplicationMetrics");
const analyticsDatabaseMetricsOps = standard.zod(analyticsDatabaseMetricsOutputSchema, "analyticsDatabaseMetrics");
const analyticsDeploymentMetricsOps = standard.zod(analyticsDeploymentMetricsOutputSchema, "analyticsDeploymentMetrics");
const analyticsServiceHealthOps = standard.zod(analyticsServiceHealthOutputSchema, "analyticsServiceHealth");
const analyticsRealtimeMetricsOps = standard.zod(analyticsRealtimeMetricsOutputSchema, "analyticsRealtimeMetrics");

export const analyticsGetResourceMetricsContract = analyticsResourceMetricsOps
    .list()
    .path("/metrics/resources")
    .input((input) => input.query(getMetricsInputSchema.optional()))
    .output(analyticsResourceMetricsOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const analyticsGetApplicationMetricsContract = analyticsApplicationMetricsOps
    .list()
    .path("/metrics/application")
    .input((input) => input.query(getMetricsInputSchema.optional()))
    .output(analyticsApplicationMetricsOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const analyticsGetDatabaseMetricsContract = analyticsDatabaseMetricsOps
    .list()
    .path("/metrics/database")
    .input((input) => input.query(getMetricsInputSchema.optional()))
    .output(analyticsDatabaseMetricsOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const analyticsGetDeploymentMetricsContract = analyticsDeploymentMetricsOps
    .list()
    .path("/metrics/deployments")
    .input((input) => input.query(getMetricsInputSchema.optional()))
    .output(analyticsDeploymentMetricsOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const analyticsGetServiceHealthContract = analyticsServiceHealthOps
    .list()
    .path("/metrics/health")
    .input((input) => input.query(analyticsServiceHealthQuerySchema))
    .output(analyticsServiceHealthOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const analyticsGetRealTimeMetricsContract = analyticsRealtimeMetricsOps
    .list()
    .path("/metrics/realtime")
    .input((input) => input.query(analyticsServiceHealthQuerySchema))
    .output(analyticsRealtimeMetricsOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();
