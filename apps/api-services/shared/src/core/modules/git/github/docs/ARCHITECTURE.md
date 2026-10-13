# GitHub Module Architecture

> **Last Updated**: 2025-11-30  
> **Status**: ⚠️ PENDING MIGRATION TO PROVIDERS MODULE

## Current Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        GitHubModule                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    GitHubService                             │   │
│  │                                                              │   │
│  │  App Management:                                             │   │
│  │  ├── registerInstallation()                                  │   │
│  │  ├── getAppForOrganization()                                 │   │
│  │  ├── hasAppForOrganization()                                 │   │
│  │  └── unregisterInstallation()                                │   │
│  │                                                              │   │
│  │  Authentication:                                             │   │
│  │  ├── verifyWebhookSignature()                                │   │
│  │  ├── exchangeCodeForToken()                                  │   │
│  │  └── getInstallationAccessToken()                            │   │
│  │                                                              │   │
│  │  Repository Operations:                                      │   │
│  │  ├── listInstallationRepositories()                          │   │
│  │  ├── getRepository()                                         │   │
│  │  ├── getCommit()                                             │   │
│  │  └── getInstallation()                                       │   │
│  │                                                              │   │
│  │  Deployment Integration:                                     │   │
│  │  └── createDeploymentStatus()                                │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    External Dependencies                     │   │
│  │  - @octokit/rest: GitHub REST API client                     │   │
│  │  - @octokit/app: GitHub App authentication                   │   │
│  │  - @octokit/webhooks: Webhook signature verification         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Multi-Organization Support

The service supports multiple GitHub App installations:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        GitHubService                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  apps: Map<string, App>                                            │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │  "org-alpha" → App { appId: "123", privateKey: "..." }   │      │
│  │  "org-beta"  → App { appId: "456", privateKey: "..." }   │      │
│  │  "org-gamma" → App { appId: "789", privateKey: "..." }   │      │
│  └──────────────────────────────────────────────────────────┘      │
│                                                                     │
│  Each organization can have its own GitHub App configuration,      │
│  allowing the platform to integrate with multiple GitHub orgs.     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Problem: Separation from Git Operations

Currently, Git operations and GitHub API are in separate modules:

```
GitModule                          GitHubModule
├── GitService                     ├── GitHubService
│   ├── cloneRepository()          │   ├── GitHub App management
│   ├── extractUploadedFile()      │   ├── OAuth handling
│   └── getCommitInfo() (LOCAL)    │   ├── getCommit() (API)
│                                  │   └── listInstallationRepositories()
```

**Issues:**
1. **Two commit info methods**: Local git vs GitHub API
2. **Unclear which to use**: For GitHub deployments, both are needed
3. **No unified provider**: Doesn't follow builder/provider pattern

---

## Target Architecture: Unified Provider

### Provider Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│                     GitHubProviderModule                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                 GithubProviderService                        │   │
│  │  (Implements SourceProviderInterface)                        │   │
│  │                                                              │   │
│  │  Provider Interface:                                         │   │
│  │  ├── id: 'github'                                            │   │
│  │  ├── name: 'GitHub'                                          │   │
│  │  ├── supports(config) → boolean                              │   │
│  │  └── fetchSource(config, deploymentId) → FetchResult         │   │
│  │                                                              │   │
│  │  GitHub-Specific:                                            │   │
│  │  ├── registerInstallation()                                  │   │
│  │  ├── verifyWebhook()                                         │   │
│  │  ├── getInstallationOctokit()                                │   │
│  │  └── createDeploymentStatus()                                │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                                      │                    │
│         ▼                                      ▼                    │
│  ┌─────────────────┐               ┌─────────────────────┐         │
│  │GitOperationsService│            │ GitHubApiService    │         │
│  │                 │               │                     │         │
│  │ From GitService:│               │ From GitHubService: │         │
│  │ - cloneRepository│              │ - App management    │         │
│  │ - extractArchive │              │ - OAuth             │         │
│  │ - getCommitInfo  │              │ - Webhook           │         │
│  │ - cleanup        │              │ - Repository ops    │         │
│  └─────────────────┘               └─────────────────────┘         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Provider Interface Implementation

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
    return config.type === 'github' || 
           (config.type === 'git' && this.isGitHubUrl(config.repositoryUrl));
  }
  
  async fetchSource(config: GitHubSourceConfig, deploymentId: string): Promise<FetchResult> {
    // For GitHub App installations, get auth first
    let authToken: string | undefined;
    if (config.installationId && config.organizationLogin) {
      authToken = await this.githubApi.getInstallationAccessToken(
        config.organizationLogin,
        config.installationId
      );
    }
    
    // Clone the repository
    const repoPath = await this.gitOps.cloneRepository({
      url: config.repositoryUrl!,
      branch: config.branch,
      commit: config.commitSha,
      deploymentId,
      authToken, // Use installation token for private repos
    });
    
    // Get commit info (prefer local for speed)
    const commitInfo = await this.gitOps.getCommitInfo(repoPath);
    
    // Update deployment status on GitHub
    if (config.installationId && config.organizationLogin && config.githubDeploymentId) {
      await this.githubApi.createDeploymentStatus(
        config.owner!,
        config.repo!,
        config.githubDeploymentId,
        'in_progress',
        config.organizationLogin,
        config.installationId
      );
    }
    
    return {
      sourcePath: repoPath,
      commitSha: commitInfo.sha,
      metadata: {
        author: commitInfo.author,
        message: commitInfo.message,
        date: commitInfo.date,
      },
    };
  }
  
  async cleanup(deploymentId: string): Promise<void> {
    await this.gitOps.cleanupDeployment(deploymentId);
  }
  
  // ─────────────────────────────────────────────────────────────────
  // GitHub-Specific Methods (not part of SourceProviderInterface)
  // ─────────────────────────────────────────────────────────────────
  
  registerInstallation(orgLogin: string, config: GitHubAppConfig): void {
    return this.githubApi.registerInstallation(orgLogin, config);
  }
  
  async verifyWebhookSignature(payload: string, signature: string): Promise<boolean> {
    return this.githubApi.verifyWebhookSignature(payload, signature);
  }
  
  async getInstallationOctokit(orgLogin: string, installationId: number) {
    return this.githubApi.getInstallationOctokit(orgLogin, installationId);
  }
}
```

---

## Migration Steps

### Step 1: Create GitHubApiService

Extract API-only methods from current GitHubService:

```typescript
// providers/github/services/github-api.service.ts
@Injectable()
export class GitHubApiService {
  private readonly apps = new Map<string, App>();
  private readonly webhooks: Webhooks;
  
  // All current GitHubService methods EXCEPT:
  // - Those that will be in GitOperationsService
}
```

### Step 2: Create GitOperationsService

Move from GitService + enhance for private repos:

```typescript
// providers/github/services/git-operations.service.ts
@Injectable()
export class GitOperationsService {
  async cloneRepository(options: {
    url: string;
    branch?: string;
    commit?: string;
    deploymentId: string;
    authToken?: string;  // NEW: For private repo access
  }): Promise<string>
  
  // ... rest of GitService methods
}
```

### Step 3: Create GithubProviderService

Combine both services into provider interface:

```typescript
// providers/github/services/github-provider.service.ts
@Injectable()
export class GithubProviderService implements SourceProviderInterface {
  constructor(
    private readonly gitOps: GitOperationsService,
    private readonly githubApi: GitHubApiService,
  ) {}
  
  // Provider interface + GitHub-specific methods
}
```

### Step 4: Create Module

```typescript
// providers/github/github-provider.module.ts
@Module({
  providers: [
    GitOperationsService,
    GitHubApiService,
    GithubProviderService,
  ],
  exports: [
    GithubProviderService,
    GitHubApiService,  // For direct API access in webhooks
  ],
})
export class GitHubProviderModule {}
```

### Step 5: Update Dependent Modules

```typescript
// Before
import { GitModule } from '@/core/modules/git/git.module';
import { GitHubModule } from '@/core/modules/github/github.module';

// After
import { GitHubProviderModule } from '@/core/modules/providers/github/github-provider.module';
```

### Step 6: Delete Old Modules

- Remove `core/modules/git/`
- Remove `core/modules/github/`

---

## Data Flow: GitHub Deployment

### Current (Fragmented)

```
1. Webhook received (GitHubWebhookController)
   │
2. GitHubService.verifyWebhookSignature()
   │
3. DeploymentService creates deployment
   │
4. GitService.cloneRepository() ← Different module!
   │
5. BuilderService.build()
   │
6. GitHubService.createDeploymentStatus() ← Back to GitHub module
```

### Target (Unified)

```
1. Webhook received (GitHubWebhookController)
   │
2. GithubProviderService.verifyWebhookSignature()
   │
3. DeploymentOrchestrator initiates deployment
   │
4. GithubProviderService.fetchSource()
   │   ├── Internal: cloneRepository with auth token
   │   └── Internal: update deployment status
   │
5. BuilderService.build()
   │
6. GithubProviderService.updateDeploymentStatus('success')
```

---

## Provider Registry Integration

```
┌─────────────────────────────────────────────────────────────────────┐
│                       ProvidersModule                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                 ProviderRegistryService                      │   │
│  │                                                              │   │
│  │  providers: Map<string, SourceProviderInterface>             │   │
│  │  ┌────────────────────────────────────────────────────┐     │   │
│  │  │  'github' → GithubProviderService                  │     │   │
│  │  │  'static' → StaticProviderService                  │     │   │
│  │  │  'gitlab' → GitLabProviderService (future)         │     │   │
│  │  └────────────────────────────────────────────────────┘     │   │
│  │                                                              │   │
│  │  register(provider: SourceProviderInterface)                 │   │
│  │  get(id: string): SourceProviderInterface                    │   │
│  │  getForConfig(config: SourceConfig): SourceProviderInterface │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Benefits of Migration

1. **Single Source of Truth**: One module for all GitHub-related operations
2. **Consistent Pattern**: Follows BuildersModule registry pattern
3. **Cleaner Dependencies**: No scattered imports
4. **Better Testability**: Mock single provider interface
5. **Extensibility**: Easy to add GitLab, Bitbucket providers
6. **Private Repo Support**: Auth token flows through single service
