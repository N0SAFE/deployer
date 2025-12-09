# Projects Module

> **Module Type**: CORE Service Module  
> **Priority**: MEDIUM (Infrastructure Layer)  
> **Last Updated**: 2025-11-30

## Overview

The Projects module provides project-level infrastructure management, specifically focused on per-project HTTP servers for static file serving.

## ✅ Architecture Status

This module has a **CLEAN architecture**:
- Simple, focused responsibility
- Minimal dependencies
- Clear service boundaries
- Well-documented

## Services Provided

| Service | Description |
|---------|-------------|
| `ProjectServerService` | Per-project HTTP server (lighttpd) management |

## Key Responsibilities

The `ProjectServerService` handles:

1. **Container Lifecycle**
   - Creating project-specific HTTP server containers
   - Managing container health and restarts
   - Cleaning up obsolete containers

2. **Virtual Host Configuration**
   - Setting up lighttpd vhosts for services
   - Creating symlinks to static files
   - Configuring Traefik routing

3. **Health Monitoring**
   - Container health checks
   - HTTP endpoint verification
   - Automatic recovery attempts

## Module Dependencies

```
ProjectsModule
├── TraefikCoreModule (template service)
└── DockerModule (@Global - implicit)
```

## Quick Start

```typescript
import { ProjectServerService } from '@/core/modules/projects/services/project-server.service';

@Injectable()
export class DeploymentService {
  constructor(private readonly projectServerService: ProjectServerService) {}

  async prepareDeployment(projectId: string, host: string) {
    // Ensure HTTP server exists for project
    const server = await this.projectServerService.ensureProjectServer(projectId, host);
    
    // Configure vhost for service
    await this.projectServerService.ensureVhostForService(
      projectId,
      host,
      'my-service'
    );
    
    return server;
  }
}
```

## Documentation Index

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture |

## Container Configuration

Each project gets a lighttpd container with:

```typescript
{
  image: 'rtsp/lighttpd',
  name: `project-http-${projectId}`,
  healthcheck: {
    test: ['CMD-SHELL', 'wget --quiet --tries=1 --spider http://127.0.0.1:80/ || exit 1'],
    interval: '30s',
    timeout: '10s',
    retries: 3,
  },
  volumes: ['${STATIC_FILES_VOLUME}:/srv/static:rw'],
}
```

## Static File Organization

```
/srv/static/
└── project-{projectId}/
    └── {serviceName}/
        ├── current -> deployment-{timestamp}/
        ├── deployment-20240101-120000/
        └── deployment-20240102-140000/
```

## Traefik Integration

The module generates dynamic Traefik configuration:

```yaml
http:
  routers:
    project-{projectId}-{serviceName}:
      rule: "Host(`{host}`)"
      service: "{serviceName}-svc"
      entryPoints:
        - web

  services:
    {serviceName}-svc:
      loadBalancer:
        servers:
          - url: "http://project-http-{projectId}:80"
```
