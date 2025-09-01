import { oc } from '@orpc/contract';
import { z } from 'zod';
import {
  GetMetricsInputSchema,
  AnalyticsResourceUsageSchema,
  ApplicationMetricsSchema,
  DatabaseMetricsSchema,
  DeploymentAnalyticsSchema,
  AnalyticsServiceHealthSchema,
} from './schemas';

// Get system resource metrics
export const analyticsGetResourceMetricsContract = oc
  .route({
    method: 'GET',
    path: '/metrics/resources',
  })
  .input(GetMetricsInputSchema.optional())
  .output(z.object({
    data: z.array(AnalyticsResourceUsageSchema),
    timeRange: z.string(),
    granularity: z.string(),
  }));

// Get application performance metrics
export const analyticsGetApplicationMetricsContract = oc
  .route({
    method: 'GET',
    path: '/metrics/application',
  })
  .input(GetMetricsInputSchema.optional())
  .output(z.object({
    data: z.array(ApplicationMetricsSchema),
    timeRange: z.string(),
    granularity: z.string(),
  }));

// Get database performance metrics
export const analyticsGetDatabaseMetricsContract = oc
  .route({
    method: 'GET',
    path: '/metrics/database',
  })
  .input(GetMetricsInputSchema.optional())
  .output(z.object({
    data: z.array(DatabaseMetricsSchema),
    timeRange: z.string(),
    granularity: z.string(),
  }));

// Get deployment analytics
export const analyticsGetDeploymentMetricsContract = oc
  .route({
    method: 'GET',
    path: '/metrics/deployments',
  })
  .input(GetMetricsInputSchema.optional())
  .output(z.object({
    data: z.array(DeploymentAnalyticsSchema),
    timeRange: z.string(),
    granularity: z.string(),
  }));

// Get service health metrics
export const analyticsGetServiceHealthContract = oc
  .route({
    method: 'GET',
    path: '/metrics/health',
  })
  .input(z.object({
    services: z.array(z.string()).optional(),
  }).optional())
  .output(z.object({
    data: z.array(AnalyticsServiceHealthSchema),
    timestamp: z.date(),
  }));

// Get real-time metrics summary
export const analyticsGetRealTimeMetricsContract = oc
  .route({
    method: 'GET',
    path: '/metrics/realtime',
  })
  .input(z.object({
    services: z.array(z.string()).optional(),
  }).optional())
  .output(z.object({
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
    services: z.array(z.object({
      name: z.string(),
      status: z.enum(['healthy', 'degraded', 'unhealthy']),
      responseTime: z.number(),
      uptime: z.number(),
    })),
  }));