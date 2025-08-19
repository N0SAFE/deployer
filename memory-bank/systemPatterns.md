# System Patterns: Universal Deployment Platform Architecture

## High-Level Architecture

### Core Components
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Web Dashboard │    │  NestJS API     │    │ Deployment      │
│   (Next.js)     │◄──►│  (ORPC)         │◄──►│ Engine          │
│                 │    │                 │    │ (Docker)        │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Better Auth   │    │   PostgreSQL    │    │   Redis         │
│   (Auth/Users)  │    │   (Metadata)    │    │   (Jobs/Cache)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                       
                                │                       
                  ┌─────────────────┐    ┌─────────────────┐
                  │     Traefik     │    │  Deployed       │
                  │ (Load Balancer/ │◄──►│  Services       │
                  │ Domain Manager) │    │ (Containers)    │
                  └─────────────────┘    └─────────────────┘
```

### Data Flow Architecture
```
Git Platform → Webhook → API → Job Queue → Deployment Engine → Container Registry → Traefik → Running Service
     ↑                                                                                          ↓
User Dashboard ← Real-time Updates ← WebSocket ← Deployment Logs ← Service Health Monitor ← Domain Management
```

## Traefik Integration Pattern

### Dynamic Service Discovery
**Pattern**: Automatic container registration with domain routing
```typescript
interface TraefikConfig {
  router: {
    rule: string;           // Host(`subdomain.domain.com`)
    service: string;        // Service name
    tls: boolean;          // Enable SSL/TLS
    middlewares?: string[]; // Rate limiting, auth, etc.
  };
  service: {
    loadBalancer: {
      servers: Array<{ url: string }>; // Container endpoints
    };
  };
}

// Automatic label generation for containers
function generateTraefikLabels(deployment: DeploymentConfig): Record<string, string> {
  const subdomain = generateSubdomain(deployment);
  const serviceName = `${deployment.projectId}-${deployment.serviceId}`;
  
  return {
    'traefik.enable': 'true',
    [`traefik.http.routers.${serviceName}.rule`]: `Host(\`${subdomain}.${deployment.baseDomain}\`)`,
    [`traefik.http.services.${serviceName}.loadbalancer.server.port`]: deployment.port.toString(),
    [`traefik.http.routers.${serviceName}.tls`]: 'true',
    [`traefik.http.routers.${serviceName}.tls.certresolver`]: 'letsencrypt'
  };
}
```

### SSL Certificate Management
**Pattern**: Automatic Let's Encrypt certificate provisioning
```yaml
# Traefik configuration for automatic SSL
certificatesResolvers:
  letsencrypt:
    acme:
      email: admin@yourdomain.com
      storage: /data/acme.json
      httpChallenge:
        entryPoint: web
```

## Key Design Patterns

### 1. Event-Driven Deployment Pipeline
**Pattern**: Asynchronous job processing with real-time updates
```typescript
// Deployment Job Flow
interface DeploymentJob {
  id: string;
  projectId: string;
  source: GitSource | FileSource | CustomSource;
  environment: 'preview' | 'production' | 'staging';
  status: 'queued' | 'building' | 'deploying' | 'success' | 'failed';
  dependencies: string[]; // Other services to deploy after this one
}
```

### 2. Multi-Source Deployment Strategy
**Pattern**: Plugin-based source handlers
```typescript
interface DeploymentSource {
  type: 'github' | 'gitlab' | 'git' | 'upload' | 'custom';
  authenticate(): Promise<boolean>;
  fetchSource(config: SourceConfig): Promise<DeploymentBundle>;
  validateWebhook(payload: unknown): WebhookEvent | null;
}
```

### 3. Container Orchestration Layer
**Pattern**: Abstracted container management
```typescript
interface ContainerOrchestrator {
  deploy(bundle: DeploymentBundle, config: DeploymentConfig): Promise<DeploymentResult>;
  scale(serviceId: string, replicas: number): Promise<void>;
  getStatus(serviceId: string): Promise<ServiceStatus>;
  getLogs(serviceId: string, tail?: number): Promise<LogEntry[]>;
}
```

## Database Schema Design

### Core Tables
```sql
-- Projects and Services
projects (id, name, owner_id, base_domain, created_at)
services (id, project_id, name, type, dockerfile_path, port, env_vars)
service_dependencies (service_id, depends_on_service_id)

-- Deployments
deployments (id, service_id, source_type, source_config, commit_sha, status, environment)
deployment_logs (id, deployment_id, timestamp, level, message)

-- Preview Environments  
previews (id, deployment_id, subdomain, expires_at, webhook_trigger)

-- Access Control
project_collaborators (project_id, user_id, role)
api_keys (id, user_id, project_id, scopes, expires_at)
```

### Relationships
```
User 1:N Projects 1:N Services 1:N Deployments 1:N Logs
                     ↓              ↓
                Dependencies    Previews
```

## API Contract Structure

### Resource Hierarchy
```typescript
// ORPC Contract Structure
const deploymentContracts = {
  projects: {
    list: o.route({ ... }),
    create: o.route({ ... }),
    get: o.route({ ... }),
    update: o.route({ ... }),
    delete: o.route({ ... })
  },
  services: {
    listByProject: o.route({ ... }),
    create: o.route({ ... }),
    deploy: o.route({ ... }),
    getLogs: o.route({ ... }),
    getStatus: o.route({ ... })
  },
  deployments: {
    trigger: o.route({ ... }),
    getStatus: o.route({ ... }),
    getLogs: o.route({ ... }),
    rollback: o.route({ ... })
  },
  previews: {
    create: o.route({ ... }),
    list: o.route({ ... }),
    delete: o.route({ ... })
  }
};
```

## Service Dependencies Pattern

### Dependency Graph Resolution
```typescript
interface ServiceDependency {
  serviceId: string;
  dependsOn: string[];
  deploymentOrder: number; // Calculated from dependency graph
}

// Deployment orchestration
async function deployServiceChain(rootServiceId: string) {
  const dependencyGraph = await buildDependencyGraph(rootServiceId);
  const deploymentOrder = topologicalSort(dependencyGraph);
  
  for (const serviceId of deploymentOrder) {
    await deployService(serviceId);
    await waitForServiceHealth(serviceId);
  }
}
```

## Preview Environment Management

### Subdomain Generation Strategy
```typescript
interface PreviewConfig {
  project: string;
  branch?: string;
  pr?: number;
  customName?: string;
}

function generateSubdomain(config: PreviewConfig): string {
  // Pattern: {project}-{branch|pr|custom}.{baseDomain}
  const suffix = config.pr ? `pr-${config.pr}` 
                 : config.customName ? config.customName
                 : sanitizeBranchName(config.branch);
  
  return `${config.project}-${suffix}`;
}
```

### Environment Variable Inheritance
```typescript
interface EnvironmentVariables {
  global: Record<string, string>;     // Shared across all environments
  projectLevel: Record<string, string>; // Project-specific
  serviceLevel: Record<string, string>; // Service-specific
  previewLevel: Record<string, string>; // Preview-specific overrides
}

// Merge order: global < project < service < preview
function mergeEnvironmentVars(config: EnvironmentVariables): Record<string, string> {
  return {
    ...config.global,
    ...config.projectLevel,
    ...config.serviceLevel,
    ...config.previewLevel
  };
}
```

## Real-time Communication Pattern

### WebSocket Event Structure
```typescript
interface DeploymentEvent {
  type: 'deployment.started' | 'deployment.progress' | 'deployment.completed' | 'deployment.failed';
  projectId: string;
  serviceId: string;
  deploymentId: string;
  data: {
    progress?: number;
    message?: string;
    logs?: LogEntry[];
    error?: string;
  };
}

// Room-based subscriptions
const websocketRooms = {
  project: `project:${projectId}`,
  deployment: `deployment:${deploymentId}`,
  user: `user:${userId}`
};
```

## Security Architecture

### Access Control Patterns
```typescript
// Role-based permissions
enum ProjectRole {
  OWNER = 'owner',     // Full access
  ADMIN = 'admin',     // Deploy, manage users, no billing
  DEVELOPER = 'developer', // Deploy, view logs, no user management
  VIEWER = 'viewer'    // Read-only access
}

// Permission matrix
const permissions = {
  [ProjectRole.OWNER]: ['*'],
  [ProjectRole.ADMIN]: ['deploy', 'manage_services', 'view_logs', 'manage_collaborators'],
  [ProjectRole.DEVELOPER]: ['deploy', 'view_logs', 'create_previews'],
  [ProjectRole.VIEWER]: ['view_projects', 'view_logs']
};
```

### API Authentication
```typescript
// Multiple auth methods
interface AuthContext {
  user?: User;           // Session-based (Better Auth)
  apiKey?: ApiKey;       // Programmatic access
  webhookSecret?: string; // Webhook validation
}
```

## File Storage Strategy

### Artifact Management
```typescript
interface StorageProvider {
  uploadDeploymentBundle(deploymentId: string, bundle: Buffer): Promise<string>;
  downloadDeploymentBundle(deploymentId: string): Promise<Buffer>;
  cleanupOldDeployments(projectId: string, keepCount: number): Promise<void>;
}

// Local filesystem for self-hosted simplicity
class LocalStorageProvider implements StorageProvider {
  private basePath = '/var/lib/deployer/artifacts';
  // Implementation...
}
```

## Monitoring and Observability

### Health Check Pattern
```typescript
interface ServiceHealth {
  serviceId: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  lastCheck: Date;
  responseTime?: number;
  error?: string;
}

// Periodic health monitoring
setInterval(async () => {
  const services = await getRunningServices();
  for (const service of services) {
    const health = await checkServiceHealth(service);
    await updateServiceStatus(service.id, health);
    
    if (health.status === 'unhealthy') {
      await notifyServiceDown(service);
    }
  }
}, 30000); // Every 30 seconds
```