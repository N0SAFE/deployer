import { z } from "zod";
// Base schemas
export const ResourceMetricSchema = z.object({
    allocated: z.number(),
    used: z.number(),
    percentage: z.number(),
});
export const ReplicaMetricSchema = z.object({
    total: z.number(),
    running: z.number(),
});
export const ResourceUsageSchema = z.object({
    cpu: ResourceMetricSchema,
    memory: ResourceMetricSchema,
    storage: ResourceMetricSchema,
    replicas: ReplicaMetricSchema,
    services: z.number(),
});
export const ResourceQuotaSchema = z.object({
    cpuLimit: z.string().optional(),
    memoryLimit: z.string().optional(),
    storageLimit: z.string().optional(),
    maxReplicas: z.number().optional(),
    maxServices: z.number().optional(),
});
export const SwarmStackConfigSchema = z.object({
    name: z.string(),
    projectId: z.string(),
    environment: z.string(),
    composeConfig: z.record(z.string(), z.any()),
    domain: z.string().optional(),
});
export const CreateStackRequestSchema = z.object({
    projectId: z.string(),
    environment: z.string(),
    stackName: z.string(),
    composeConfig: z.any(),
    resourceQuotas: ResourceQuotaSchema.optional(),
    domainMappings: z.record(z.string(), z.array(z.string())).optional(),
    sslConfig: z.object({
        email: z.string(),
        provider: z.enum(['letsencrypt', 'cloudflare', 'custom']),
        staging: z.boolean().optional(),
    }).optional(),
});
export const UpdateStackRequestSchema = z.object({
    composeConfig: z.any().optional(),
    resourceQuotas: ResourceQuotaSchema.optional(),
    domainMappings: z.record(z.string(), z.array(z.string())).optional(),
});
export const ScaleServicesRequestSchema = z.record(z.string(), z.number());
export const SetQuotasRequestSchema = z.object({
    quotas: ResourceQuotaSchema,
});
export const DomainMappingSchema = z.object({
    service: z.string(),
    domains: z.array(z.string()),
    ssl: z.boolean().optional(),
    middleware: z.array(z.string()).optional(),
});
export const TraefikConfigSchema = z.object({
    services: z.array(z.object({
        name: z.string(),
        port: z.number(),
        domains: z.array(z.string()),
        ssl: z.boolean().optional(),
    })),
    middleware: z.array(z.string()).optional(),
    ssl: z.object({
        email: z.string(),
        provider: z.string(),
        staging: z.boolean().optional(),
    }).optional(),
});
export const ResourceCapacityCheckSchema = z.object({
    allowed: z.boolean(),
    violations: z.array(z.string()),
});
export const ResourceAllocationSchema = z.object({
    projectId: z.string(),
    environment: z.string(),
    quotas: ResourceQuotaSchema,
    usage: ResourceUsageSchema,
    lastUpdated: z.date(),
});
export const SystemResourceSummarySchema = z.object({
    totalCpu: z.object({
        allocated: z.number(),
        used: z.number(),
        limit: z.number(),
    }),
    totalMemory: z.object({
        allocated: z.number(),
        used: z.number(),
        limit: z.number(),
    }),
    totalStorage: z.object({
        allocated: z.number(),
        used: z.number(),
        limit: z.number(),
    }),
    totalReplicas: z.object({
        total: z.number(),
        running: z.number(),
    }),
    totalServices: z.number(),
    projectCount: z.number(),
});
export const ResourceAlertSchema = z.object({
    id: z.string(),
    severity: z.enum(['warning', 'critical']),
    projectId: z.string(),
    environment: z.string(),
    resource: z.enum(['cpu', 'memory', 'storage', 'replicas']),
    message: z.string(),
    threshold: z.number(),
    currentUsage: z.number(),
    timestamp: z.date(),
});
export const CertificateStatusSchema = z.object({
    domain: z.string(),
    status: z.enum(['valid', 'expired', 'pending', 'error']),
    issuer: z.string().optional(),
    expiryDate: z.date().optional(),
    lastChecked: z.date(),
});
export const StackStatusSchema = z.object({
    id: z.string(),
    name: z.string(),
    projectId: z.string(),
    environment: z.string(),
    status: z.enum(['pending', 'deploying', 'running', 'error', 'stopped']),
    services: z.array(z.object({
        name: z.string(),
        replicas: z.object({
            desired: z.number(),
            current: z.number(),
            updated: z.number(),
        }),
        status: z.string(),
        ports: z.array(z.number()).optional(),
        endpoints: z.array(z.string()).optional(),
    })),
    createdAt: z.date(),
    updatedAt: z.date(),
    resourceUsage: ResourceUsageSchema.optional(),
});
export const JobStatusSchema = z.object({
    id: z.string(),
    name: z.string(),
    queue: z.string(),
    type: z.enum(['deployment', 'scaling', 'ssl-renewal', 'health-check', 'resource-monitoring']),
    status: z.enum(['waiting', 'active', 'completed', 'failed', 'delayed', 'paused']),
    priority: z.number(),
    attempts: z.number(),
    maxAttempts: z.number(),
    progress: z.number().min(0).max(100),
    data: z.record(z.string(), z.any()).optional(),
    result: z.record(z.string(), z.any()).optional(),
    error: z.string().optional(),
    stackTrace: z.string().optional(),
    logs: z.array(z.object({
        timestamp: z.date(),
        level: z.enum(['info', 'warn', 'error', 'debug']),
        message: z.string(),
        metadata: z.record(z.string(), z.any()).optional(),
    })).optional(),
    createdAt: z.date(),
    startedAt: z.date().optional(),
    completedAt: z.date().optional(),
    duration: z.number().optional(),
    nextRunAt: z.date().optional(),
});
export const JobQueueStatsSchema = z.object({
    queue: z.string(),
    waiting: z.number(),
    active: z.number(),
    completed: z.number(),
    failed: z.number(),
    delayed: z.number(),
    paused: z.number(),
    throughput: z.object({
        perMinute: z.number(),
        perHour: z.number(),
        perDay: z.number(),
    }),
    avgProcessingTime: z.number(),
    avgWaitingTime: z.number(),
});
export const JobHistoryEntrySchema = z.object({
    id: z.string(),
    jobId: z.string(),
    status: z.enum(['started', 'progress', 'completed', 'failed', 'retry']),
    timestamp: z.date(),
    message: z.string().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
});
export const JobRetryRequestSchema = z.object({
    jobIds: z.array(z.string()),
    resetAttempts: z.boolean().optional(),
});
export const HealthCheckSchema = z.object({
    id: z.string(),
    name: z.string(),
    type: z.enum(['http', 'tcp', 'docker', 'script', 'ping']),
    target: z.string(),
    status: z.enum(['healthy', 'unhealthy', 'unknown', 'disabled']),
    lastCheck: z.date(),
    responseTime: z.number().optional(),
    errorMessage: z.string().optional(),
    consecutiveFailures: z.number(),
    uptime: z.number(),
    configuration: z.record(z.string(), z.any()).optional(),
});
export const ServiceHealthSchema = z.object({
    serviceId: z.string(),
    serviceName: z.string(),
    stackId: z.string(),
    stackName: z.string(),
    status: z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']),
    replicas: z.object({
        desired: z.number(),
        running: z.number(),
        healthy: z.number(),
    }),
    healthChecks: z.array(HealthCheckSchema),
    lastUpdated: z.date(),
    uptime: z.number(),
    errorCount: z.number(),
    averageResponseTime: z.number().optional(),
});
export const SystemHealthOverviewSchema = z.object({
    overallStatus: z.enum(['healthy', 'degraded', 'unhealthy', 'critical']),
    totalServices: z.number(),
    healthyServices: z.number(),
    degradedServices: z.number(),
    unhealthyServices: z.number(),
    totalHealthChecks: z.number(),
    passingHealthChecks: z.number(),
    failingHealthChecks: z.number(),
    systemUptime: z.number(),
    alertCount: z.object({
        critical: z.number(),
        warning: z.number(),
        info: z.number(),
    }),
    resourceHealth: z.object({
        cpu: z.enum(['healthy', 'warning', 'critical']),
        memory: z.enum(['healthy', 'warning', 'critical']),
        disk: z.enum(['healthy', 'warning', 'critical']),
        network: z.enum(['healthy', 'warning', 'critical']),
    }),
    lastUpdated: z.date(),
});
export const HealthHistoryEntrySchema = z.object({
    id: z.string(),
    timestamp: z.date(),
    serviceId: z.string(),
    serviceName: z.string(),
    healthCheckId: z.string(),
    healthCheckName: z.string(),
    previousStatus: z.enum(['healthy', 'unhealthy', 'unknown', 'disabled']),
    newStatus: z.enum(['healthy', 'unhealthy', 'unknown', 'disabled']),
    duration: z.number(),
    responseTime: z.number().optional(),
    errorMessage: z.string().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
});
export const SystemMetricsSchema = z.object({
    timestamp: z.date(),
    cpu: z.object({
        usage: z.number(),
        load1m: z.number(),
        load5m: z.number(),
        load15m: z.number(),
    }),
    memory: z.object({
        used: z.number(),
        total: z.number(),
        usage: z.number(),
        available: z.number(),
    }),
    disk: z.object({
        used: z.number(),
        total: z.number(),
        usage: z.number(),
        available: z.number(),
    }),
    network: z.object({
        bytesIn: z.number(),
        bytesOut: z.number(),
        packetsIn: z.number(),
        packetsOut: z.number(),
    }),
    services: z.object({
        total: z.number(),
        healthy: z.number(),
        degraded: z.number(),
        unhealthy: z.number(),
    }),
});
// Standard response schemas
export const SuccessResponseSchema = z.object({
    success: z.literal(true),
    message: z.string().optional(),
});
export const SuccessWithDataResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) => z.object({
    success: z.literal(true),
    data: dataSchema,
    message: z.string().optional(),
});
// Export types
export type ResourceMetric = z.infer<typeof ResourceMetricSchema>;
export type ReplicaMetric = z.infer<typeof ReplicaMetricSchema>;
export type ResourceUsage = z.infer<typeof ResourceUsageSchema>;
export type ResourceQuota = z.infer<typeof ResourceQuotaSchema>;
export type SwarmStackConfig = z.infer<typeof SwarmStackConfigSchema>;
export type CreateStackRequest = z.infer<typeof CreateStackRequestSchema>;
export type UpdateStackRequest = z.infer<typeof UpdateStackRequestSchema>;
export type ScaleServicesRequest = z.infer<typeof ScaleServicesRequestSchema>;
export type SetQuotasRequest = z.infer<typeof SetQuotasRequestSchema>;
export type DomainMapping = z.infer<typeof DomainMappingSchema>;
export type TraefikConfig = z.infer<typeof TraefikConfigSchema>;
export type ResourceCapacityCheck = z.infer<typeof ResourceCapacityCheckSchema>;
export type ResourceAllocation = z.infer<typeof ResourceAllocationSchema>;
export type SystemResourceSummary = z.infer<typeof SystemResourceSummarySchema>;
export type ResourceAlert = z.infer<typeof ResourceAlertSchema>;
export type CertificateStatus = z.infer<typeof CertificateStatusSchema>;
export type StackStatus = z.infer<typeof StackStatusSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type JobQueueStats = z.infer<typeof JobQueueStatsSchema>;
export type JobHistoryEntry = z.infer<typeof JobHistoryEntrySchema>;
export type JobRetryRequest = z.infer<typeof JobRetryRequestSchema>;
export type HealthCheck = z.infer<typeof HealthCheckSchema>;
export type ServiceHealth = z.infer<typeof ServiceHealthSchema>;
export type SystemHealthOverview = z.infer<typeof SystemHealthOverviewSchema>;
export type HealthHistoryEntry = z.infer<typeof HealthHistoryEntrySchema>;
export type SystemMetrics = z.infer<typeof SystemMetricsSchema>;
