# Providers Module

> **Module Type**: CORE Infrastructure Module  
> **Status**: ✅ Active  
> **Last Updated**: 2025-11-30

## Overview

The Providers module is the central abstraction for deployment sources. It defines how the deployer platform fetches source code from various sources (GitHub, GitLab, static files, etc.) before passing them to the builder pipeline.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PROVIDERS MODULE                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │              ProviderRegistryService (Central Registry)          │    │
│  │    - Registers all providers on startup                          │    │
│  │    - Provides metadata for UI (icons, descriptions)              │    │
│  │    - Validates provider configurations                           │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                  │                                       │
│                                  ▼                                       │
│  ┌────────────────────┐  ┌────────────────────┐  ┌──────────────────┐   │
│  │  GitHubProvider    │  │  StaticProvider    │  │  (Future)        │   │
│  │  ────────────────  │  │  ────────────────  │  │  GitLabProvider  │   │
│  │  - OAuth flow      │  │  - File uploads    │  │  BitbucketProv.  │   │
│  │  - Webhooks        │  │  - Local paths     │  │  S3Provider      │   │
│  │  - Change detect   │  │  - SPA support     │  │  ...             │   │
│  └────────────────────┘  └────────────────────┘  └──────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Module Structure

```
providers/
├── providers.module.ts           # Main aggregating module
├── index.ts                      # Barrel exports
├── interfaces/
│   └── provider.interface.ts     # IDeploymentProvider, IWebhookProvider, IOAuthProvider
├── services/
│   ├── provider-registry.service.ts         # Central provider registry
│   └── provider-registry-initializer.service.ts  # Auto-registers providers on startup
├── common/
│   └── services/
│       └── base-provider.service.ts         # Abstract base class for providers
├── github/
│   ├── github-provider.module.ts
│   ├── github-provider.service.ts           # Implements IDeploymentProvider + IWebhookProvider + IOAuthProvider
│   ├── repositories/
│   │   └── github-provider.repository.ts
│   └── services/
│       ├── github-repository-config.service.ts
│       ├── github-change-detection.service.ts
│       ├── github-deployment-cache.service.ts
│       ├── github-deployment-rules.service.ts
│       └── github-deployment-rules-data.service.ts
└── static/
    ├── static-provider.module.ts
    ├── static-provider.service.ts           # Implements IDeploymentProvider
    ├── repositories/
    │   └── static-provider.repository.ts
    └── services/
        └── static-file-serving.service.ts
```

## Provider Interface

All providers must implement `IDeploymentProvider`:

```typescript
interface IDeploymentProvider {
  readonly name: string;
  readonly type: 'github' | 'gitlab' | 'git' | 'static' | 'docker-registry' | 's3' | 'custom';

  fetchSource(config: ProviderConfig, trigger: DeploymentTrigger): Promise<SourceFiles>;
  validateConfig(config: ProviderConfig): Promise<{ valid: boolean; errors?: string[] }>;
  shouldSkipDeployment(config: ProviderConfig, trigger: DeploymentTrigger): Promise<{ shouldSkip: boolean; reason: string }>;
  getDeploymentVersion(source: SourceFiles): string;
  getTraefikTemplate(): string;
}
```

### Extended Interfaces

**Webhook Support** (`IWebhookProvider`):
```typescript
interface IWebhookProvider extends IDeploymentProvider {
  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean;
  parseWebhookPayload(event: string, payload: Record<string, any>): Promise<DeploymentTrigger | null>;
  registerWebhook?(config: ProviderConfig, webhookUrl: string, events: string[]): Promise<{ webhookId: string; secret: string }>;
}
```

**OAuth Support** (`IOAuthProvider`):
```typescript
interface IOAuthProvider extends IDeploymentProvider {
  getAuthorizationUrl(redirectUri: string, state: string): string;
  exchangeCodeForToken(code: string, redirectUri: string): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }>;
  refreshAccessToken?(refreshToken: string): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }>;
}
```

## Services Provided

### ProviderRegistryService

Central registry for all providers:

| Method | Description |
|--------|-------------|
| `registerProvider(provider)` | Register a provider instance |
| `getAllProviders()` | Get metadata for all providers (for UI) |
| `getProvider(id)` | Get provider instance by ID |
| `getProviderSchema(id)` | Get configuration schema for forms |
| `validateProviderConfig(id, config)` | Validate provider configuration |

### GithubProviderService

Full-featured GitHub provider with:

| Feature | Description |
|---------|-------------|
| **OAuth** | Full OAuth flow for user authorization |
| **Webhooks** | Signature verification, payload parsing |
| **Installations** | GitHub App installation management |
| **Repositories** | Repository listing and access |
| **Change Detection** | Monorepo-aware change detection |
| **Deployment Cache** | Skip redundant deployments |
| **Traefik Templates** | Pre-built routing configuration |

### StaticProviderService

Static file deployment with:

| Feature | Description |
|---------|-------------|
| **File Serving** | Nginx-based static file serving |
| **SPA Support** | Single Page Application routing |
| **Project Servers** | Shared project-level HTTP servers |
| **Direct Copy** | Host-mounted volume support |
| **Pruning** | Automatic old deployment cleanup |

## Quick Start

### Using Provider Registry

```typescript
import { ProviderRegistryService } from '@/core/modules/providers/services/provider-registry.service';

@Injectable()
export class DeploymentOrchestrator {
  constructor(private readonly providerRegistry: ProviderRegistryService) {}

  async deploy(providerId: string, config: ProviderConfig, trigger: DeploymentTrigger) {
    const provider = this.providerRegistry.getProvider(providerId);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    // Validate configuration
    const validation = await provider.validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid config: ${validation.errors?.join(', ')}`);
    }

    // Check if we should skip (cache)
    const skipCheck = await provider.shouldSkipDeployment(config, trigger);
    if (skipCheck.shouldSkip) {
      return { skipped: true, reason: skipCheck.reason };
    }

    // Fetch source files
    const source = await provider.fetchSource(config, trigger);
    
    // Pass to builder pipeline...
    return source;
  }
}
```

### Using GitHub Provider Directly

```typescript
import { GithubProviderService } from '@/core/modules/providers';

@Injectable()
export class GitHubWebhookHandler {
  constructor(private readonly githubProvider: GithubProviderService) {}

  async handleWebhook(event: string, payload: any, signature: string) {
    // Get installation for signature verification
    const installation = await this.githubProvider.getInstallationByOrganization(
      payload.repository?.owner?.login
    );

    // Verify signature
    if (!this.githubProvider.verifyWebhookSignature(
      JSON.stringify(payload), 
      signature, 
      installation.webhookSecret
    )) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // Parse webhook into deployment trigger
    const trigger = await this.githubProvider.parseWebhookPayload(event, payload);
    if (!trigger) {
      return { ignored: true };
    }

    // Find matching services
    const matches = await this.githubProvider.findMatchingServices(payload);
    
    // Create deployments for matching services...
  }
}
```

## Documentation Index

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Detailed architecture and data flow |
| [GITHUB-PROVIDER.md](./GITHUB-PROVIDER.md) | GitHub provider specifics |
| [STATIC-PROVIDER.md](./STATIC-PROVIDER.md) | Static provider specifics |
| [ADDING-PROVIDERS.md](./ADDING-PROVIDERS.md) | Guide to adding new providers |

## Dependencies

```
ProvidersModule
├── DatabaseModule (for repositories)
├── GitHubProviderModule
│   ├── DatabaseModule
│   └── (uses external GitHub repositories from core/modules/github)
└── StaticProviderModule
    ├── DatabaseModule
    ├── ProjectsModule (ProjectServerService)
    └── OrchestrationModule (TraefikService)
```

## Known Issues & Improvements

### 🟡 Minor Issues

1. **GitHub Clone Not Implemented**: `cloneRepository()` in GithubProviderService is a TODO placeholder
2. **Repository Storage Gap**: `storeRepository()` doesn't persist to DB (requires project association)
3. **Cross-Module Repository Imports**: Uses repositories from `core/modules/github/` instead of local

### 🟢 Future Enhancements

1. **Add GitLab Provider**: Similar to GitHub with GitLab API
2. **Add S3 Provider**: Deploy from S3 bucket
3. **Add Docker Registry Provider**: Pull pre-built images
4. **Provider Plugins**: Dynamic provider loading

## Configuration Schema

Providers expose configuration schemas for dynamic form generation:

```typescript
const schema = providerRegistry.getProviderSchema('github');
// Returns ConfigSchema with fields for:
// - repositoryUrl, branch, accessToken
// - useMonorepo, basePath, watchPaths
// - enableCache, cacheStrategy
```

See `IProvider.getConfigSchema()` for the full schema interface.
