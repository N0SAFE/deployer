# Deployment Configuration Rules

> Comprehensive guide for configuring deployments in the Universal Deployment Platform. This document defines all supported provider types, build strategies, and configuration patterns for consistent deployment management.

## Overview

This deployment platform supports multiple deployment providers and build strategies to accommodate different development workflows, infrastructure requirements, and scaling needs. This document establishes the rules and patterns for configuring deployments across all supported scenarios.

## Deployment Provider Types

### 1. Local Development Providers

#### Docker Compose (Development)
**Use Case**: Local development and testing
**Configuration Pattern**: `docker-compose.yml`

```yaml
# Example: Full development stack
services:
  web:
    build:
      context: .
      dockerfile: docker/Dockerfile.web.dev
    volumes:
      - ./apps/web:/app/apps/web
    environment:
      - NODE_ENV=development
      - NEXT_PUBLIC_API_URL=http://api:3001
  api:
    build:
      context: .
      dockerfile: docker/Dockerfile.api.dev
    volumes:
      - ./apps/api:/app/apps/api
```

**Provider Rules**:
- ✅ Hot reloading enabled
- ✅ Source code mounted as volumes
- ✅ Development dependencies included
- ✅ Debug ports exposed
- ❌ Not suitable for production

#### Docker Compose (Partial Development)
**Use Case**: Independent service development

```yaml
# API-only development
services:
  api:
    build:
      dockerfile: docker/Dockerfile.api.dev
    ports:
      - "3001:3001"
  database:
    image: postgres:16
    ports:
      - "5432:5432"
```

**Provider Rules**:
- ✅ Service isolation
- ✅ External database access
- ✅ Independent scaling
- ❌ Requires external dependencies

### 2. Production Self-Hosted Providers

#### Docker Compose (Production - Combined)
**Use Case**: Single-server production deployment
**Configuration Pattern**: `docker-compose.prod.yml`

```yaml
services:
  web:
    build:
      dockerfile: docker/Dockerfile.web.build-time.prod
    environment:
      - NODE_ENV=production
  api:
    build:
      dockerfile: docker/Dockerfile.api.prod
    environment:
      - NODE_ENV=production
```

**Provider Rules**:
- ✅ Fast deployment (build-time compilation)
- ✅ Resource efficient
- ✅ SSL termination via Traefik
- ❌ Limited horizontal scaling

#### Docker Compose (Production - Separated)
**Use Case**: Multi-server production deployment

```bash
# API Server (docker-compose.api.prod.yml)
services:
  api:
    build:
      dockerfile: docker/Dockerfile.api.prod
  database:
    image: postgres:16

# Web Server (docker-compose.web.prod.yml)  
services:
  web:
    build:
      dockerfile: docker/Dockerfile.web.build-time.prod
    environment:
      - NEXT_PUBLIC_API_URL=https://api.yourdomain.com
```

**Provider Rules**:
- ✅ Independent scaling
- ✅ Better security isolation
- ✅ Load balancer friendly
- ❌ More complex networking

#### Docker Swarm (Future)
**Use Case**: Multi-node production with orchestration

```yaml
# docker-compose.swarm.yml
version: '3.8'
services:
  web:
    image: your-registry/web:latest
    deploy:
      replicas: 3
      update_config:
        parallelism: 1
        delay: 10s
```

**Provider Rules**:
- ✅ Built-in load balancing
- ✅ Service discovery
- ✅ Rolling updates
- ❌ More complex setup

### 3. Platform-as-a-Service Providers

#### Render
**Use Case**: Managed cloud deployment
**Configuration Pattern**: `render.yaml`

```yaml
services:
  - type: web
    name: nextjs-web
    runtime: docker
    dockerfilePath: ./docker/Dockerfile.web.build-time.prod
    plan: free
    healthCheckPath: /
    envVars:
      - key: NEXT_PUBLIC_API_URL
        fromService:
          type: web
          name: nestjs-api
          envVarKey: RENDER_EXTERNAL_URL
```

**Provider Rules**:
- ✅ Automatic SSL certificates
- ✅ Global CDN
- ✅ Automatic service discovery
- ✅ Zero-downtime deployments
- ❌ Platform vendor lock-in
- ❌ Limited control over infrastructure

#### Vercel (Web Only)
**Use Case**: Frontend-only deployment

```json
{
  "version": 2,
  "builds": [
    {
      "src": "apps/web/package.json",
      "use": "@vercel/next"
    }
  ],
  "env": {
    "NEXT_PUBLIC_API_URL": "https://api.yourdomain.com"
  }
}
```

**Provider Rules**:
- ✅ Edge deployment
- ✅ Automatic scaling
- ✅ Built-in CDN
- ❌ API must be deployed separately
- ❌ Serverless limitations

## Build Strategy Types

### 1. Build-Time Compilation

**Files**: `Dockerfile.*.build-time.prod`
**Strategy**: Application built during Docker image creation

```dockerfile
# Dockerfile.web.build-time.prod
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
CMD ["bun", "run", "start"]
```

**Build Strategy Rules**:
- ✅ **Fast container startup** (5-10 seconds)
- ✅ **Platform compatibility** (works with Render, Railway, etc.)
- ✅ **Consistent builds** (environment captured in image)
- ✅ **Smaller runtime footprint** (no dev dependencies)
- ❌ **Longer image build time** (5-10 minutes)
- ❌ **Code changes require image rebuild**
- ❌ **Larger image size** (~500MB)

**Use Cases**:
- Production deployments
- Platform-as-a-Service providers
- CI/CD pipelines
- When fast startup is critical

### 2. Runtime Compilation

**Files**: `Dockerfile.*.runtime.prod`
**Strategy**: Application built when container starts

```dockerfile
# Dockerfile.web.runtime.prod
FROM node:20-alpine
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
CMD ["sh", "-c", "bun run build && bun run start"]
```

**Build Strategy Rules**:
- ✅ **Fresh builds** (always uses latest source)
- ✅ **Faster image creation** (1-2 minutes)
- ✅ **Development friendly** (no image rebuild needed)
- ✅ **Smaller image layers** (build artifacts not cached)
- ❌ **Slow startup time** (2-5 minutes)
- ❌ **Platform incompatibility** (may timeout on port scans)
- ❌ **Resource intensive** (needs build resources at runtime)

**Use Cases**:
- Development environments
- Self-hosted deployments with flexible startup times
- Docker Compose local development
- When build freshness is more important than startup speed

### 3. Development Hot Reload

**Files**: `Dockerfile.*.dev`
**Strategy**: Development server with file watching

```dockerfile
# Dockerfile.web.dev
FROM node:20-alpine
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install
COPY . .
VOLUME ["/app/apps/web"]
CMD ["bun", "run", "dev"]
```

**Build Strategy Rules**:
- ✅ **Instant code updates** (hot reload)
- ✅ **Full development features** (debugging, sourcemaps)
- ✅ **Fast iteration** (no rebuild required)
- ❌ **Development only** (not for production)
- ❌ **Resource intensive** (file watchers, debug overhead)

## Configuration Pattern Rules

### 1. Environment-Based Selection

**Rule**: Configuration varies by environment and provider

```typescript
interface DeploymentConfig {
  environment: 'development' | 'staging' | 'production'
  provider: 'docker-compose' | 'docker-swarm' | 'render' | 'vercel'
  buildStrategy: 'build-time' | 'runtime' | 'development'
  dockerfilePath: string
  environmentVariables: Record<string, string>
}

// Configuration selection logic
function selectDeploymentConfig(
  environment: string,
  provider: string
): DeploymentConfig {
  if (environment === 'development') {
    return {
      environment: 'development',
      provider: 'docker-compose',
      buildStrategy: 'development',
      dockerfilePath: './docker/Dockerfile.web.dev'
    }
  }
  
  if (provider === 'render') {
    return {
      environment: 'production',
      provider: 'render',
      buildStrategy: 'build-time',
      dockerfilePath: './docker/Dockerfile.web.build-time.prod'
    }
  }
  
  // Default production
  return {
    environment: 'production',
    provider: 'docker-compose',
    buildStrategy: 'build-time',
    dockerfilePath: './docker/Dockerfile.web.build-time.prod'
  }
}
```

### 2. Source Type Configuration

**Rule**: Source handling varies by deployment source

```typescript
interface SourceConfig {
  type: 'github' | 'gitlab' | 'git' | 'upload' | 'custom'
  
  // Git-based sources
  repositoryUrl?: string
  branch?: string
  commitSha?: string
  pullRequestNumber?: number
  
  // Upload sources
  fileName?: string
  fileSize?: number
  
  // Custom sources
  customData?: Record<string, any>
}

// Source validation rules
function validateSourceConfig(config: SourceConfig): boolean {
  switch (config.type) {
    case 'github':
    case 'gitlab':
    case 'git':
      return !!config.repositoryUrl && !!config.branch
    
    case 'upload':
      return !!config.fileName && !!config.fileSize
      
    case 'custom':
      return !!config.customData
      
    default:
      return false
  }
}
```

### 3. Service Dependency Rules

**Rule**: Services must be deployed in dependency order

```typescript
interface ServiceDependency {
  serviceId: string
  dependsOn: string[]
  deploymentOrder: number
}

// Deployment ordering
function calculateDeploymentOrder(
  services: Service[],
  dependencies: ServiceDependency[]
): Service[] {
  // Topological sort implementation
  const visited = new Set<string>()
  const result: Service[] = []
  
  function visit(serviceId: string) {
    if (visited.has(serviceId)) return
    
    const deps = dependencies.find(d => d.serviceId === serviceId)?.dependsOn || []
    deps.forEach(visit)
    
    visited.add(serviceId)
    const service = services.find(s => s.id === serviceId)
    if (service) result.push(service)
  }
  
  services.forEach(service => visit(service.id))
  return result
}
```

### 4. Environment Variable Inheritance

**Rule**: Environment variables follow inheritance hierarchy

```typescript
interface EnvironmentConfig {
  global: Record<string, string>      // Project-wide
  service: Record<string, string>     // Service-specific
  deployment: Record<string, string>  // Deployment-specific
  preview?: Record<string, string>    // Preview-specific
}

// Variable resolution order (highest priority first)
function resolveEnvironmentVariables(config: EnvironmentConfig): Record<string, string> {
  return {
    ...config.global,      // 1. Global (lowest priority)
    ...config.service,     // 2. Service-specific
    ...config.deployment,  // 3. Deployment-specific
    ...config.preview,     // 4. Preview-specific (highest priority)
  }
}
```

## Validation Rules

### 1. Provider-Specific Validation

```typescript
interface ValidationRule {
  provider: string
  buildStrategy: string
  requiredEnvVars: string[]
  dockerfilePattern: RegExp
  healthCheckRequired: boolean
}

const VALIDATION_RULES: ValidationRule[] = [
  {
    provider: 'render',
    buildStrategy: 'build-time',
    requiredEnvVars: ['NODE_ENV', 'NEXT_PUBLIC_API_URL'],
    dockerfilePattern: /Dockerfile\..*\.build-time\.prod$/,
    healthCheckRequired: true
  },
  {
    provider: 'docker-compose',
    buildStrategy: 'development',
    requiredEnvVars: ['NODE_ENV'],
    dockerfilePattern: /Dockerfile\..*\.dev$/,
    healthCheckRequired: false
  }
]
```

### 2. Resource Limit Validation

```typescript
interface ResourceLimits {
  memory?: string  // e.g., "512m", "1g"
  cpu?: string     // e.g., "0.5", "1"
  storage?: string // e.g., "1g", "10g"
}

function validateResourceLimits(limits: ResourceLimits): boolean {
  const memoryPattern = /^\d+[mMgG]$/
  const cpuPattern = /^\d+(\.\d+)?$/
  const storagePattern = /^\d+[mMgGtT]$/
  
  return (
    (!limits.memory || memoryPattern.test(limits.memory)) &&
    (!limits.cpu || cpuPattern.test(limits.cpu)) &&
    (!limits.storage || storagePattern.test(limits.storage))
  )
}
```

## Migration Rules

### 1. Build Strategy Migration

**Rule**: Migrations between build strategies require specific steps

```typescript
interface MigrationStep {
  from: string
  to: string
  steps: string[]
  warnings: string[]
}

const BUILD_STRATEGY_MIGRATIONS: MigrationStep[] = [
  {
    from: 'runtime',
    to: 'build-time',
    steps: [
      'Update dockerfilePath in deployment config',
      'Add build-time environment variables as build args',
      'Test image build process'
    ],
    warnings: [
      'Expect longer image builds but faster startups',
      'Ensure all environment variables are available at build time'
    ]
  },
  {
    from: 'build-time',
    to: 'runtime',
    steps: [
      'Update dockerfilePath in deployment config',
      'Remove build args, rely on runtime environment variables',
      'Update startup scripts'
    ],
    warnings: [
      'Expect faster image builds but slower startups',
      'May not be compatible with some PaaS providers'
    ]
  }
]
```

### 2. Provider Migration

**Rule**: Provider changes require configuration updates

```typescript
function migrateProvider(
  currentConfig: DeploymentConfig,
  targetProvider: string
): DeploymentConfig {
  const migrations = {
    'docker-compose-to-render': {
      dockerfilePath: currentConfig.dockerfilePath.replace('.prod', '.build-time.prod'),
      buildStrategy: 'build-time',
      environmentVariables: {
        ...currentConfig.environmentVariables,
        'NODE_ENV': 'production'
      }
    },
    'render-to-docker-compose': {
      dockerfilePath: currentConfig.dockerfilePath,
      buildStrategy: 'runtime', // More flexible for self-hosted
      environmentVariables: currentConfig.environmentVariables
    }
  }
  
  const migrationKey = `${currentConfig.provider}-to-${targetProvider}`
  const migration = migrations[migrationKey]
  
  return {
    ...currentConfig,
    provider: targetProvider,
    ...migration
  }
}
```

## Best Practices

### 1. Configuration Selection

1. **Development**: Always use development build strategy with hot reload
2. **Production PaaS**: Use build-time compilation for fast startup
3. **Production Self-Hosted**: Use build-time for critical services, runtime for flexibility
4. **Testing/Staging**: Mirror production configuration as closely as possible

### 2. Environment Variable Management

1. **Secrets**: Never commit secrets to configuration files
2. **Environment Hierarchy**: Use proper inheritance (global → service → deployment → preview)
3. **Validation**: Validate all required variables before deployment
4. **Documentation**: Document all custom environment variables

### 3. Resource Planning

1. **Memory**: Start with 512MB, scale based on monitoring
2. **CPU**: Start with 0.5 cores, monitor under load
3. **Storage**: Plan for logs, temporary files, and data growth
4. **Health Checks**: Always configure health checks for production

### 4. Security Considerations

1. **Network Isolation**: Use proper Docker networks
2. **SSL/TLS**: Always enable HTTPS in production
3. **Access Control**: Implement proper authentication and authorization
4. **Regular Updates**: Keep base images and dependencies updated

## Troubleshooting Guide

### Common Issues by Provider/Build Strategy

#### Build-Time Issues
- **Build fails**: Check environment variables are set as build args
- **Large image**: Normal for build-time strategy (~500MB)
- **Slow builds**: Use Docker layer caching, optimize Dockerfile

#### Runtime Issues
- **Slow startup**: Expected for runtime compilation (2-5 minutes)
- **Platform timeouts**: Switch to build-time compilation
- **Out of memory**: Increase container memory limits

#### Provider-Specific Issues
- **Render timeouts**: Use build-time Dockerfile
- **Docker Compose networking**: Use service names for internal communication
- **Vercel build limits**: Optimize bundle size, use external API

This comprehensive configuration rule system ensures consistent, scalable, and maintainable deployments across all supported providers and scenarios.