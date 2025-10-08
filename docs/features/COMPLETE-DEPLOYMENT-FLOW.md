# Complete Deployment Flow Documentation

This document describes the end-to-end deployment flow from trigger to working deployment with Traefik routing.

## Overview

The deployment system uses a provider-agnostic orchestrator pattern that works with multiple source providers (GitHub, GitLab, Static files, etc.) and supports automatic Traefik routing configuration with variable resolution.

## Architecture Components

### 1. Deployment Controller
**File**: `apps/api/src/modules/deployment/controllers/deployment.controller.ts`

**Responsibilities**:
- Receives deployment trigger requests via HTTP API
- Creates deployment record in database
- Maps service provider to source type
- Queues deployment job via DeploymentQueueService

**API Endpoint**: `POST /deployment/trigger`

**Input**:
```typescript
{
  serviceId: string;
  environment: 'production' | 'staging' | 'preview' | 'development';
  sourceType: 'github' | 'gitlab' | 'git' | 'upload' | 'custom';
  sourceConfig: {
    // GitHub/GitLab
    repositoryUrl?: string;
    branch?: string;
    commitSha?: string;
    // File upload
    fileName?: string;
    fileSize?: number;
    // Custom
    customData?: Record<string, any>;
  };
  environmentVariables?: Record<string, string>;
}
```

### 2. Deployment Processor (Job Queue)
**File**: `apps/api/src/core/modules/orchestration/processors/deployment.processor.ts`

**Responsibilities**:
- Processes deployment jobs from Bull queue
- Fetches service configuration from database
- Builds DeploymentConfig for orchestrator
- Updates deployment status throughout the process
- Calls DeploymentOrchestrator.deploy()

**Job Data**:
```typescript
interface DeploymentJobData {
  deploymentId: string;
  projectId: string;
  serviceId: string;
  sourceConfig: any;
}
```

### 3. Deployment Orchestrator
**File**: `apps/api/src/core/modules/deployment/services/deployment-orchestrator.service.ts`

**Responsibilities**:
- Provider-agnostic deployment pipeline
- Fetches source files from provider
- Builds application using builder strategy
- Deploys to container orchestrator
- **Updates Traefik routing with variable resolution**
- Performs health checks
- Handles rollback on failure

**Main Flow**:
```typescript
async deploy(config: DeploymentConfig, trigger: DeploymentTrigger): Promise<DeploymentResult> {
  // 1. Get provider and validate config
  const provider = this.getProvider(config.provider.type);
  
  // 2. Check cache (skip if no changes)
  const skipCheck = await provider.shouldSkipDeployment(config.provider, trigger);
  
  // 3. Fetch source files
  const source = await provider.fetchSource(config.provider, trigger);
  
  // 4. Build application
  const buildResult = await this.build(source, config.builder, config);
  
  // 5. Deploy container
  const deployResult = await this.deployContainer(buildResult, config);
  
  // 6. Health check (optional)
  if (config.healthCheck) {
    await this.runHealthCheck(deployResult.url, config.healthCheck);
  }
  
  // 7. Update Traefik routing (NEW!)
  await this.updateRouting(config.serviceId, deployResult.url);
  
  return deployResult;
}
```

### 4. Provider Services

#### GitHub Provider
**File**: `apps/api/src/core/modules/providers/github/github-provider.service.ts`

**Capabilities**:
- Clone repository from GitHub
- Checkout specific branch/commit
- Apply monorepo filtering
- Detect changed files for cache
- Generate default Traefik configuration

**Default Traefik Config**:
```typescript
getDefaultTraefikConfig(options: { enableSSL?: boolean }): TraefikConfigBuilder {
  const builder = new TraefikConfigBuilder();
  
  builder
    .addHTTPRouter('{{serviceName}}-router', {
      rule: `Host(\`{{domain}}\`)`,
      service: '{{serviceName}}-service',
      entryPoints: ['web'],
    })
    .addHTTPService('{{serviceName}}-service', {
      loadBalancer: {
        servers: [{ url: 'http://{{containerName}}:{{containerPort}}' }],
      },
    });
  
  if (options?.enableSSL) {
    builder.addHTTPRouter('{{serviceName}}-router-https', {
      rule: `Host(\`{{domain}}\`)`,
      service: '{{serviceName}}-service',
      entryPoints: ['websecure'],
      tls: { certResolver: 'letsencrypt' },
    });
  }
  
  return builder;
}
```

#### Static Provider
**File**: `apps/api/src/core/modules/providers/static/static-provider.service.ts`

**Capabilities**:
- Deploy static files from upload/path
- Create nginx containers for serving
- Generate default Traefik configuration
- Similar default config as GitHub provider

### 5. Builder Services

**Available Builders**:
- **DockerfileBuilderService**: Builds from Dockerfile
- **NixpackBuilderService**: Builds using Nixpacks
- **BuildpackBuilderService**: Cloud Native Buildpacks
- **StaticBuilderService**: Static file nginx containers
- **DockerComposeBuilderService**: Multi-service deployments

**Builder Result**:
```typescript
interface BuilderResult {
  deploymentId: string;
  containerIds: string[];
  containers: string[];
  status: 'success' | 'failed';
  healthCheckUrl?: string;
  domain?: string;
  message?: string;
  metadata?: {
    image?: string;
    [key: string]: any;
  };
}
```

### 6. Traefik Integration (NEW!)

#### Variable Resolution System
**File**: `apps/api/src/core/modules/traefik/services/traefik-variable-resolver.service.ts`

**25+ Variables Available**:

| Category | Variables | Description |
|----------|-----------|-------------|
| **Service** | `{{serviceName}}`, `{{serviceId}}`, `{{serviceType}}` | Service identification |
| **Deployment** | `{{deploymentId}}`, `{{containerName}}`, `{{containerPort}}`, `{{containerId}}`, `{{environment}}` | Deployment runtime info |
| **Domain** | `{{domain}}`, `{{subdomain}}`, `{{fullDomain}}`, `{{baseDomain}}` | DNS configuration |
| **SSL** | `{{certFile}}`, `{{keyFile}}`, `{{certResolver}}` | SSL/TLS certificates |
| **Path** | `{{prefix}}`, `{{healthCheck}}` | URL paths |
| **Network** | `{{networkName}}`, `{{networkId}}` | Docker networking |
| **Project** | `{{projectId}}`, `{{projectName}}` | Project context |
| **Route** | `{{routerName}}`, `{{traefikServiceName}}`, `{{middlewareName}}`, `{{entryPoint}}`, `{{priority}}` | Traefik routing |

#### Routing Update Flow

**In DeploymentOrchestrator.updateRouting()**:

```typescript
async updateRouting(serviceId: string): Promise<void> {
  // 1. Get service from database (includes traefikConfig column)
  const service = await db.select().from(services).where(eq(services.id, serviceId));
  
  // 2. Get TraefikConfigBuilder (auto-deserialized from jsonb)
  let traefikConfig = service.traefikConfig as TraefikConfigBuilder;
  
  // 3. If no config, get default from provider
  if (!traefikConfig) {
    const provider = this.getProvider(service.provider);
    traefikConfig = provider.getDefaultTraefikConfig({ enableSSL: false });
  }
  
  // 4. Get deployment context
  const latestDeployment = await db
    .select()
    .from(deployments)
    .where(eq(deployments.serviceId, serviceId))
    .orderBy(desc(deployments.createdAt))
    .limit(1);
  
  // 5. Get project info
  const project = await db.select().from(projects).where(eq(projects.id, service.projectId));
  
  // 6. Build variable resolution context
  const context: VariableResolutionContext = {
    service: {
      id: service.id,
      name: service.name,
      type: service.type,
    },
    deployment: {
      id: latestDeployment.id,
      containerName: latestDeployment.containerName,
      containerPort: service.port,
      environment: latestDeployment.environment,
    },
    domain: {
      domain: process.env.TRAEFIK_DOMAIN || 'localhost',
      subdomain: `${service.name}-${project.name}`,
      fullDomain: `${service.name}-${project.name}.${domain}`,
    },
    // ... SSL, path, network, project, route contexts
  };
  
  // 7. Resolve variables in TraefikConfigBuilder
  const resolvedBuilder = traefikVariableResolver.resolveBuilder(traefikConfig, context);
  
  // 8. Convert to YAML and write to Traefik directory
  const resolvedConfig = resolvedBuilder.build();
  const yamlConfig = TraefikConfigBuilder.toYAMLString(resolvedConfig);
  
  const configPath = path.join(
    process.env.TRAEFIK_CONFIG_BASE_PATH || '/app/traefik-configs',
    `service-${service.id}.yml`
  );
  
  await fs.promises.writeFile(configPath, yamlConfig, 'utf-8');
  
  // 9. Traefik auto-reloads from file provider
  this.logger.log(`Service accessible at: http://${context.domain.fullDomain}`);
}
```

## Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. USER TRIGGERS DEPLOYMENT                                      │
│    POST /deployment/trigger { serviceId, environment, source }  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. DEPLOYMENT CONTROLLER                                         │
│    - Create deployment record in DB                              │
│    - Map service provider → source type                          │
│    - Queue deployment job                                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. DEPLOYMENT PROCESSOR (Bull Queue)                             │
│    - Fetch service config from DB                                │
│    - Build DeploymentConfig                                      │
│    - Update status: queued → deploying                           │
│    - Call DeploymentOrchestrator.deploy()                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. DEPLOYMENT ORCHESTRATOR                                       │
│    ┌──────────────────────────────────────────────────────┐    │
│    │ 4.1. Get Provider (GitHub, GitLab, Static, etc.)     │    │
│    └──────────────────────────────────────────────────────┘    │
│    ┌──────────────────────────────────────────────────────┐    │
│    │ 4.2. Validate Provider Config                        │    │
│    └──────────────────────────────────────────────────────┘    │
│    ┌──────────────────────────────────────────────────────┐    │
│    │ 4.3. Check Cache (shouldSkipDeployment)              │    │
│    └──────────────────────────────────────────────────────┘    │
│    ┌──────────────────────────────────────────────────────┐    │
│    │ 4.4. Fetch Source (provider.fetchSource)             │    │
│    │      - GitHub: Clone repo to temp dir                │    │
│    │      - Static: Use existing path                     │    │
│    └──────────────────────────────────────────────────────┘    │
│    ┌──────────────────────────────────────────────────────┐    │
│    │ 4.5. Build Application (builder.deploy)              │    │
│    │      - Dockerfile, Nixpacks, Buildpack, etc.         │    │
│    │      - Returns: image, containerIds, healthCheckUrl  │    │
│    └──────────────────────────────────────────────────────┘    │
│    ┌──────────────────────────────────────────────────────┐    │
│    │ 4.6. Deploy Container                                │    │
│    │      - Extract container info from BuilderResult     │    │
│    └──────────────────────────────────────────────────────┘    │
│    ┌──────────────────────────────────────────────────────┐    │
│    │ 4.7. Health Check (optional)                         │    │
│    └──────────────────────────────────────────────────────┘    │
│    ┌──────────────────────────────────────────────────────┐    │
│    │ 4.8. UPDATE TRAEFIK ROUTING (NEW!)                   │    │
│    │      ↓                                                │    │
│    │   ┌────────────────────────────────────────────┐     │    │
│    │   │ a. Get service with traefikConfig from DB  │     │    │
│    │   └────────────────────────────────────────────┘     │    │
│    │   ┌────────────────────────────────────────────┐     │    │
│    │   │ b. Get default config if none exists       │     │    │
│    │   │    (from provider.getDefaultTraefikConfig)  │     │    │
│    │   └────────────────────────────────────────────┘     │    │
│    │   ┌────────────────────────────────────────────┐     │    │
│    │   │ c. Get latest deployment for variables     │     │    │
│    │   └────────────────────────────────────────────┘     │    │
│    │   ┌────────────────────────────────────────────┐     │    │
│    │   │ d. Build VariableResolutionContext         │     │    │
│    │   │    - service: id, name, type               │     │    │
│    │   │    - deployment: containerName, port, env  │     │    │
│    │   │    - domain: fullDomain, subdomain         │     │    │
│    │   │    - ssl: certFile, keyFile                │     │    │
│    │   └────────────────────────────────────────────┘     │    │
│    │   ┌────────────────────────────────────────────┐     │    │
│    │   │ e. Resolve variables in TraefikConfig      │     │    │
│    │   │    traefikVariableResolver.resolveBuilder() │     │    │
│    │   └────────────────────────────────────────────┘     │    │
│    │   ┌────────────────────────────────────────────┐     │    │
│    │   │ f. Convert to YAML                         │     │    │
│    │   │    TraefikConfigBuilder.toYAMLString()      │     │    │
│    │   └────────────────────────────────────────────┘     │    │
│    │   ┌────────────────────────────────────────────┐     │    │
│    │   │ g. Write to Traefik config directory       │     │    │
│    │   │    /app/traefik-configs/service-{id}.yml    │     │    │
│    │   └────────────────────────────────────────────┘     │    │
│    └──────────────────────────────────────────────────────┘    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. TRAEFIK AUTO-RELOAD                                           │
│    - File provider detects new/updated config                   │
│    - Loads dynamic configuration                                │
│    - Routes traffic to container                                │
│    - Service accessible at: http://{subdomain}.{domain}         │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. UPDATE DEPLOYMENT RECORD                                      │
│    - Save containerName, containerImage, url                    │
│    - Update status: deploying → success                         │
│    - Add completion timestamp                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Database Schema

### Services Table
```typescript
{
  id: uuid;
  name: string;
  provider: 'github' | 'gitlab' | 'static' | 'manual';
  builder: 'dockerfile' | 'nixpacks' | 'buildpack' | 'static';
  traefikConfig: TraefikConfigBuilder; // Custom jsonb column with variables
  // ... other fields
}
```

### Deployments Table
```typescript
{
  id: uuid;
  serviceId: uuid;
  status: 'pending' | 'queued' | 'building' | 'deploying' | 'success' | 'failed';
  environment: 'production' | 'staging' | 'preview' | 'development';
  sourceType: 'github' | 'gitlab' | 'git' | 'upload';
  containerName: string;
  containerImage: string;
  url: string; // Deployment URL with Traefik routing
  // ... other fields
}
```

## Environment Variables

Required environment variables for Traefik integration:

```bash
# Traefik Configuration
TRAEFIK_CONFIG_BASE_PATH=/app/traefik-configs  # Directory for dynamic configs
TRAEFIK_DOMAIN=example.com                      # Base domain for deployments
DEPLOYER_BASE_DOMAIN=example.com                # Fallback domain

# Alternative domain configuration
# TRAEFIK_DOMAIN takes precedence over DEPLOYER_BASE_DOMAIN
```

## Usage Examples

### 1. Deploy from GitHub

```typescript
// POST /deployment/trigger
{
  "serviceId": "550e8400-e29b-41d4-a716-446655440000",
  "environment": "production",
  "sourceType": "github",
  "sourceConfig": {
    "repositoryUrl": "https://github.com/user/repo",
    "branch": "main",
    "commitSha": "abc123def456..." // optional
  },
  "environmentVariables": {
    "NODE_ENV": "production",
    "API_KEY": "secret"
  }
}
```

**Result**:
1. Repository cloned to temp directory
2. Application built using configured builder
3. Container deployed
4. Traefik config generated and synced:
   ```yaml
   http:
     routers:
       my-service-router:
         rule: "Host(`my-service-project.example.com`)"
         service: my-service-service
         entryPoints:
           - web
     services:
       my-service-service:
         loadBalancer:
           servers:
             - url: "http://my-service-abc123:3000"
   ```
5. Service accessible at: `http://my-service-project.example.com`

### 2. Deploy Static Files

```typescript
// POST /deployment/trigger
{
  "serviceId": "550e8400-e29b-41d4-a716-446655440001",
  "environment": "production",
  "sourceType": "upload",
  "sourceConfig": {
    "fileName": "dist.zip",
    "fileSize": 1048576,
    "customData": {
      "embeddedContent": "<html>...</html>" // for static provider
    }
  }
}
```

**Result**:
1. Static files extracted
2. Nginx container created
3. Traefik routing configured
4. Service accessible at generated subdomain

## Testing the Flow

### 1. Check Service Configuration

```bash
# View service traefik config
curl http://localhost:3001/api/services/{serviceId} | jq '.traefikConfig'
```

### 2. Trigger Deployment

```bash
curl -X POST http://localhost:3001/api/deployment/trigger \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "your-service-id",
    "environment": "production",
    "sourceType": "github",
    "sourceConfig": {
      "repositoryUrl": "https://github.com/user/repo",
      "branch": "main"
    }
  }'
```

### 3. Monitor Deployment

```bash
# Get deployment status
curl http://localhost:3001/api/deployment/status?deploymentId={id}

# Watch logs
curl http://localhost:3001/api/deployment/logs?deploymentId={id}
```

### 4. Verify Traefik Configuration

```bash
# Check generated config file
cat /app/traefik-configs/service-{serviceId}.yml

# Verify container is running
docker ps | grep {containerName}

# Test deployed service
curl http://{subdomain}.{domain}
```

## Troubleshooting

### Deployment Fails at Routing Step

**Symptoms**: Deployment succeeds but no Traefik config generated

**Causes**:
1. TraefikVariableResolverService not available
2. DatabaseService not injected
3. Missing TRAEFIK_CONFIG_BASE_PATH directory

**Solutions**:
```bash
# Check service injection
# Ensure CoreDeploymentModule imports TraefikCoreModule

# Create config directory
mkdir -p /app/traefik-configs
chmod 777 /app/traefik-configs

# Verify environment variables
echo $TRAEFIK_CONFIG_BASE_PATH
echo $TRAEFIK_DOMAIN
```

### Variables Not Resolved

**Symptoms**: Config contains `{{variableName}}` instead of values

**Causes**:
1. Missing context data (deployment, service, project)
2. Variable name mismatch

**Solutions**:
```bash
# Check available variables
# See docs/features/TRAEFIK-CONFIGURATION-VARIABLES.md

# Verify deployment has required data
curl http://localhost:3001/api/deployment/status?deploymentId={id} | jq
```

### Traefik Not Picking Up Config

**Symptoms**: Config file exists but route not working

**Causes**:
1. Traefik file provider not watching directory
2. Invalid YAML syntax
3. Container network mismatch

**Solutions**:
```bash
# Validate YAML
yamllint /app/traefik-configs/service-{id}.yml

# Check Traefik logs
docker logs traefik

# Verify Traefik provider config
# Ensure providers.file.directory points to /app/traefik-configs
```

## Next Steps

1. **SSL/TLS Integration**: Add automatic SSL certificate generation
2. **Custom Domains**: Support user-provided domains
3. **Blue/Green Deployments**: Zero-downtime deployments
4. **Canary Releases**: Gradual traffic shifting
5. **Rollback Automation**: Automatic rollback on health check failure

## See Also

- [Traefik Configuration Variables](./TRAEFIK-CONFIGURATION-VARIABLES.md)
- [Service-Adapter Pattern](../concepts/SERVICE-ADAPTER-PATTERN.md)
- [Frontend Development Patterns](../concepts/FRONTEND-DEVELOPMENT-PATTERNS.md)
