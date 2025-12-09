# Builders Module

> **Module Type**: CORE Infrastructure Module  
> **Priority**: HIGH (Build Infrastructure Layer)  
> **Last Updated**: 2025-11-30

## Overview

The Builders module provides a registry-based architecture for application build strategies. Each builder type (Dockerfile, Nixpack, Buildpack, Static, Docker Compose) is encapsulated in its own submodule with a common interface.

## ✅ Architecture Status

This module has a **GOOD architecture** following the registry pattern:
- Each builder is a self-contained submodule
- BuilderRegistryService provides unified access
- Clean separation of concerns

## Module Structure

```
builders/
├── builders.module.ts          # Main module
├── services/
│   └── builder-registry.service.ts
├── common/
│   └── services/
│       └── base-builder.service.ts  # Shared builder interface
├── dockerfile/
│   ├── dockerfile-builder.module.ts
│   └── services/
│       └── dockerfile-builder.service.ts
├── nixpack/
│   ├── nixpack-builder.module.ts
│   └── services/
│       └── nixpack-builder.service.ts
├── buildpack/
│   ├── buildpack-builder.module.ts
│   └── services/
│       └── buildpack-builder.service.ts
├── static/
│   ├── static-builder.module.ts
│   └── services/
│       └── static-builder.service.ts
└── docker-compose/
    ├── docker-compose-builder.module.ts
    └── services/
        └── docker-compose-builder.service.ts
```

## Services Provided

| Service | Description |
|---------|-------------|
| `BuilderRegistryService` | Central registry for all builders |
| `DockerfileBuilderService` | Builds from Dockerfile |
| `NixpackBuilderService` | Builds using Nixpacks |
| `BuildpackBuilderService` | Builds using Cloud Native Buildpacks |
| `StaticBuilderService` | Processes static files |
| `DockerComposeBuilderService` | Builds from docker-compose.yml |

## Builder Types

| Builder ID | Description | Use Case |
|------------|-------------|----------|
| `dockerfile` | Docker build | Custom Dockerfile |
| `nixpack` | Nixpacks auto-detection | Node.js, Python, Go, etc. |
| `buildpack` | Cloud Native Buildpacks | Heroku-style builds |
| `static` | Static file serving | HTML/CSS/JS sites |
| `docker-compose` | Multi-container apps | Complex applications |

## Quick Start

```typescript
import { BuilderRegistryService } from '@/core/modules/builders/services/builder-registry.service';

@Injectable()
export class DeploymentService {
  constructor(private readonly builderRegistry: BuilderRegistryService) {}

  async build(config: BuilderConfig): Promise<BuilderResult> {
    // Get appropriate builder based on project type
    const builder = this.builderRegistry.getBuilder(config.builderId);
    
    if (!builder || !builder.supports(config)) {
      throw new Error(`No builder found for: ${config.builderId}`);
    }
    
    return builder.build(config);
  }
}
```

## Builder Interface

All builders implement a common interface:

```typescript
interface IBuilder {
  /** Unique builder identifier */
  readonly id: string;
  
  /** Human-readable name */
  readonly name: string;
  
  /** Check if this builder supports the config */
  supports(config: BuilderConfig): boolean;
  
  /** Execute the build */
  build(config: BuilderConfig): Promise<BuilderResult>;
}

interface BuilderConfig {
  sourcePath: string;
  deploymentId: string;
  buildContext?: string;
  dockerfilePath?: string;
  buildArgs?: Record<string, string>;
  environmentVariables?: Record<string, string>;
  outputDirectory?: string;
  // ... builder-specific options
}

interface BuilderResult {
  success: boolean;
  imageTag?: string;
  outputPath?: string;
  logs: string[];
  metadata?: Record<string, any>;
}
```

## Builder Selection Flow

```
1. DeploymentOrchestrator receives build request
   │
2. Analyze source directory
   │  ├── Has Dockerfile? → 'dockerfile'
   │  ├── Has package.json with build? → 'nixpack'
   │  ├── Has docker-compose.yml? → 'docker-compose'
   │  └── Only static files? → 'static'
   │
3. BuilderRegistryService.getBuilder(builderId)
   │
4. builder.supports(config) → Verify compatibility
   │
5. builder.build(config) → Execute build
   │
6. Return BuilderResult with imageTag or outputPath
```

## Documentation Index

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture |
| [DOCKERFILE.md](./DOCKERFILE.md) | Dockerfile builder details |
| [NIXPACK.md](./NIXPACK.md) | Nixpack builder details |

## Registry Pattern Benefits

1. **Extensibility**: Easy to add new builders
2. **Consistency**: All builders share common interface
3. **Discovery**: Registry provides builder lookup
4. **Testability**: Mock individual builders easily
5. **Isolation**: Each builder is self-contained

## Adding a New Builder

1. Create new submodule under `builders/`:
```
builders/my-builder/
├── my-builder.module.ts
└── services/
    └── my-builder.service.ts
```

2. Implement the builder interface:
```typescript
@Injectable()
export class MyBuilderService extends BaseBuilderService {
  readonly id = 'my-builder';
  readonly name = 'My Builder';
  
  supports(config: BuilderConfig): boolean {
    return config.builderId === this.id;
  }
  
  async build(config: BuilderConfig): Promise<BuilderResult> {
    // Implementation
  }
}
```

3. Register in `BuildersModule`:
```typescript
@Module({
  imports: [
    // ... existing modules
    MyBuilderModule,
  ],
  exports: [
    // ... existing exports
    MyBuilderModule,
  ],
})
```
