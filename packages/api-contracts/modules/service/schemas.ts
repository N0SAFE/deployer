import { z } from 'zod';
import {
  resourceLimitsSchema as sharedResourceLimitsSchema,
  healthCheckConfigSchema as sharedHealthCheckConfigSchema,
  environmentVariableSchema,
  buildConfigSchema,
  serviceTypeSchema,
  deploymentStatusSchema
} from '../../common/deployment-config';
// Traefik configuration schemas
export const traefikMiddlewareSchema = z.object({
    type: z.enum(['compress', 'headers', 'ratelimit', 'auth', 'cors', 'redirect']),
    config: z.record(z.string(), z.any()),
});
export const traefikConfigSchema = z.object({
    domain: z.string().optional(),
    subdomain: z.string().optional(),
    customDomain: z.string().optional(),
    pathPrefix: z.string().optional(),
    stripPrefix: z.boolean().optional(),
    middlewares: z.array(traefikMiddlewareSchema).optional(),
    entrypoints: z.array(z.string()).optional(),
    tls: z.boolean().optional(),
    tlsCertResolver: z.string().optional(),
    customHeaders: z.record(z.string(), z.string()).optional(),
    redirectScheme: z.enum(['http', 'https']).optional(),
    redirectPermanent: z.boolean().optional(),
    basicAuth: z.object({
        users: z.array(z.string()),
        realm: z.string().optional(),
    }).optional(),
    rateLimiting: z.object({
        average: z.number().positive(),
        burst: z.number().positive(),
    }).optional(),
    loadBalancer: z.object({
        method: z.enum(['roundrobin', 'wrr']).optional(),
        sticky: z.boolean().optional(),
    }).optional(),
});
// Health check configuration schemas
export const healthCheckTypeEnum = z.enum([
    'http', // HTTP/HTTPS endpoint check
    'tcp', // TCP port check
    'docker', // Docker container health check
    'command', // Custom command execution
    'disabled' // Disable health checks
]);
export const httpHealthCheckSchema = z.object({
    method: z.enum(['GET', 'POST', 'PUT', 'HEAD']).default('GET'),
    path: z.string().default('/health'),
    expectedStatus: z.number().int().min(200).max(599).default(200),
    expectedBody: z.string().optional(), // Expected substring in response body
    headers: z.record(z.string(), z.string()).optional(),
    timeout: z.number().int().positive().default(30), // seconds
    followRedirects: z.boolean().default(true),
});
export const tcpHealthCheckSchema = z.object({
    port: z.number().int().min(1).max(65535),
    timeout: z.number().int().positive().default(10), // seconds
});
export const dockerHealthCheckSchema = z.object({
    containerName: z.string().optional(), // If not provided, will use service name
    checkRunning: z.boolean().default(true), // Check if container is running
    checkHealthy: z.boolean().default(true), // Check Docker health status
    timeout: z.number().int().positive().default(15), // seconds
});
export const commandHealthCheckSchema = z.object({
    command: z.string(), // Shell command to execute
    expectedExitCode: z.number().int().default(0),
    timeout: z.number().int().positive().default(30), // seconds
    workingDirectory: z.string().optional(),
});
export const healthCheckConfigSchema = z.object({
    type: healthCheckTypeEnum,
    enabled: z.boolean().default(true),
    interval: z.number().int().min(10).max(3600).default(60), // seconds, min 10s, max 1h
    timeout: z.number().int().min(1).max(300).default(30), // seconds, max 5min
    retries: z.number().int().min(1).max(10).default(3), // number of retries before marking as unhealthy
    startPeriod: z.number().int().min(0).max(3600).default(60), // grace period after service start
    // Type-specific configurations
    http: httpHealthCheckSchema.optional(),
    tcp: tcpHealthCheckSchema.optional(),
    docker: dockerHealthCheckSchema.optional(),
    command: commandHealthCheckSchema.optional(),
    // Notification settings
    alertOnFailure: z.boolean().default(true),
    alertWebhookUrl: z.string().url().optional(),
    alertEmail: z.string().email().optional(),
});
// Health check result schema
export const healthCheckResultSchema = z.object({
    id: z.string().uuid(),
    serviceId: z.string().uuid(),
    status: z.enum(['healthy', 'unhealthy', 'unknown', 'starting']),
    message: z.string(),
    details: z.record(z.string(), z.any()).optional(), // Additional details about the check
    responseTime: z.number().optional(), // milliseconds
    checkedAt: z.date(),
    createdAt: z.date(),
});
// Use shared resource limits schema from deployment-config
export const resourceLimitsSchema = sharedResourceLimitsSchema;
// Service provider and builder enums
export const serviceProviderEnum = z.enum([
    'github',
    'gitlab',
    'bitbucket',
    'docker_registry',
    'gitea',
    's3_bucket',
    'manual'
]);
export const serviceBuilderEnum = z.enum([
    'nixpack',
    'railpack',
    'dockerfile',
    'buildpack',
    'static',
    'docker_compose'
]);
// Configuration schemas
export const providerConfigSchema = z.object({
    // GitHub/GitLab/Bitbucket/Gitea
    repositoryUrl: z.string().optional(),
    branch: z.string().optional(),
    accessToken: z.string().optional(),
    deployKey: z.string().optional(),
    // Docker Registry
    registryUrl: z.string().optional(),
    imageName: z.string().optional(),
    tag: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    // S3 Bucket
    bucketName: z.string().optional(),
    region: z.string().optional(),
    accessKeyId: z.string().optional(),
    secretAccessKey: z.string().optional(),
    objectKey: z.string().optional(),
    // Manual
    instructions: z.string().optional(),
    deploymentScript: z.string().optional(),
});
export const builderConfigSchema = z.object({
    // Dockerfile
    dockerfilePath: z.string().optional(),
    buildContext: z.string().optional(),
    buildArgs: z.record(z.string(), z.string()).optional(),
    // Nixpack/Railpack/Buildpack
    buildCommand: z.string().optional(),
    startCommand: z.string().optional(),
    installCommand: z.string().optional(),
    // Static
    outputDirectory: z.string().optional(),
    // Docker Compose  
    composeFilePath: z.string().optional(),
    serviceName: z.string().optional(),
});
// Main service schemas
export const createServiceSchema = z.object({
    projectId: z.string().uuid(),
    name: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Service name must be lowercase alphanumeric with hyphens only'),
    type: z.string().min(1), // e.g., "web", "worker", "database"
    provider: serviceProviderEnum,
    builder: serviceBuilderEnum,
    providerConfig: providerConfigSchema.optional(),
    builderConfig: builderConfigSchema.optional(),
    port: z.number().int().positive().optional(),
    healthCheckPath: z.string().default("/health"), // Deprecated: use healthCheckConfig instead
    environmentVariables: z.record(z.string(), z.string()).optional(),
    resourceLimits: resourceLimitsSchema.optional(),
    traefikConfig: traefikConfigSchema.optional(),
    healthCheckConfig: healthCheckConfigSchema.optional(),
});
export const updateServiceSchema = createServiceSchema.partial().omit({ projectId: true });
export const serviceSchema = z.object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    name: z.string(),
    type: z.string(),
    provider: serviceProviderEnum,
    builder: serviceBuilderEnum,
    providerConfig: providerConfigSchema.nullable(),
    builderConfig: builderConfigSchema.nullable(),
    port: z.number().nullable(),
    healthCheckPath: z.string(), // Deprecated: use healthCheckConfig instead
    environmentVariables: z.record(z.string(), z.string()).nullable(),
    resourceLimits: resourceLimitsSchema.nullable(),
    traefikConfig: traefikConfigSchema.nullable(),
    healthCheckConfig: healthCheckConfigSchema.nullable(),
    isActive: z.boolean(),
    createdAt: z.date(),
    updatedAt: z.date(),
});
export const serviceWithStatsSchema = serviceSchema.extend({
    _count: z.object({
        deployments: z.number(),
        dependencies: z.number(),
    }),
    latestDeployment: z.object({
        id: z.string(),
        status: z.enum(['pending', 'queued', 'building', 'deploying', 'success', 'failed', 'cancelled']),
        environment: z.enum(['production', 'staging', 'preview', 'development']),
        createdAt: z.date(),
        domainUrl: z.string().nullable(),
    }).nullable(),
    project: z.object({
        id: z.string(),
        name: z.string(),
        baseDomain: z.string().nullable(),
    }),
});
// Configuration schemas
export const serviceGeneralConfigSchema = z.object({
    name: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Service name must be lowercase alphanumeric with hyphens only'),
    type: z.string().min(1),
    isActive: z.boolean(),
    port: z.number().int().positive().optional(),
    healthCheckPath: z.string().default("/health"),
    customDomain: z.string().optional(),
    description: z.string().optional(),
});
export const serviceEnvironmentConfigSchema = z.object({
    environmentVariables: z.record(z.string(), z.string()).optional(),
    productionEnvironmentVariables: z.record(z.string(), z.string()).optional(),
    stagingEnvironmentVariables: z.record(z.string(), z.string()).optional(),
    developmentEnvironmentVariables: z.record(z.string(), z.string()).optional(),
    secretVariables: z.record(z.string(), z.string()).optional(),
});
export const serviceBuildConfigSchema = z.object({
    provider: serviceProviderEnum,
    builder: serviceBuilderEnum,
    providerConfig: providerConfigSchema,
    builderConfig: builderConfigSchema,
    buildCommand: z.string().optional(),
    startCommand: z.string().optional(),
    installCommand: z.string().optional(),
    dockerfilePath: z.string().optional(),
    buildContext: z.string().default('.'),
    buildArgs: z.record(z.string(), z.string()).optional(),
});
export const serviceResourceConfigSchema = z.object({
    resourceLimits: resourceLimitsSchema,
    autoScaling: z.object({
        enabled: z.boolean().default(false),
        minInstances: z.number().min(1).default(1),
        maxInstances: z.number().min(1).default(5),
        cpuThreshold: z.number().min(10).max(90).default(70),
        memoryThreshold: z.number().min(10).max(90).default(80),
    }).optional(),
    healthCheck: z.object({
        enabled: z.boolean().default(true),
        path: z.string().default('/health'),
        interval: z.number().min(5).max(300).default(30),
        timeout: z.number().min(1).max(60).default(5),
        retries: z.number().min(1).max(10).default(3),
    }),
});
export const serviceDeploymentConfigSchema = z.object({
    autoDeployBranch: z.string().default('main'),
    autoDeployEnabled: z.boolean().default(true),
    deploymentStrategy: z.enum(['rolling', 'blue_green', 'recreate']).default('rolling'),
    preDeployHooks: z.array(z.string()).optional(),
    postDeployHooks: z.array(z.string()).optional(),
    rollbackEnabled: z.boolean().default(true),
    deploymentTimeout: z.number().min(60).max(3600).default(600),
    zeroDowntimeEnabled: z.boolean().default(false),
    // Environment-specific deployment settings
    environmentConfigs: z.record(z.string(), z.object({
        autoDeployEnabled: z.boolean().default(true),
        branch: z.string().optional(),
        deploymentStrategy: z.enum(['rolling', 'blue_green', 'recreate']).optional(),
        resourceOverrides: resourceLimitsSchema.optional(),
        environmentVariables: z.record(z.string(), z.string()).optional(),
        replicas: z.number().min(1).max(20).default(1),
        requireApproval: z.boolean().default(false),
    })).optional(),
});
export const serviceNetworkConfigSchema = z.object({
    internalPort: z.number().int().positive().optional(),
    externalPort: z.number().int().positive().optional(),
    protocols: z.array(z.enum(['http', 'https', 'tcp', 'udp'])).default(['http']),
    loadBalancerConfig: z.object({
        enabled: z.boolean().default(false),
        algorithm: z.enum(['round_robin', 'least_connections', 'ip_hash']).default('round_robin'),
        healthCheckEnabled: z.boolean().default(true),
        stickySession: z.boolean().default(false),
    }).optional(),
    ingressConfig: z.object({
        enabled: z.boolean().default(false),
        className: z.string().optional(),
        annotations: z.record(z.string(), z.string()).optional(),
        tls: z.boolean().default(false),
    }).optional(),
});
// Dependency schemas
export const serviceDependencySchema = z.object({
    id: z.string().uuid(),
    serviceId: z.string().uuid(),
    dependsOnServiceId: z.string().uuid(),
    isRequired: z.boolean(),
    createdAt: z.date(),
});
export const createServiceDependencySchema = z.object({
    dependsOnServiceId: z.string().uuid(),
    isRequired: z.boolean().default(true),
});
// Deployment summary schema
export const deploymentSummarySchema = z.object({
    id: z.string().uuid(),
    status: z.enum(['pending', 'queued', 'building', 'deploying', 'success', 'failed', 'cancelled']),
    environment: z.enum(['production', 'staging', 'preview', 'development']),
    triggeredBy: z.string().nullable(),
    domainUrl: z.string().nullable(),
    healthCheckUrl: z.string().nullable(),
    containerName: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
});
// WebSocket event schemas
export const serviceLogEventSchema = z.object({
    serviceId: z.string(),
    timestamp: z.string().datetime(),
    level: z.enum(['info', 'warn', 'error', 'debug']),
    message: z.string(),
    source: z.enum(['container', 'system', 'proxy', 'health_check']).optional(),
    containerId: z.string().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
});
export const serviceMetricsEventSchema = z.object({
    serviceId: z.string(),
    timestamp: z.string().datetime(),
    metrics: z.object({
        cpu: z.number(),
        memory: z.object({
            used: z.number(),
            total: z.number(),
        }),
        network: z.object({
            bytesIn: z.number(),
            bytesOut: z.number(),
        }),
        requests: z.object({
            count: z.number(),
            responseTime: z.number(),
        }).optional(),
    }),
});
export const serviceHealthEventSchema = z.object({
    serviceId: z.string(),
    timestamp: z.string().datetime(),
    status: z.enum(['healthy', 'unhealthy', 'unknown', 'starting']),
    checks: z.array(z.object({
        name: z.string(),
        status: z.enum(['pass', 'fail', 'warn']),
        message: z.string().optional(),
        timestamp: z.date(),
    })),
    containerStatus: z.enum(['running', 'stopped', 'restarting', 'paused', 'exited']).optional(),
});
// Dependency graph schemas
export const dependencyGraphNodeSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    type: z.string(),
    status: z.enum(['healthy', 'unhealthy', 'unknown', 'starting', 'deploying', 'failed']),
    isActive: z.boolean(),
    port: z.number().nullable(),
    latestDeployment: z.object({
        id: z.string(),
        status: z.enum(['pending', 'queued', 'building', 'deploying', 'success', 'failed', 'cancelled']),
        environment: z.enum(['production', 'staging', 'preview', 'development']),
        createdAt: z.date(),
        domainUrl: z.string().nullable(),
    }).nullable(),
});

export const dependencyGraphEdgeSchema = z.object({
    id: z.string().uuid(),
    sourceId: z.string().uuid(),
    targetId: z.string().uuid(),
    isRequired: z.boolean(),
    createdAt: z.date(),
});

export const getProjectDependencyGraphInput = z.object({
    projectId: z.string().uuid(),
});

export const getProjectDependencyGraphOutput = z.object({
    nodes: z.array(dependencyGraphNodeSchema),
    edges: z.array(dependencyGraphEdgeSchema),
    project: z.object({
        id: z.string().uuid(),
        name: z.string(),
        baseDomain: z.string().nullable(),
    }),
});

// Input/Output schemas for additional service endpoints
// Get service logs
export const getServiceLogsInput = z.object({
    id: z.string().uuid(),
    limit: z.coerce.number().int().min(1).max(1000).default(100),
    offset: z.coerce.number().int().min(0).default(0),
    level: z.enum(['info', 'warn', 'error', 'debug']).optional(),
    since: z.date().optional(),
    until: z.date().optional(),
});
export const getServiceLogsOutput = z.object({
    logs: z.array(z.object({
        id: z.string(),
        timestamp: z.date(),
        level: z.enum(['info', 'warn', 'error', 'debug']),
        message: z.string(),
        source: z.enum(['container', 'system', 'proxy', 'health_check']),
        containerId: z.string(),
        metadata: z.record(z.string(), z.any()).optional(),
    })),
    total: z.number(),
    hasMore: z.boolean(),
});
// Get service metrics
export const getServiceMetricsInput = z.object({
    id: z.string().uuid(),
    period: z.enum(['5m', '1h', '24h', '7d']).default('1h'),
    granularity: z.enum(['1m', '5m', '1h']).default('5m'),
});
export const getServiceMetricsOutput = z.object({
    cpu: z.array(z.object({
        timestamp: z.date(),
        value: z.number(), // CPU percentage 0-100
    })),
    memory: z.array(z.object({
        timestamp: z.date(),
        used: z.number(), // bytes
        total: z.number(), // bytes
    })),
    network: z.array(z.object({
        timestamp: z.date(),
        bytesIn: z.number(),
        bytesOut: z.number(),
    })),
    requests: z.array(z.object({
        timestamp: z.date(),
        count: z.number(),
        responseTime: z.number(), // milliseconds
    })),
});
// Get service health
export const getServiceHealthInput = z.object({
    id: z.string().uuid(),
});
export const getServiceHealthOutput = z.object({
    status: z.enum(['healthy', 'unhealthy', 'unknown', 'starting']),
    lastCheck: z.date(),
    checks: z.array(z.object({
        name: z.string(),
        status: z.enum(['pass', 'fail', 'warn']),
        message: z.string(),
        timestamp: z.date(),
    })),
    uptime: z.number(), // seconds
    containerStatus: z.enum(['running', 'stopped', 'restarting', 'paused', 'exited']),
});
// Add service log
export const addServiceLogInput = z.object({
    serviceId: z.string().uuid(),
    deploymentId: z.string().uuid(),
    level: z.enum(['info', 'warn', 'error', 'debug']),
    message: z.string(),
    phase: z.string().optional(),
    step: z.string().optional(),
    stage: z.string().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
});
export const addServiceLogOutput = z.object({
    id: z.string(),
    timestamp: z.date(),
    level: z.enum(['info', 'warn', 'error', 'debug']),
    message: z.string(),
    service: z.string().optional(),
    phase: z.string().optional(),
    step: z.string().optional(),
    stage: z.string().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
});
