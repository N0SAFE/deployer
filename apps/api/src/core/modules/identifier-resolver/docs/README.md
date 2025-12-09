# Identifier-Resolver Module

> **Status**: 🟠 HIGH Priority Issue  
> **Type**: Core Infrastructure Module  
> **Last Updated**: 2025-11-30  
> **Issues**: Cross-layer import, repository duplication

## Overview

The Identifier-Resolver module provides **shared logic for resolving entity identifiers**. It converts human-readable slugs or names to UUIDs, enabling API endpoints to accept either format for project and environment identifiers.

## ⚠️ Critical Issues

### Issue IR1: Cross-Layer Repository Import

```typescript
// identifier-resolver.module.ts - CURRENT
import { ProjectRepository } from '@/modules/project/repositories/project.repository';
//                              ^^^^^^^^^^^^
//                              Feature module import in core module ❌
```

**Problem**: Core modules should NOT import from feature modules.

**Impact**: 
- Violates architecture layering rules
- Creates hidden dependency
- Makes testing more complex

### Issue IR2: Repository Duplication

```typescript
@Module({
  providers: [
    IdentifierResolverService,
    ProjectRepository,      // ❌ Already in ProjectModule
    EnvironmentRepository,  // ❌ Should be in EnvironmentModule
  ],
})
```

**Problem**: Repositories are instantiated multiple times.

**Impact**:
- Multiple instances of same repository
- Potential state inconsistency
- DI confusion

## Architecture

```
identifier-resolver/
├── identifier-resolver.module.ts    # Module definition (needs fix)
├── services/
│   └── identifier-resolver.service.ts  # Resolution logic
└── docs/
    └── README.md                    # This file
```

## Current Implementation

### IdentifierResolverService

```typescript
@Injectable()
export class IdentifierResolverService {
  private readonly UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly environmentRepository: EnvironmentRepository,
  ) {}

  /**
   * Check if value is a valid UUID
   */
  isUUID(value: string): boolean;

  /**
   * Resolve project identifier (UUID or slug) to UUID
   */
  async resolveProjectId(projectId: string): Promise<string>;

  /**
   * Resolve environment identifier (UUID or slug) to UUID
   */
  async resolveEnvironmentId(environmentId: string, projectId?: string): Promise<string>;
}
```

## Usage Examples

### In Controllers

```typescript
@Controller('projects/:projectId/deployments')
export class DeploymentController {
  constructor(
    private readonly resolver: IdentifierResolverService,
    private readonly deploymentService: DeploymentService,
  ) {}

  @Get()
  async findAll(@Param('projectId') projectId: string) {
    // Accept either: /projects/my-project/deployments
    //            or: /projects/550e8400-e29b-41d4-a716-446655440000/deployments
    const resolvedId = await this.resolver.resolveProjectId(projectId);
    return this.deploymentService.findByProject(resolvedId);
  }
}
```

### In Services

```typescript
@Injectable()
export class DeploymentService {
  constructor(private readonly resolver: IdentifierResolverService) {}

  async deploy(projectIdentifier: string, environmentIdentifier: string) {
    const projectId = await this.resolver.resolveProjectId(projectIdentifier);
    const environmentId = await this.resolver.resolveEnvironmentId(
      environmentIdentifier,
      projectId
    );

    // Now use UUIDs for database operations
    return this.createDeployment(projectId, environmentId);
  }
}
```

### UUID Check

```typescript
async processIdentifier(identifier: string) {
  if (this.resolver.isUUID(identifier)) {
    // Fast path - already a UUID
    return this.findById(identifier);
  }
  
  // Slow path - need to resolve slug
  const uuid = await this.resolver.resolveProjectId(identifier);
  return this.findById(uuid);
}
```

## Resolution Strategy

```
Input: "my-project" or "550e8400-e29b-41d4-a716-446655440000"
                     │
                     ▼
            ┌────────────────┐
            │ Is valid UUID? │
            └───────┬────────┘
                    │
         ┌──────────┴──────────┐
         │                     │
         ▼                     ▼
    ┌─────────┐         ┌──────────────┐
    │ Return  │         │ Query by     │
    │ as-is   │         │ slug/name    │
    └─────────┘         └──────┬───────┘
                               │
                               ▼
                        ┌──────────────┐
                        │ Found?       │
                        └──────┬───────┘
                               │
                   ┌───────────┴───────────┐
                   │                       │
                   ▼                       ▼
            ┌──────────┐           ┌──────────────┐
            │ Return   │           │ Throw Error  │
            │ UUID     │           │ "Not Found"  │
            └──────────┘           └──────────────┘
```

## Proposed Fix

### Option A: Move to Feature Layer (Recommended)

Move the module out of `core/modules/` to a feature location:

```typescript
// modules/shared/identifier-resolver/identifier-resolver.module.ts
@Module({
  imports: [
    ProjectModule,      // ✅ Feature can import feature
    EnvironmentModule,  // ✅ Feature can import feature (after fix)
  ],
  providers: [IdentifierResolverService],
  exports: [IdentifierResolverService],
})
export class IdentifierResolverModule {}
```

### Option B: Interface-Based Abstraction

Keep in core but use interfaces:

```typescript
// core/modules/identifier-resolver/interfaces/project-resolver.interface.ts
export interface IProjectResolver {
  findById(id: string): Promise<{ id: string } | null>;
  findBySlug(slug: string): Promise<{ id: string } | null>;
}

export const PROJECT_RESOLVER = Symbol('PROJECT_RESOLVER');
```

```typescript
// core/modules/identifier-resolver/identifier-resolver.module.ts
@Module({
  providers: [IdentifierResolverService],
  exports: [IdentifierResolverService],
})
export class IdentifierResolverModule {
  static forRoot(options: {
    projectResolver: Provider;
    environmentResolver: Provider;
  }): DynamicModule {
    return {
      module: IdentifierResolverModule,
      providers: [
        options.projectResolver,
        options.environmentResolver,
        IdentifierResolverService,
      ],
    };
  }
}
```

```typescript
// In app.module.ts
IdentifierResolverModule.forRoot({
  projectResolver: { provide: PROJECT_RESOLVER, useClass: ProjectRepository },
  environmentResolver: { provide: ENVIRONMENT_RESOLVER, useClass: EnvironmentRepository },
})
```

### Option C: Import Modules (Simplest, After EnvironmentModule Fix)

```typescript
// identifier-resolver.module.ts - AFTER FIX
@Module({
  imports: [
    // This creates a cross-layer dependency but is explicit
    forwardRef(() => ProjectModule),  // Feature module
    EnvironmentModule,                 // Core module (after creation)
  ],
  providers: [IdentifierResolverService],
  exports: [IdentifierResolverService],
})
export class IdentifierResolverModule {}
```

## Testing

```typescript
import { Test } from '@nestjs/testing';
import { IdentifierResolverService } from './services/identifier-resolver.service';

describe('IdentifierResolverService', () => {
  let service: IdentifierResolverService;
  let mockProjectRepo: jest.Mocked<ProjectRepository>;
  let mockEnvRepo: jest.Mocked<EnvironmentRepository>;

  beforeEach(async () => {
    mockProjectRepo = {
      findById: jest.fn(),
    } as any;

    mockEnvRepo = {
      findById: jest.fn(),
      findBySlug: jest.fn(),
    } as any;

    const module = await Test.createTestingModule({
      providers: [
        IdentifierResolverService,
        { provide: ProjectRepository, useValue: mockProjectRepo },
        { provide: EnvironmentRepository, useValue: mockEnvRepo },
      ],
    }).compile();

    service = module.get(IdentifierResolverService);
  });

  describe('isUUID', () => {
    it('should return true for valid UUID', () => {
      expect(service.isUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    it('should return false for slug', () => {
      expect(service.isUUID('my-project')).toBe(false);
    });
  });

  describe('resolveProjectId', () => {
    it('should return UUID as-is', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const result = await service.resolveProjectId(uuid);
      expect(result).toBe(uuid);
      expect(mockProjectRepo.findById).not.toHaveBeenCalled();
    });

    it('should resolve slug to UUID', async () => {
      mockProjectRepo.findById.mockResolvedValue({ id: 'resolved-uuid' });
      
      const result = await service.resolveProjectId('my-project');
      
      expect(result).toBe('resolved-uuid');
    });

    it('should throw if not found', async () => {
      mockProjectRepo.findById.mockResolvedValue(null);
      
      await expect(service.resolveProjectId('unknown'))
        .rejects.toThrow('Project not found: unknown');
    });
  });
});
```

## Integration Points

| Module | Relationship | Status |
|--------|-------------|--------|
| `ProjectModule` | Dependency | ⚠️ Cross-layer (needs fix) |
| `EnvironmentModule` | Dependency | ⚠️ Direct repo import (needs fix) |
| Feature Controllers | Consumer | ✅ Works |
| `DeploymentModule` | Consumer | ✅ Works |

## Related Documentation

- [Environment Module](../../environment/docs/) - Provides EnvironmentRepository
- [CRITICAL-ISSUES.md](../../docs/CRITICAL-ISSUES.md) - Issues IR1, IR2
- [Architecture Rules](../../README.md) - Core module guidelines
