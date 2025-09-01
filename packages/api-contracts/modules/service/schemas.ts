import { z } from 'zod';

// Traefik configuration schemas
export const traefikMiddlewareSchema = z.object({
  type: z.enum(['compress', 'headers', 'ratelimit', 'auth', 'cors', 'redirect']),
  config: z.record(z.string(), z.any()),
});

export const traefikConfigSchema = z.object({
  enabled: z.boolean().default(true),
  domain: z.string().optional(),
  customDomains: z.array(z.string()).optional(),
  pathPrefix: z.string().optional(),
  middlewares: z.array(traefikMiddlewareSchema).optional(),
  sslEnabled: z.boolean().default(true),
  certResolver: z.string().default('letsencrypt'),
  customLabels: z.record(z.string(), z.string()).optional(),
  staticFileServing: z.object({
    enabled: z.boolean().default(false),
    compressionEnabled: z.boolean().default(true),
    cachingEnabled: z.boolean().default(true),
    indexFiles: z.array(z.string()).default(['index.html', 'index.htm']),
    errorPages: z.record(z.string(), z.string()).optional(),
  }).optional(),
});

// Resource schemas
export const resourceLimitsSchema = z.object({
  memory: z.string().optional(), // e.g., "512m"
  cpu: z.string().optional(), // e.g., "0.5"
  storage: z.string().optional(), // e.g., "1g" 
});

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
  healthCheckPath: z.string().default("/health"),
  environmentVariables: z.record(z.string(), z.string()).optional(),
  resourceLimits: resourceLimitsSchema.optional(),
  traefikConfig: traefikConfigSchema.optional(),
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
  healthCheckPath: z.string(),
  environmentVariables: z.record(z.string(), z.string()).nullable(),
  resourceLimits: resourceLimitsSchema.nullable(),
  traefikConfig: traefikConfigSchema.nullable(),
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
  checks: z.array(
    z.object({
      name: z.string(),
      status: z.enum(['pass', 'fail', 'warn']),
      message: z.string().optional(),
      timestamp: z.date(),
    })
  ),
  containerStatus: z.enum(['running', 'stopped', 'restarting', 'paused', 'exited']).optional(),
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