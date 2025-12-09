# Projects Module Architecture

> **Module Status**: Production-Ready  
> **Architecture Health**: ✅ CLEAN  
> **Last Updated**: 2025-11-30

## Executive Summary

The Projects module provides infrastructure for per-project HTTP servers, enabling static file serving for deployed services. It has a clean, focused architecture with minimal dependencies.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                       PROJECTS MODULE                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                  ProjectServerService                        │   │
│  │                                                              │   │
│  │  ┌───────────────┐  ┌────────────────┐  ┌───────────────┐  │   │
│  │  │   Container   │  │     Vhost      │  │    Health     │  │   │
│  │  │   Lifecycle   │  │  Configuration │  │   Monitoring  │  │   │
│  │  │               │  │                │  │               │  │   │
│  │  │ • Create      │  │ • Symlinks     │  │ • HTTP check  │  │   │
│  │  │ • Start       │  │ • Traefik cfg  │  │ • Container   │  │   │
│  │  │ • Stop        │  │ • Routing      │  │ • Recovery    │  │   │
│  │  │ • Remove      │  │                │  │               │  │   │
│  │  └───────────────┘  └────────────────┘  └───────────────┘  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                   External Dependencies                      │   │
│  │                                                              │   │
│  │  ┌──────────────────────┐  ┌───────────────────────────┐   │   │
│  │  │     DockerService    │  │  TraefikTemplateService   │   │   │
│  │  │  (from @Global)      │  │  (from TraefikCoreModule) │   │   │
│  │  └──────────────────────┘  └───────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Service Responsibilities

### ProjectServerService

The main service handles three key responsibilities:

#### 1. Container Lifecycle Management

```typescript
class ProjectServerService {
  // Ensure a project's HTTP server container exists
  async ensureProjectServer(projectId: string, host: string): Promise<ProjectServerInfo>;
  
  // Create container with proper configuration
  private async createProjectServerContainer(projectId: string): Promise<Container>;
  
  // Verify container health
  private async verifyContainerHealth(containerName: string, timeoutMs?: number): Promise<HealthResult>;
  
  // Reload server configuration
  async reloadProjectServer(projectId: string): Promise<void>;
}
```

#### 2. Virtual Host Configuration

```typescript
class ProjectServerService {
  // Configure vhost for a service
  async ensureVhostForService(projectId: string, host: string, serviceName: string): Promise<void>;
  
  // Add Traefik routing configuration
  async addServiceRouter(projectId: string, serviceName: string, host: string): Promise<void>;
  
  // Setup internal vhost symlinks
  private async setupVhostConfiguration(projectId: string, host: string, serviceName: string): Promise<void>;
}
```

#### 3. Health Monitoring

```typescript
class ProjectServerService {
  // Get project server status
  async getProjectServerStatus(projectId: string): Promise<ProjectServerStatus | null>;
  
  // Comprehensive health check with recovery
  async ensureProjectServerHealth(projectId: string, serviceName: string, host?: string): Promise<boolean>;
}
```

## Container Architecture

### Container Configuration

Each project gets a dedicated lighttpd container:

```typescript
const options: CreateContainerOptions = {
  image: 'rtsp/lighttpd',
  name: `project-http-${projectId}`,
  Labels: {
    'deployer.project_server': projectId,
  },
  Healthcheck: {
    Test: ['CMD-SHELL', 'wget --quiet --tries=1 --spider http://127.0.0.1:80/ || exit 1'],
    Interval: 30_000_000_000,  // 30s in nanoseconds
    Timeout: 10_000_000_000,   // 10s
    Retries: 3,
    StartPeriod: 40_000_000_000,  // 40s
  },
  HostConfig: {
    Binds: [`${volumeName}:/srv/static:rw`],
    NetworkMode: networkName,
    RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 3 },
  },
};
```

### Volume Structure

```
static_files_volume/
└── project-{projectId}/
    └── {serviceName}/
        ├── current -> deployment-20240102-140000/  (symlink)
        ├── deployment-20240101-120000/
        │   ├── index.html
        │   └── assets/
        └── deployment-20240102-140000/
            ├── index.html
            └── assets/
```

### Webroot Mapping

Inside the container:
```
/var/www/html/
└── {serviceName} -> /srv/static/project-{projectId}/{serviceName}/current  (symlink)
```

## Traefik Integration

### Dynamic Configuration Generation

The service generates Traefik YAML configuration:

```yaml
# /app/traefik-configs/dynamic/project-{projectId}-{serviceName}.yml
http:
  routers:
    project-{projectId}-{serviceName}:
      rule: "Host(`{host}`)"
      service: "{serviceName}-svc"
      middlewares:
        - "{middlewareName}"
      entryPoints:
        - web
  
  middlewares:
    {middlewareName}:
      addPrefix:
        prefix: "/{serviceName}"
  
  services:
    {serviceName}-svc:
      loadBalancer:
        servers:
          - url: "http://project-http-{projectId}:80"
```

### Request Flow

```
                                    ┌─────────────────┐
                                    │     Client      │
                                    └────────┬────────┘
                                             │
                                    ┌────────▼────────┐
                                    │    Traefik      │
                                    │   (port 80)     │
                                    └────────┬────────┘
                                             │
            ┌────────────────────────────────┼────────────────────────────────┐
            │                                │                                │
┌───────────▼───────────┐       ┌───────────▼───────────┐       ┌───────────▼───────────┐
│   project-http-001    │       │   project-http-002    │       │   project-http-003    │
│   (Host: app1.com)    │       │   (Host: app2.com)    │       │   (Host: app3.com)    │
└───────────────────────┘       └───────────────────────┘       └───────────────────────┘
```

## Module Dependencies

### Import Structure

```typescript
@Module({
  imports: [
    TraefikCoreModule,  // For TraefikTemplateService
  ],
  providers: [
    ProjectServerService,
  ],
  exports: [
    ProjectServerService,
  ],
})
export class ProjectsModule {}
```

### Dependency Graph

```
ProjectsModule
│
├── TraefikCoreModule
│   └── TraefikTemplateService (for config generation)
│
└── DockerModule (@Global - implicit)
    └── DockerService (for container operations)
```

## Error Handling

### Retry Strategy

Container creation uses exponential backoff:

```typescript
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    const container = await this.dockerService.createContainer(options);
    await container.start();
    
    // Health verification
    const healthCheck = await this.verifyContainerHealth(containerName, 30000);
    if (!healthCheck.healthy) {
      await this.dockerService.removeContainer(containerName);
      if (attempt === 3) throw new Error('Failed after 3 attempts');
      continue;
    }
    
    return containerInfo;
  } catch (error) {
    await this.dockerService.removeContainer(containerName);
    if (attempt === 3) throw error;
    await sleep(2000);  // Wait before retry
  }
}
```

### Health Check Flow

```
┌─────────────────┐
│ Health Check    │
│ Request         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Container       │──No──▶ Return unhealthy
│ Running?        │
└────────┬────────┘
         │Yes
         ▼
┌─────────────────┐
│ HTTP Check      │──Fail──▶ Wait 1s ──▶ Retry
│ (wget :80)      │                       (up to timeout)
└────────┬────────┘
         │Pass
         ▼
┌─────────────────┐
│ Return healthy  │
└─────────────────┘
```

## Usage Patterns

### Basic Usage

```typescript
// Ensure project server exists
const server = await projectServerService.ensureProjectServer(
  'project-123',
  'myapp.example.com'
);

// Configure vhost for a service
await projectServerService.ensureVhostForService(
  'project-123',
  'myapp.example.com',
  'frontend'
);
```

### Health Check and Recovery

```typescript
// Comprehensive health check with automatic recovery
const healthy = await projectServerService.ensureProjectServerHealth(
  'project-123',
  'frontend',
  'myapp.example.com'
);

if (!healthy) {
  // Handle recovery failure
  throw new Error('Project server recovery failed');
}
```

### Status Monitoring

```typescript
// Get current status
const status = await projectServerService.getProjectServerStatus('project-123');

if (status) {
  console.log(`Container: ${status.containerName}`);
  console.log(`Health: ${status.health.status}`);
  console.log(`Created: ${status.createdAt}`);
}
```

## Best Practices

### 1. Always Verify Health After Operations

```typescript
// After creating or configuring a server
await projectServerService.ensureProjectServer(projectId, host);
const healthy = await projectServerService.ensureProjectServerHealth(projectId, serviceName, host);
if (!healthy) {
  throw new Error('Server health verification failed');
}
```

### 2. Use Comprehensive Health Checks for Deployments

```typescript
// At the end of a deployment
async function finalizeDeployment(projectId: string, serviceName: string, host: string) {
  // Ensure everything is properly configured and healthy
  const success = await projectServerService.ensureProjectServerHealth(
    projectId,
    serviceName,
    host
  );
  
  if (!success) {
    // Rollback or alert
  }
}
```

### 3. Clean Up on Project Deletion

```typescript
// When deleting a project
async function deleteProject(projectId: string) {
  const containerName = `project-http-${projectId}`;
  try {
    await dockerService.stopContainer(containerName);
    await dockerService.removeContainer(containerName);
  } catch (error) {
    // Log but don't fail deletion
    logger.warn(`Failed to remove project server: ${error.message}`);
  }
}
```

## Related Documentation

- [../traefik/docs/ARCHITECTURE.md](../traefik/docs/ARCHITECTURE.md) - Traefik configuration
- [../docker/docs/ARCHITECTURE.md](../docker/docs/ARCHITECTURE.md) - Docker service operations
- [../deployment/docs/ARCHITECTURE.md](../deployment/docs/ARCHITECTURE.md) - Deployment orchestration
