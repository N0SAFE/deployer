# Git Module

> **Module Type**: CORE Infrastructure Module (🟠 TO BE DEPRECATED)  
> **Last Updated**: 2025-01-16

## 🟠 DEPRECATION NOTICE

**This module is scheduled to be merged into the Providers module.**

The Git functionality should become part of a unified `GitHubProviderModule` that combines:
- Git repository operations (clone, extract, commit info)
- GitHub API operations (webhooks, OAuth, deployments)

**See**: 
- [ARCHITECTURE.md](./ARCHITECTURE.md) for the migration plan
- [CRITICAL-ISSUES.md](../../docs/CRITICAL-ISSUES.md#-issue-3-gitgithub-modules-scattered-responsibility) for tracking

## Current Overview

The Git module provides basic Git repository operations for deployments:

- Repository cloning
- Archive extraction (zip, tar, tar.gz)
- Commit information retrieval
- Workspace cleanup

## Services Provided

| Service | Description |
|---------|-------------|
| `GitService` | Git repository and file extraction operations |

## Quick Start

```typescript
import { GitService } from '@/core/modules/git/services/git.service';

@Injectable()
export class MyService {
  constructor(private readonly gitService: GitService) {}

  async cloneRepo() {
    const repoPath = await this.gitService.cloneRepository({
      url: 'https://github.com/user/repo.git',
      branch: 'main',
      deploymentId: 'deploy-123',
    });
  }
}
```

## API Reference

### cloneRepository

Clones a Git repository to a local workspace directory.

```typescript
async cloneRepository(options: {
  url: string;
  branch?: string;
  commit?: string;
  deploymentId: string;
}): Promise<string>
```

**Parameters:**
| Name | Type | Default | Description |
|------|------|---------|-------------|
| `url` | `string` | - | Repository URL |
| `branch` | `string` | `'main'` | Branch to clone |
| `commit` | `string` | - | Specific commit SHA to checkout |
| `deploymentId` | `string` | - | Deployment ID (used for directory name) |

**Returns:** Path to the cloned repository

**Implementation Details:**
- Uses shallow clone (`--depth 1`) for efficiency
- Cleans up existing directory if present
- Supports commit checkout after clone

---

### extractUploadedFile

Extracts an uploaded archive file.

```typescript
async extractUploadedFile(options: {
  filePath: string;
  deploymentId: string;
}): Promise<string>
```

**Supported Formats:**
- `.zip` - Uses `unzip` command
- `.tar` - Uses tar-stream library
- `.gz`, `.tgz` - Uses tar-stream with gzip decompression

**Returns:** Path to extracted contents

---

### getCommitInfo

Gets information about the latest commit in a repository.

```typescript
async getCommitInfo(repoPath: string): Promise<{
  sha: string;
  message: string;
  author: string;
  date: Date;
}>
```

---

### cleanupDeployment

Removes the workspace directory for a deployment.

```typescript
async cleanupDeployment(deploymentId: string): Promise<void>
```

---

### validateRepository

Validates that a repository URL is accessible.

```typescript
async validateRepository(url: string): Promise<boolean>
```

**Implementation:** Uses `git ls-remote` to check accessibility

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `WORKSPACE_DIR` | `/tmp/deployer-workspace` | Base directory for cloned repositories |

## Documentation Index

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Current architecture and migration plan |
| [MIGRATION.md](./MIGRATION.md) | Steps to migrate to Providers module |
