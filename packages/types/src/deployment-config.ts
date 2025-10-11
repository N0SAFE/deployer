/**
 * Deployment Configuration Types
 * 
 * TypeScript definitions for the deployment configuration rules.
 * These types enforce the patterns and constraints defined in DEPLOYMENT-CONFIGURATION-RULES.md
 */

// Core deployment provider types
export type DeploymentProvider = 
  | 'docker-compose-dev'
  | 'docker-compose-prod-combined'
  | 'docker-compose-prod-separated'
  | 'docker-swarm'
  | 'render'
  | 'vercel'
  | 'railway'
  | 'fly-io'
  | 'custom'

// Build strategy types
export type BuildStrategy = 
  | 'development'      // Hot reload, dev dependencies
  | 'build-time'       // Build during image creation
  | 'runtime'          // Build during container startup

// Environment types
export type Environment = 
  | 'development'
  | 'staging' 
  | 'production'
  | 'preview'

// Source types for deployments
export type SourceType = 
  | 'github'
  | 'gitlab'
  | 'git'
  | 'upload'
  | 'docker-image'
  | 'custom'

// Git provider types
export type GitProvider = 
  | 'github'
  | 'gitlab'
  | 'bitbucket'
  | 'git'

// Service types
export type ServiceType = 
  | 'web'
  | 'api'
  | 'worker'
  | 'database'
  | 'cache'
  | 'queue'
  | 'static'

// Deployment status types
export type DeploymentStatus = 
  | 'pending'
  | 'queued'
  | 'building'
  | 'deploying'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'rollback'

// Resource limit configuration
export interface ResourceLimits {
  memory?: string       // e.g., "512m", "1g", "2g"
  cpu?: string         // e.g., "0.5", "1", "2"
  storage?: string     // e.g., "1g", "10g", "100g"
  replicas?: number    // Number of container instances
}

// Health check configuration
export interface HealthCheckConfig {
  enabled: boolean
  path: string                    // e.g., "/health", "/api/health"
  intervalSeconds: number         // How often to check
  timeoutSeconds: number          // Request timeout
  startPeriodSeconds: number      // Grace period before checks start
  retries: number                 // Failures before marking unhealthy
}

// Source configuration based on source type
export interface SourceConfig {
  type: SourceType
  
  // Git-based sources
  repositoryUrl?: string
  branch?: string
  commitSha?: string
  pullRequestNumber?: number
  gitProvider?: GitProvider
  accessToken?: string
  
  // Upload sources
  fileName?: string
  fileSize?: number
  uploadPath?: string
  
  // Docker image sources
  imageName?: string
  imageTag?: string
  registryUrl?: string
  registryCredentials?: {
    username: string
    password: string
  }
  
  // Custom sources
  customData?: Record<string, unknown>
}

// Build configuration
export interface BuildConfig {
  dockerfilePath: string           // Path to Dockerfile
  buildContext: string            // Build context directory
  buildArgs?: Record<string, string>
  buildCommand?: string           // Custom build command
  startCommand?: string           // Custom start command
  workingDirectory?: string       // Working directory in container
}

// Environment variable configuration
export interface EnvironmentVariable {
  key: string
  value: string
  isSecret: boolean
  description?: string
}

// Environment configuration with inheritance
export interface EnvironmentConfig {
  global: Record<string, string>       // Project-wide variables
  service: Record<string, string>      // Service-specific variables
  deployment: Record<string, string>   // Deployment-specific variables
  preview?: Record<string, string>     // Preview environment variables
}

// Network configuration
export interface NetworkConfig {
  ports: number[]                     // Exposed ports
  subdomain?: string                  // Auto-generated or custom subdomain
  customDomain?: string               // Custom domain for this service
  internalOnly: boolean              // Whether service is internal only
  allowedOrigins?: string[]          // CORS origins for APIs
}

// Preview deployment configuration
export interface PreviewConfig {
  enabled: boolean
  baseDomain: string                 // Base domain for previews
  subdomain?: string                 // Custom subdomain pattern
  customDomain?: string              // Full custom domain
  shareEnvVars: boolean             // Share environment variables with main deployment
  autoDelete: boolean               // Auto-delete after branch merge
  retentionDays?: number            // How long to keep preview deployments
}

// Service dependency configuration
export interface ServiceDependency {
  serviceId: string
  dependsOn: string[]               // Services that must be deployed first
  deploymentOrder: number           // Explicit deployment order
  healthCheckDependency: boolean    // Wait for dependent services to be healthy
}

// Deployment configuration (main interface)
export interface DeploymentConfig {
  // Core identification
  deploymentId?: string
  serviceId: string
  projectId: string
  
  // Environment and provider
  environment: Environment
  provider: DeploymentProvider
  buildStrategy: BuildStrategy
  
  // Source and build
  sourceType: SourceType
  sourceConfig: SourceConfig
  buildConfig: BuildConfig
  
  // Resources and scaling
  resourceLimits: ResourceLimits
  healthCheck: HealthCheckConfig
  
  // Network and domains
  networkConfig: NetworkConfig
  
  // Environment variables
  environmentVariables: EnvironmentVariable[]
  
  // Preview configuration (optional)
  previewConfig?: PreviewConfig
  
  // Dependencies
  dependencies: ServiceDependency[]
  
  // Metadata
  createdAt?: Date
  updatedAt?: Date
  createdBy?: string
}

// Service configuration
export interface ServiceConfig {
  id: string
  projectId: string
  name: string
  type: ServiceType
  description?: string
  isEnabled: boolean
  
  // Default configuration for deployments
  defaultBuildConfig: BuildConfig
  defaultResourceLimits: ResourceLimits
  defaultHealthCheck: HealthCheckConfig
  defaultNetworkConfig: NetworkConfig
  
  // Service-specific environment variables
  environmentVariables: EnvironmentVariable[]
  
  // Dependencies
  dependencies: ServiceDependency[]
  
  // Metadata
  createdAt: Date
  updatedAt: Date
  createdBy: string
}

// Project configuration
export interface ProjectConfig {
  id: string
  name: string
  description?: string
  
  // Global project settings
  globalEnvironmentVariables: Record<string, string>
  defaultDomain: string
  previewBaseDomain: string
  
  // Default resource limits for all services
  defaultResourceLimits: ResourceLimits
  
  // Project-wide settings
  settings: {
    allowPreviewDeployments: boolean
    autoDeletePreviews: boolean
    defaultPreviewRetentionDays: number
    requireHealthChecks: boolean
  }
  
  // Metadata
  createdAt: Date
  updatedAt: Date
  ownerId: string
  collaborators: Array<{
    userId: string
    role: 'owner' | 'admin' | 'developer' | 'viewer'
  }>
}

// Validation rules for different providers
export interface ProviderValidationRule {
  provider: DeploymentProvider
  supportedBuildStrategies: BuildStrategy[]
  requiredEnvironmentVariables: string[]
  dockerfilePattern: RegExp
  healthCheckRequired: boolean
  supportedSourceTypes: SourceType[]
  maxResourceLimits: ResourceLimits
  supportsPreviewDeployments: boolean
  supportsCustomDomains: boolean
}

// Migration configuration
export interface MigrationConfig {
  fromProvider: DeploymentProvider
  toProvider: DeploymentProvider
  fromBuildStrategy: BuildStrategy
  toBuildStrategy: BuildStrategy
  
  migrationSteps: string[]
  warnings: string[]
  requiredChanges: {
    dockerfilePath?: string
    environmentVariables?: Record<string, string>
    buildArgs?: Record<string, string>
  }
}

// Deployment result
export interface DeploymentResult {
  deploymentId: string
  status: DeploymentStatus
  message: string
  
  // Container information
  containerId?: string
  imageId?: string
  
  // Network information
  url?: string
  internalUrl?: string
  ports?: number[]
  
  // Build information
  buildLogs?: string[]
  buildDuration?: number
  
  // Health check results
  healthStatus?: 'healthy' | 'unhealthy' | 'starting'
  lastHealthCheck?: Date
  
  // Timestamps
  startedAt: Date
  completedAt?: Date
  
  // Metadata
  deployedBy: string
  deploymentSize?: number
  resourceUsage?: {
    cpu: string
    memory: string
    storage: string
  }
}

// Configuration factory functions
export interface DeploymentConfigFactory {
  createDevConfig(serviceId: string, sourceConfig: SourceConfig): DeploymentConfig
  createProdConfig(serviceId: string, provider: DeploymentProvider, sourceConfig: SourceConfig): DeploymentConfig
  createPreviewConfig(serviceId: string, sourceConfig: SourceConfig, previewConfig: PreviewConfig): DeploymentConfig
  
  validateConfig(config: DeploymentConfig): { isValid: boolean; errors: string[] }
  migrateConfig(config: DeploymentConfig, targetProvider: DeploymentProvider): DeploymentConfig
}

// Provider-specific configurations
export interface RenderConfig extends DeploymentConfig {
  provider: 'render'
  renderSpecific: {
    plan: 'free' | 'starter' | 'standard' | 'pro'
    region: string
    autoScale: boolean
    branches?: string[]  // Auto-deploy branches
  }
}

export interface VercelConfig extends DeploymentConfig {
  provider: 'vercel'
  vercelSpecific: {
    framework: 'nextjs' | 'react' | 'vue' | 'svelte'
    nodeVersion: string
    buildCommand?: string
    outputDirectory?: string
    installCommand?: string
  }
}

export interface DockerComposeConfig extends DeploymentConfig {
  provider: 'docker-compose-prod-combined' | 'docker-compose-prod-separated' | 'docker-compose-dev'
  composeSpecific: {
    composeFile: string
    serviceName: string
    networks: string[]
    volumes: Array<{
      source: string
      target: string
      type: 'bind' | 'volume'
    }>
  }
}

// Export commonly used type unions
export type PlatformProvider = 'render' | 'vercel' | 'railway' | 'fly-io'
export type SelfHostedProvider = 'docker-compose-dev' | 'docker-compose-prod-combined' | 'docker-compose-prod-separated' | 'docker-swarm'
export type AllProviders = PlatformProvider | SelfHostedProvider | 'custom'

export type ProductionBuildStrategy = 'build-time' | 'runtime'
export type AllBuildStrategies = ProductionBuildStrategy | 'development'

// Configuration constants
export const DEPLOYMENT_CONSTANTS = {
  DEFAULT_HEALTH_CHECK_PATH: '/health',
  DEFAULT_HEALTH_CHECK_INTERVAL: 30,
  DEFAULT_HEALTH_CHECK_TIMEOUT: 10,
  DEFAULT_HEALTH_CHECK_START_PERIOD: 60,
  DEFAULT_HEALTH_CHECK_RETRIES: 3,
  
  DEFAULT_RESOURCE_LIMITS: {
    memory: '512m',
    cpu: '0.5',
    storage: '1g'
  } as ResourceLimits,
  
  DOCKERFILE_PATTERNS: {
    development: /Dockerfile\..*\.dev$/,
    'build-time': /Dockerfile\..*\.build-time\.prod$/,
    runtime: /Dockerfile\..*\.runtime\.prod$/
  },
  
  SUPPORTED_MEMORY_UNITS: ['m', 'M', 'g', 'G', 't', 'T'],
  SUPPORTED_STORAGE_UNITS: ['m', 'M', 'g', 'G', 't', 'T'],
  
  MAX_DEPLOYMENT_NAME_LENGTH: 63,
  MAX_SERVICE_NAME_LENGTH: 50,
  MAX_PROJECT_NAME_LENGTH: 100,
  
  PREVIEW_RETENTION_DAYS: {
    default: 7,
    max: 30
  }
} as const