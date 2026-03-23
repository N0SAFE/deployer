import { oc } from "@orpc/contract";
import z from "zod/v4";
import {
    analyticsResourceUsageSchema,
    applicationMetricsSchema,
    databaseMetricsSchema,
    deploymentAnalyticsSchema,
    analyticsServiceHealthSchema,
    getMetricsInputSchema,
} from "./schemas";

export const analyticsGetResourceMetricsContract = oc
    .route({ method: "GET", path: "/metrics/resources" })
    .input(getMetricsInputSchema.optional())
    .output(
        z.object({
            data: z.array(analyticsResourceUsageSchema),
            timeRange: z.string(),
            granularity: z.string(),
        }),
    );

export const analyticsGetApplicationMetricsContract = oc
    .route({ method: "GET", path: "/metrics/application" })
    .input(getMetricsInputSchema.optional())
    .output(
        z.object({
            data: z.array(applicationMetricsSchema),
            timeRange: z.string(),
            granularity: z.string(),
        }),
    );

export const analyticsGetDatabaseMetricsContract = oc
    .route({ method: "GET", path: "/metrics/database" })
    .input(getMetricsInputSchema.optional())
    .output(
        z.object({
            data: z.array(databaseMetricsSchema),
            timeRange: z.string(),
            granularity: z.string(),
        }),
    );

export const analyticsGetDeploymentMetricsContract = oc
    .route({ method: "GET", path: "/metrics/deployments" })
    .input(getMetricsInputSchema.optional())
    .output(
        z.object({
            data: z.array(deploymentAnalyticsSchema),
            timeRange: z.string(),
            granularity: z.string(),
        }),
    );

export const analyticsGetServiceHealthContract = oc
    .route({ method: "GET", path: "/metrics/health" })
    .input(
        z
            .object({
                services: z.array(z.string()).optional(),
            })
            .optional(),
    )
    .output(
        z.object({
            data: z.array(analyticsServiceHealthSchema),
            timestamp: z.date(),
        }),
    );

export const analyticsGetRealTimeMetricsContract = oc
    .route({ method: "GET", path: "/metrics/realtime" })
    .input(
        z
            .object({
                services: z.array(z.string()).optional(),
            })
            .optional(),
    )
    .output(
        z.object({
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
                    status: z.enum(["healthy", "degraded", "unhealthy"]),
                    responseTime: z.number(),
                    uptime: z.number(),
                }),
            ),
        }),
    );
