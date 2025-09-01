import { z } from 'zod';

// Analytics time range schema
export const TimeRangeSchema = z.enum(['1h', '6h', '12h', '1d', '3d', '7d', '30d', '90d', '1y']);

export const DateRangeSchema = z.object({
  start: z.date(),
  end: z.date(),
});

// Usage metrics schemas
export const AnalyticsResourceUsageSchema = z.object({
  timestamp: z.date(),
  cpu: z.object({
    usage: z.number().min(0).max(100), // Percentage
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
    inbound: z.number(), // Bytes per second
    outbound: z.number(), // Bytes per second
  }),
});

export const ApplicationMetricsSchema = z.object({
  timestamp: z.date(),
  requestCount: z.number(),
  responseTime: z.object({
    average: z.number(),
    p50: z.number(),
    p95: z.number(),
    p99: z.number(),
  }),
  errorRate: z.number().min(0).max(100), // Percentage
  activeConnections: z.number(),
  throughput: z.number(), // Requests per second
});

export const DatabaseMetricsSchema = z.object({
  timestamp: z.date(),
  connections: z.object({
    active: z.number(),
    idle: z.number(),
    max: z.number(),
  }),
  queries: z.object({
    total: z.number(),
    slow: z.number(), // Queries taking more than threshold
    failed: z.number(),
  }),
  performance: z.object({
    averageQueryTime: z.number(), // Milliseconds
    cacheHitRatio: z.number().min(0).max(100), // Percentage
    deadlocks: z.number(),
  }),
  storage: z.object({
    size: z.number(), // Bytes
    indexSize: z.number(), // Bytes
    growth: z.number(), // Bytes per day
  }),
});

// Deployment analytics schemas
export const DeploymentAnalyticsSchema = z.object({
  timestamp: z.date(),
  deploymentsCount: z.number(),
  successRate: z.number().min(0).max(100), // Percentage
  averageDeployTime: z.number(), // Seconds
  failureReasons: z.array(z.object({
    reason: z.string(),
    count: z.number(),
  })),
  rollbackCount: z.number(),
});

export const AnalyticsServiceHealthSchema = z.object({
  serviceName: z.string(),
  status: z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']),
  uptime: z.number(), // Seconds
  lastCheck: z.date(),
  checks: z.array(z.object({
    name: z.string(),
    status: z.enum(['pass', 'fail', 'warn']),
    message: z.string().optional(),
    timestamp: z.date(),
  })),
});

// User activity schemas
export const UserActivitySchema = z.object({
  timestamp: z.date(),
  userId: z.string(),
  action: z.string(),
  resource: z.string(),
  details: z.record(z.string(), z.any()).optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
});

export const ActivitySummarySchema = z.object({
  period: z.string(), // e.g., "2024-01", "2024-W01", "2024-01-01"
  totalActions: z.number(),
  uniqueUsers: z.number(),
  topActions: z.array(z.object({
    action: z.string(),
    count: z.number(),
  })),
  topResources: z.array(z.object({
    resource: z.string(),
    count: z.number(),
  })),
});

// Analytics report schemas
export const ReportConfigurationSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  metrics: z.array(z.string()), // Metric names to include
  filters: z.record(z.string(), z.any()).optional(),
  schedule: z.enum(['none', 'daily', 'weekly', 'monthly']).default('none'),
  recipients: z.array(z.string()).optional(), // Email addresses
});

export const AnalyticsReportSchema = z.object({
  id: z.string(),
  name: z.string(),
  generatedAt: z.date(),
  period: DateRangeSchema,
  summary: z.object({
    totalDeployments: z.number(),
    totalUsers: z.number(),
    totalRequests: z.number(),
    averageResponseTime: z.number(),
    errorRate: z.number(),
  }),
  resourceUsage: z.array(AnalyticsResourceUsageSchema),
  applicationMetrics: z.array(ApplicationMetricsSchema),
  databaseMetrics: z.array(DatabaseMetricsSchema),
  deploymentAnalytics: z.array(DeploymentAnalyticsSchema),
  serviceHealth: z.array(AnalyticsServiceHealthSchema),
  userActivity: ActivitySummarySchema.optional(),
});

// Input schemas for API endpoints
export const GetMetricsInputSchema = z.object({
  timeRange: TimeRangeSchema.default('1d'),
  granularity: z.enum(['minute', 'hour', 'day']).default('hour'),
  metrics: z.array(z.string()).optional(), // Specific metrics to retrieve
  services: z.array(z.string()).optional(), // Filter by service names
});

export const GetUsageInputSchema = z.object({
  timeRange: TimeRangeSchema.default('1d'),
  resource: z.enum(['cpu', 'memory', 'disk', 'network', 'all']).default('all'),
  aggregation: z.enum(['average', 'max', 'min', 'sum']).default('average'),
});

export const GetActivityInputSchema = z.object({
  timeRange: TimeRangeSchema.default('1d'),
  userId: z.string().optional(),
  action: z.string().optional(),
  resource: z.string().optional(),
  limit: z.coerce.number().min(1).max(1000).default(100),
  offset: z.coerce.number().min(0).default(0),
});

export const GenerateReportInputSchema = z.object({
  period: DateRangeSchema,
  includeResourceUsage: z.boolean().default(true),
  includeApplicationMetrics: z.boolean().default(true),
  includeDatabaseMetrics: z.boolean().default(true),
  includeDeploymentAnalytics: z.boolean().default(true),
  includeServiceHealth: z.boolean().default(true),
  includeUserActivity: z.boolean().default(false),
  format: z.enum(['json', 'pdf', 'csv']).default('json'),
});