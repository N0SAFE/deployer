# Multi-Environment Deployment Specification

> Comprehensive specification for the multi-environment deployment system with dynamic variable resolution and cross-service/project references.

This document defines the architecture and implementation details for the advanced multi-environment deployment system that supports staging, production, and dynamic preview environments with template-based variable resolution.

## Overview

The multi-environment system enables deploying projects and services to different environments with environment-specific configurations, dynamic variable resolution, and cross-service/project variable referencing.

### Supported Environment Types

1. **Production** - Live, customer-facing deployments
2. **Staging** - Pre-production testing environment
3. **Preview** - Dynamic environments for feature branches, PRs, or custom configurations

## Environment Architecture

### Environment Hierarchy

```
Project
├── Production Environment
│   ├── Environment Variables
│   ├── Service Configurations
│   └── Deployment Settings
├── Staging Environment
│   ├── Environment Variables
│   ├── Service Configurations
│   └── Deployment Settings
└── Preview Environments (Multiple)
    ├── preview-feature-auth
    ├── preview-pr-123
    └── preview-custom-test
```

### Environment Schema

```typescript
interface Environment {
  id: string
  projectId: string
  name: string
  type: 'production' | 'staging' | 'preview'
  status: 'active' | 'inactive' | 'deploying' | 'failed'
  
  // Environment metadata
  description?: string
  branch?: string // For preview environments
  expiresAt?: Date // Auto-cleanup for preview environments
  
  // Configuration
  variables: EnvironmentVariable[]
  serviceOverrides: ServiceOverride[]
  deploymentConfig: DeploymentConfig
  
  // Dynamic variable resolution
  variableTemplate: string
  resolvedVariables: Record<string, any>
  
  // Timestamps
  createdAt: Date
  updatedAt: Date
}
```

## Dynamic Variable Resolution System

### Variable Template Syntax

The system supports template-based variable resolution using the syntax `${scope.path.to.value}`:

```bash
# Project references
${project.name}              # Current project name
${project.id}               # Current project ID
${project.url}              # Current project URL

# Service references
${services.api.url}         # API service URL
${services.web.port}        # Web service port
${services.database.host}   # Database service host

# Environment references
${env.NODE_ENV}             # Current environment name
${env.type}                 # Environment type (production/staging/preview)

# Cross-project references
${projects.auth-service.services.api.url}  # URL from another project's API
${projects.payment.env.STRIPE_KEY}         # Environment variable from another project

# System references
${system.timestamp}         # Current timestamp
${system.uuid}             # Generated UUID
${system.domain}           # Base domain

# Git references (for preview environments)
${git.branch}              # Current branch name
${git.commit}              # Current commit hash
${git.pr}                  # PR number (if applicable)
```

### Variable Resolution Scope

#### 1. Project Scope (`${project.*}`)
- `project.name` - Project name
- `project.id` - Project UUID
- `project.url` - Project base URL
- `project.description` - Project description
- `project.repository` - Git repository URL

#### 2. Services Scope (`${services.*}`)
- `services.{serviceName}.url` - Service external URL
- `services.{serviceName}.port` - Service port
- `services.{serviceName}.host` - Service hostname
- `services.{serviceName}.env.{VARIABLE}` - Service environment variables
- `services.{serviceName}.config.{setting}` - Service configuration values

#### 3. Environment Scope (`${env.*}`)
- `env.NODE_ENV` - Environment name (production/staging/preview)
- `env.type` - Environment type
- `env.name` - Custom environment name
- `env.branch` - Git branch (for preview environments)

#### 4. Cross-Project Scope (`${projects.*}`)
- `projects.{projectName}.services.{serviceName}.url` - Service URL from another project
- `projects.{projectName}.env.{VARIABLE}` - Environment variable from another project
- `projects.{projectName}.config.{setting}` - Configuration from another project

#### 5. System Scope (`${system.*}`)
- `system.timestamp` - Current Unix timestamp
- `system.uuid` - Generated UUID v4
- `system.domain` - Base deployment domain
- `system.region` - Deployment region

#### 6. Git Scope (`${git.*}`) - Preview Environments Only
- `git.branch` - Current branch name
- `git.commit` - Current commit hash (short)
- `git.pr` - Pull request number
- `git.author` - Commit author

### Variable Resolution Examples

#### Basic Service Reference
```yaml
# In environment variables
API_URL: ${services.api.url}
DATABASE_URL: ${services.database.url}
WEB_PORT: ${services.web.port}

# Resolves to:
API_URL: https://api-prod.myapp.com
DATABASE_URL: postgresql://db-prod.myapp.com:5432/myapp
WEB_PORT: 3000
```

#### Cross-Project Reference
```yaml
# In a frontend project referencing auth service from another project
AUTH_API_URL: ${projects.auth-service.services.api.url}
AUTH_PUBLIC_KEY: ${projects.auth-service.env.PUBLIC_KEY}

# Resolves to:
AUTH_API_URL: https://auth-api-prod.myapp.com
AUTH_PUBLIC_KEY: pk_live_abc123...
```

#### Preview Environment with Git Integration
```yaml
# Preview environment variables
BRANCH_NAME: ${git.branch}
PREVIEW_URL: https://${git.branch}-${project.name}.preview.myapp.com
DATABASE_URL: postgresql://preview-${git.pr}-db.myapp.com:5432/myapp_${git.branch}

# For branch "feature/user-auth" and PR #123, resolves to:
BRANCH_NAME: feature/user-auth
PREVIEW_URL: https://feature-user-auth-myproject.preview.myapp.com
DATABASE_URL: postgresql://preview-123-db.myapp.com:5432/myapp_feature_user_auth
```

## Environment-Specific Configurations

### Production Environment
```yaml
type: production
variables:
  NODE_ENV: production
  API_URL: ${services.api.url}
  DATABASE_URL: ${services.database.url}
  REDIS_URL: ${services.cache.url}
  
serviceOverrides:
  api:
    resources:
      memory: 2GB
      cpu: 1.0
    replicas: 3
  web:
    resources:
      memory: 1GB
      cpu: 0.5
    replicas: 2

deploymentConfig:
  strategy: blue-green
  healthCheck: true
  rollbackEnabled: true
  autoScale: true
```

### Staging Environment
```yaml
type: staging
variables:
  NODE_ENV: staging
  API_URL: ${services.api.url}
  DATABASE_URL: ${services.database.url}
  REDIS_URL: ${services.cache.url}
  DEBUG: true
  
serviceOverrides:
  api:
    resources:
      memory: 1GB
      cpu: 0.5
    replicas: 1
  web:
    resources:
      memory: 512MB
      cpu: 0.25
    replicas: 1

deploymentConfig:
  strategy: rolling
  healthCheck: true
  rollbackEnabled: true
  autoScale: false
```

### Preview Environment
```yaml
type: preview
branch: feature/user-auth
expiresAt: 2024-09-15T00:00:00Z

variables:
  NODE_ENV: preview
  BRANCH_NAME: ${git.branch}
  PR_NUMBER: ${git.pr}
  API_URL: https://${git.branch}-api.preview.myapp.com
  WEB_URL: https://${git.branch}-web.preview.myapp.com
  DATABASE_URL: postgresql://preview-${git.pr}-db.myapp.com:5432/myapp_${git.branch}
  
serviceOverrides:
  api:
    resources:
      memory: 512MB
      cpu: 0.25
    replicas: 1
  web:
    resources:
      memory: 256MB
      cpu: 0.1
    replicas: 1

deploymentConfig:
  strategy: recreate
  healthCheck: false
  rollbackEnabled: false
  autoScale: false
  autoCleanup: true
```

## Variable Resolution Engine

### Resolution Process

1. **Template Parsing** - Parse template strings for variable references
2. **Scope Resolution** - Determine the scope of each variable
3. **Dependency Graph** - Build dependency graph for cross-references
4. **Value Resolution** - Resolve values in dependency order
5. **Circular Detection** - Detect and handle circular references
6. **Cache Management** - Cache resolved values for performance

### Resolution Algorithm

```typescript
interface VariableResolver {
  resolve(template: string, context: ResolutionContext): Promise<string>
  
  // Resolution context
  interface ResolutionContext {
    projectId: string
    environmentId: string
    serviceId?: string
    gitContext?: GitContext
    systemContext: SystemContext
  }
}

// Example resolution process
const resolver = new VariableResolver()
const resolved = await resolver.resolve(
  '${services.api.url}/v1/auth', 
  {
    projectId: 'proj_123',
    environmentId: 'env_prod',
    gitContext: { branch: 'main', commit: 'abc123' }
  }
)
// Returns: 'https://api-prod.myapp.com/v1/auth'
```

### Error Handling

- **Missing Variables** - Throw clear error with available alternatives
- **Circular References** - Detect and report circular dependency chains
- **Access Permissions** - Validate cross-project access permissions
- **Type Mismatches** - Handle type conversion and validation
- **Network Timeouts** - Handle service discovery timeouts

## Environment Management UI

### Environment List View
- Environment cards with status indicators
- Quick actions (deploy, pause, delete)
- Resource usage indicators
- Last deployment information

### Environment Configuration
- Variable template editor with syntax highlighting
- Variable preview with resolved values
- Service override configurations
- Deployment settings per environment

### Variable Template Editor
- Syntax highlighting for variable references
- Autocomplete for available variables
- Real-time validation and error highlighting
- Preview resolved values
- Variable dependency visualization

### Preview Environment Management
- Create preview environments from branches/PRs
- Auto-cleanup configuration
- Quick deployment from Git references
- Environment comparison tools

## API Endpoints

### Environment Management
```typescript
// Environment CRUD
GET    /api/projects/{id}/environments
POST   /api/projects/{id}/environments
GET    /api/projects/{id}/environments/{envId}
PUT    /api/projects/{id}/environments/{envId}
DELETE /api/projects/{id}/environments/{envId}

// Variable resolution
POST   /api/projects/{id}/environments/{envId}/resolve-variables
GET    /api/projects/{id}/environments/{envId}/resolved-variables

// Preview environments
POST   /api/projects/{id}/environments/preview
GET    /api/projects/{id}/environments/preview/from-branch/{branch}
GET    /api/projects/{id}/environments/preview/from-pr/{prNumber}

// Cross-project queries
GET    /api/projects/{id}/cross-references
GET    /api/projects/{id}/available-variables
```

### Deployment with Environments
```typescript
// Deploy to specific environment
POST   /api/projects/{id}/deploy
{
  environmentId: 'env_123',
  services: ['api', 'web'],
  gitReference?: 'feature/auth'
}

// Environment deployment history
GET    /api/projects/{id}/environments/{envId}/deployments
GET    /api/projects/{id}/environments/{envId}/deployments/{deployId}
```

## Security Considerations

### Access Control
- **Environment Permissions** - Role-based access to environments
- **Cross-Project Access** - Explicit permissions for cross-project references
- **Variable Encryption** - Encrypt sensitive variables in transit and at rest
- **Audit Logging** - Log all variable access and modifications

### Variable Security
- **Secret Management** - Secure handling of secret variables
- **Scope Isolation** - Prevent unauthorized cross-scope access
- **Injection Prevention** - Validate variable content to prevent injection
- **Encryption** - Encrypt sensitive variables and communications

## Implementation Phases

### Phase 1: Core Environment System
1. Environment data models and API contracts
2. Basic environment CRUD operations
3. Simple variable resolution (no cross-references)
4. Environment-specific deployments

### Phase 2: Dynamic Variables
1. Variable template parsing engine
2. Cross-service variable resolution
3. System and Git variable scopes
4. Variable dependency management

### Phase 3: Preview Environments
1. Dynamic preview environment creation
2. Git integration for branch/PR environments
3. Auto-cleanup and expiration
4. Environment comparison tools

### Phase 4: Advanced Features
1. Cross-project variable resolution
2. Variable template editor with IDE features
3. Environment status dashboard
4. Performance optimization and caching

## Migration Strategy

### Existing Environment Variables
1. **Inventory Current Variables** - Catalog all existing environment variables
2. **Create Default Environments** - Set up production/staging environments
3. **Migrate Variables** - Move existing variables to environment-specific configs
4. **Update References** - Convert hardcoded references to dynamic variables
5. **Validation** - Ensure all services work with new system

### Deployment Migration
1. **Parallel Deployment** - Run old and new systems in parallel
2. **Gradual Rollout** - Migrate services one by one
3. **Rollback Plan** - Maintain ability to rollback to old system
4. **Monitoring** - Monitor variable resolution performance and errors

## Performance Considerations

### Caching Strategy
- **Resolved Values** - Cache resolved variable values
- **Service Discovery** - Cache service endpoint discovery
- **Cross-Project Data** - Cache cross-project metadata
- **Template Compilation** - Cache parsed templates

### Optimization
- **Lazy Resolution** - Only resolve variables when needed
- **Batch Resolution** - Resolve multiple variables in single operation
- **Dependency Optimization** - Optimize dependency graph traversal
- **CDN Integration** - Use CDN for static variable resolution

## Monitoring and Observability

### Metrics
- Variable resolution latency
- Resolution success/failure rates
- Cross-project reference usage
- Environment deployment frequency

### Logging
- Variable resolution events
- Cross-project access attempts
- Environment configuration changes
- Deployment environment selections

### Alerting
- Variable resolution failures
- Circular dependency detection
- Cross-project access violations
- Environment resource exceeded

This specification provides the foundation for implementing a comprehensive multi-environment deployment system with advanced dynamic variable resolution capabilities.