# Deployment Module

> **Module Type**: CORE Infrastructure Module  
> **Priority**: HIGH (Business Logic Layer)  
> **Last Updated**: 2025-11-30

## Overview

The Deployment module provides comprehensive deployment lifecycle management for the deployer platform. It orchestrates the entire deployment pipeline from source code fetching through building, container creation, and health monitoring.

## ✅ Provider Dependencies

This module uses the providers module for deployment source handling:

- `ProvidersModule` - Provider registry
- `GitHubProviderModule` - GitHub repository deployments
- `StaticProviderModule` - Static file deployments

**See**: [CRITICAL-ISSUES.md](../../docs/CRITICAL-ISSUES.md) for remaining architecture issues.

## Services Provided

| Service | Description |
|---------|-------------|
| `DeploymentService` | Core deployment lifecycle management |
| `DeploymentOrchestrator` | Unified deployment pipeline with provider abstraction |
| `DeploymentCleanupService` | Automated cleanup of old deployments |
| `DeploymentHealthMonitorService` | Health monitoring for active deployments |
| `DeploymentRulesService` | Deployment rule evaluation |
| `EnhancedDeploymentRulesService` | Advanced rule matching with conditions |
| `DeploymentStrategyExecutor` | Deployment strategy execution (rolling, blue-green, etc.) |
| `PreviewDeploymentService` | Preview/PR deployment management |
| `CustomConditionRegistry` | Registry for custom deployment conditions |

> **Note**: Rule matching for provider-specific events (e.g., GitHub webhooks) has been moved to feature modules. See `GitHubRuleMatcherService` in `src/modules/github/services/`.

## Repositories

| Repository | Description |
|------------|-------------|
| `DeploymentRepository` | Database operations for deployments and logs |

## Quick Start

```typescript
import { DeploymentService } from '@/core/modules/deployment/services/deployment.service';

@Injectable()
export class MyService {
  constructor(private readonly deploymentService: DeploymentService) {}

  async deploy() {
    const deployment = await this.deploymentService.createDeployment({
      serviceId: 'service-123',
      sourceType: 'github',
      sourceConfig: {
        repositoryUrl: 'https://github.com/user/repo.git',
        branch: 'main',
      },
      environment: 'production',
    });
    
    await this.deploymentService.executeDeployment(deployment.id);
  }
}
```

## Module Dependencies

```
CoreDeploymentModule
├── ScheduleModule (for cron jobs)
├── GitHubProviderModule ⚠️ (to be created)
├── StaticProviderModule ⚠️ (to be created)
├── ProvidersModule ⚠️ (to be created)
├── BuildersModule
├── TraefikCoreModule
└── (DockerModule - @Global, no import needed)
```

## Documentation Index

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture and component relationships |
| [API-REFERENCE.md](./API-REFERENCE.md) | Service API documentation |
| [DEPLOYMENT-FLOW.md](./DEPLOYMENT-FLOW.md) | Deployment pipeline flow |
| [RULES-ENGINE.md](./RULES-ENGINE.md) | Deployment rules and conditions |

## Deployment Types

| Source Type | Description |
|-------------|-------------|
| `github` | Deploy from GitHub repository |
| `gitlab` | Deploy from GitLab repository |
| `git` | Deploy from generic Git repository |
| `upload` | Deploy from uploaded archive |
| `custom` | Custom deployment source |

## Environments

| Environment | Description |
|-------------|-------------|
| `production` | Production deployment |
| `staging` | Staging deployment |
| `preview` | PR/branch preview deployment |
| `development` | Development deployment |

## Key Concepts

### Deployment Phases

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│ QUEUED   │──▶│ FETCHING │──▶│ BUILDING │──▶│ DEPLOYING│──▶│  ACTIVE  │
└──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘
                    │              │              │
                    ▼              ▼              ▼
                FAILED         FAILED         FAILED
```

### Provider Abstraction

The deployment service uses a provider abstraction to handle different source types:

```typescript
interface IDeploymentProvider {
  supports(config: ProviderConfig): boolean;
  fetchSource(config: ProviderConfig, deploymentId: string): Promise<FetchResult>;
  cleanup?(deploymentId: string): Promise<void>;
}
```

### Builder Abstraction

Build strategies are handled through the builder registry:

```typescript
interface IBuilder {
  type: string;
  supports(config: BuilderConfig): boolean;
  build(config: BuilderConfig): Promise<BuilderResult>;
}
```
