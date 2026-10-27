# Git Module Architecture

> **Last Updated**: 2025-11-30  
> **Status**: ⚠️ PENDING MIGRATION TO PROVIDERS MODULE

## Current Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          GitModule                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                      GitService                              │   │
│  │                                                              │   │
│  │  Repository Operations:                                      │   │
│  │  ├── cloneRepository()                                       │   │
│  │  ├── validateRepository()                                    │   │
│  │  └── getCommitInfo()                                         │   │
│  │                                                              │   │
│  │  Archive Operations:                                         │   │
│  │  ├── extractUploadedFile()                                   │   │
│  │  ├── extractZip() (private)                                  │   │
│  │  └── extractTar() (private)                                  │   │
│  │                                                              │   │
│  │  Cleanup:                                                    │   │
│  │  └── cleanupDeployment()                                     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    External Dependencies                     │   │
│  │  - simple-git: Git CLI wrapper                               │   │
│  │  - tar-stream: TAR archive handling                          │   │
│  │  - child_process: ZIP extraction (unzip command)             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Problem: Separation from GitHub

Currently, `GitModule` and `GitHubModule` are separate:

```
GitModule (core/modules/git/)
└── GitService
    ├── cloneRepository()      ← Git CLI operations
    ├── extractUploadedFile()  ← Archive handling
    └── getCommitInfo()        ← Local git info

GitHubModule (core/modules/github/)
└── GitHubService
    ├── GitHub App management  ← GitHub API
    ├── OAuth handling         ← GitHub API
    ├── Webhook verification   ← GitHub API
    └── getCommit()            ← GitHub API (different from local!)
```

**Issues with Current Design:**
1. **Scattered Responsibility**: Git operations split between two modules
2. **Duplication**: Both have commit info methods (local vs API)
3. **No Clear Provider Pattern**: Not following the builder/provider registry pattern

---

## Target Architecture: Unified Provider

```
┌─────────────────────────────────────────────────────────────────────┐
│                     GitHubProviderModule (NEW)                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                 GithubProviderService                        │   │
│  │  (Implements SourceProviderInterface)                        │   │
│  │                                                              │   │
│  │  Provider Interface:                                         │   │
│  │  ├── id: 'github'                                            │   │
│  │  ├── name: 'GitHub'                                          │   │
│  │  ├── supports(config)                                        │   │
│  │  └── fetchSource(config, deploymentId)                       │   │
│  │                                                              │   │
│  │  Internal Operations:                                        │   │
│  │  ├── cloneRepository() ← From GitService                     │   │
│  │  ├── validateRepository() ← From GitService                  │   │
│  │  └── cleanupDeployment() ← From GitService                   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                                      │                    │
│         ▼                                      ▼                    │
│  ┌─────────────────┐               ┌─────────────────────┐         │
│  │ GitOperations   │               │ GitHubApiService    │         │
│  │ (internal)      │               │ (internal)          │         │
│  │                 │               │                     │         │
│  │ - simple-git    │               │ - Octokit           │         │
│  │ - tar-stream    │               │ - GitHub App        │         │
│  │ - archive utils │               │ - OAuth             │         │
│  └─────────────────┘               └─────────────────────┘         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Migration Plan

### Phase 1: Create Provider Structure

```
providers/
├── providers.module.ts              # Registry module
├── interfaces/
│   └── source-provider.interface.ts # Provider contract
├── services/
│   └── provider-registry.service.ts # Registry service
└── github/
    ├── github-provider.module.ts
    └── services/
        ├── github-provider.service.ts   # Main provider
        ├── git-operations.service.ts    # From GitService
        └── github-api.service.ts        # From GitHubService
```

### Phase 2: Move Git Operations

**From:** `git/services/git.service.ts`  
**To:** `providers/github/services/git-operations.service.ts`

```typescript
// providers/github/services/git-operations.service.ts
@Injectable()
export class GitOperationsService {
  private readonly workspaceDir: string;
  
  async cloneRepository(options: CloneOptions): Promise<string> { /* ... */ }
  async extractArchive(options: ExtractOptions): Promise<string> { /* ... */ }
  async getCommitInfo(repoPath: string): Promise<CommitInfo> { /* ... */ }
  async validateRepository(url: string): Promise<boolean> { /* ... */ }
  async cleanupWorkspace(deploymentId: string): Promise<void> { /* ... */ }
}
```

### Phase 3: Create GitHub Provider Service

```typescript
// providers/github/services/github-provider.service.ts
@Injectable()
export class GithubProviderService implements SourceProviderInterface {
  readonly id = 'github';
  readonly name = 'GitHub';
  
  constructor(
    private readonly gitOps: GitOperationsService,
    private readonly githubApi: GitHubApiService,
  ) {}
  
  supports(config: SourceConfig): boolean {
    return config.type === 'github' || config.type === 'git';
  }
  
  async fetchSource(config: SourceConfig, deploymentId: string): Promise<FetchResult> {
    // Clone repository using git operations
    const repoPath = await this.gitOps.cloneRepository({
      url: config.repositoryUrl!,
      branch: config.branch,
      commit: config.commitSha,
      deploymentId,
    });
    
    return {
      sourcePath: repoPath,
      commitSha: config.commitSha || (await this.gitOps.getCommitInfo(repoPath)).sha,
    };
  }
}
```

### Phase 4: Update Imports

```typescript
// Before (in deployment module)
import { GitModule } from '@/core/modules/git/git.module';
import { GitHubModule } from '@/core/modules/github/github.module';

// After
import { GitHubProviderModule } from '@/core/modules/providers/github/github-provider.module';
```

### Phase 5: Delete Old Modules

Once migration is complete and tested:
1. Delete `core/modules/git/` directory
2. Update `core/modules/github/` to only contain API services (or merge entirely)

---

## Provider Interface

```typescript
// providers/interfaces/source-provider.interface.ts
export interface SourceProviderInterface {
  /** Unique provider identifier */
  readonly id: string;
  
  /** Human-readable provider name */
  readonly name: string;
  
  /** Check if this provider can handle the config */
  supports(config: SourceConfig): boolean;
  
  /** Fetch source code for deployment */
  fetchSource(config: SourceConfig, deploymentId: string): Promise<FetchResult>;
  
  /** Optional: Cleanup after deployment */
  cleanup?(deploymentId: string): Promise<void>;
}

export interface SourceConfig {
  type: 'github' | 'gitlab' | 'git' | 'upload' | 'static';
  repositoryUrl?: string;
  branch?: string;
  commitSha?: string;
  filePath?: string;
  // ... other config
}

export interface FetchResult {
  sourcePath: string;
  commitSha?: string;
  metadata?: Record<string, any>;
}
```

---

## Affected Modules

| Module | Current Usage | After Migration |
|--------|--------------|-----------------|
| `OrchestrationModule` | Imports `GitService` directly | Uses `GitHubProviderModule` |
| `CoreDeploymentModule` | Imports `GitHubProviderModule` (missing!) | Uses `GitHubProviderModule` |
| `GitHubWebhookModule` | Uses `GitHubService` | Uses `GitHubApiService` |

---

## File System Layout (Current)

```
core/modules/
├── git/
│   ├── git.module.ts
│   └── services/
│       └── git.service.ts          # 180 lines
│
└── github/
    ├── github.module.ts
    ├── repositories/
    │   └── (empty or minimal)
    ├── services/
    │   ├── github.service.ts       # 350 lines
    │   └── README.md
    └── utils/
        └── (helpers)
```

## File System Layout (Target)

```
core/modules/
├── providers/
│   ├── providers.module.ts
│   ├── interfaces/
│   │   └── source-provider.interface.ts
│   ├── services/
│   │   └── provider-registry.service.ts
│   ├── github/
│   │   ├── github-provider.module.ts
│   │   └── services/
│   │       ├── github-provider.service.ts
│   │       ├── git-operations.service.ts
│   │       └── github-api.service.ts
│   └── static/
│       ├── static-provider.module.ts
│       └── services/
│           └── static-provider.service.ts
│
└── (git/ and github/ directories DELETED)
```

---

## Benefits of Migration

1. **Unified Provider Pattern**: Consistent with BuildersModule registry
2. **Clear Responsibility**: Each provider handles its source type
3. **Easier Testing**: Mock provider interface, not individual services
4. **Extensibility**: Easy to add GitLab, Bitbucket, etc.
5. **No Circular Dependencies**: Clean dependency graph
