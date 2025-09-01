import { oc } from '@orpc/contract';
import { z } from 'zod';
import {
  GetUsageInputSchema,
  AnalyticsResourceUsageSchema,
  UserActivitySchema,
  ActivitySummarySchema,
  GetActivityInputSchema,
} from './schemas';

// Get resource usage statistics
export const analyticsGetResourceUsageContract = oc
  .route({
    method: 'GET',
    path: '/usage/resources',
  })
  .input(GetUsageInputSchema.optional())
  .output(z.object({
    data: z.array(AnalyticsResourceUsageSchema),
    summary: z.object({
      peak: AnalyticsResourceUsageSchema,
      average: AnalyticsResourceUsageSchema,
      minimum: AnalyticsResourceUsageSchema,
    }),
    timeRange: z.string(),
  }));

// Get user activity logs
export const analyticsGetUserActivityContract = oc
  .route({
    method: 'GET',
    path: '/usage/activity',
  })
  .input(GetActivityInputSchema.optional())
  .output(z.object({
    data: z.array(UserActivitySchema),
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
  }));

// Get activity summary
export const analyticsGetActivitySummaryContract = oc
  .route({
    method: 'GET',
    path: '/usage/activity/summary',
  })
  .input(z.object({
    period: z.enum(['hour', 'day', 'week', 'month']).default('day'),
    granularity: z.enum(['hour', 'day', 'week']).default('day'),
    limit: z.coerce.number().min(1).max(100).default(30),
  }).optional())
  .output(z.object({
    data: z.array(ActivitySummarySchema),
    totalPeriods: z.number(),
  }));

// Get API usage statistics
export const analyticsGetApiUsageContract = oc
  .route({
    method: 'GET',
    path: '/usage/api',
  })
  .input(z.object({
    timeRange: z.enum(['1h', '6h', '12h', '1d', '3d', '7d', '30d']).default('1d'),
    groupBy: z.enum(['endpoint', 'method', 'status', 'user']).default('endpoint'),
    limit: z.coerce.number().min(1).max(100).default(20),
  }).optional())
  .output(z.object({
    data: z.array(z.object({
      key: z.string(),
      requests: z.number(),
      errors: z.number(),
      averageResponseTime: z.number(),
      dataTransferred: z.number(),
    })),
    total: z.object({
      requests: z.number(),
      errors: z.number(),
      dataTransferred: z.number(),
      uniqueUsers: z.number(),
    }),
    timeRange: z.string(),
  }));

// Get deployment usage statistics
export const analyticsGetDeploymentUsageContract = oc
  .route({
    method: 'GET',
    path: '/usage/deployments',
  })
  .input(z.object({
    timeRange: z.enum(['1d', '3d', '7d', '30d', '90d']).default('30d'),
    projectId: z.string().optional(),
    userId: z.string().optional(),
  }).optional())
  .output(z.object({
    data: z.array(z.object({
      date: z.date(),
      deployments: z.number(),
      successes: z.number(),
      failures: z.number(),
      rollbacks: z.number(),
      averageDuration: z.number(),
    })),
    summary: z.object({
      totalDeployments: z.number(),
      successRate: z.number(),
      averageDeployTime: z.number(),
      mostActiveProjects: z.array(z.object({
        projectId: z.string(),
        projectName: z.string(),
        deploymentCount: z.number(),
      })),
      mostActiveUsers: z.array(z.object({
        userId: z.string(),
        userName: z.string(),
        deploymentCount: z.number(),
      })),
    }),
  }));

// Get storage usage statistics
export const analyticsGetStorageUsageContract = oc
  .route({
    method: 'GET',
    path: '/usage/storage',
  })
  .input(z.object({
    timeRange: z.enum(['1d', '7d', '30d', '90d']).default('30d'),
    breakdown: z.enum(['project', 'service', 'user', 'type']).default('project'),
  }).optional())
  .output(z.object({
    data: z.array(z.object({
      key: z.string(),
      used: z.number(),
      allocated: z.number(),
      files: z.number(),
      growth: z.number(), // Bytes per day
    })),
    total: z.object({
      used: z.number(),
      allocated: z.number(),
      available: z.number(),
      files: z.number(),
      averageFileSize: z.number(),
    }),
    trends: z.array(z.object({
      date: z.date(),
      totalUsed: z.number(),
      filesCount: z.number(),
    })),
  }));