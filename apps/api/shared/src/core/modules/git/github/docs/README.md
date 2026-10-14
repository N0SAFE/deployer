# GitHub Module

> **Module Type**: CORE Infrastructure Module (🟠 TO BE REFACTORED)  
> **Last Updated**: 2025-01-16

## 🟠 REFACTORING NOTICE

**This module's services should be merged with the Git module into a unified Providers structure.**

The target is to create `GitHubProviderModule` that combines:
- GitHub API operations (webhooks, OAuth, deployments) 
- Git operations (clone, extract) from GitModule

**See**: 
- [ARCHITECTURE.md](./ARCHITECTURE.md) for the migration plan
- [CRITICAL-ISSUES.md](../../docs/CRITICAL-ISSUES.md#-issue-3-gitgithub-modules-scattered-responsibility) for tracking

## Current Overview

The GitHub module provides GitHub API integration services:

- Multi-organization GitHub App management
- OAuth authentication flow
- Webhook signature verification
- Repository and installation operations
- Deployment status updates

## Services Provided

| Service | Description |
|---------|-------------|
| `GitHubService` | GitHub API client with multi-org App support |

## Quick Start

```typescript
import { GitHubService } from '@/core/modules/github/services/github.service';

@Injectable()
export class MyService {
  constructor(private readonly githubService: GitHubService) {}

  async listRepos(orgLogin: string, installationId: number) {
    const repos = await this.githubService.listInstallationRepositories(
      orgLogin,
      installationId
    );
    return repos;
  }
}
```

## Architecture Principles

**This is a CORE module - it should ONLY provide services:**
- NO controllers (moved to feature modules)
- NO processors (moved to feature modules)

Controllers and processors have been moved to:
- `GitHubOAuthModule` (feature module) - OAuth flow
- `GitHubWebhookModule` (feature module) - Webhook handling

## API Reference

### App Management

#### registerInstallation

Registers a GitHub App installation for an organization.

```typescript
registerInstallation(organizationLogin: string, config: GitHubAppConfig): void
```

**GitHubAppConfig:**
```typescript
interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  clientId?: string;
  clientSecret?: string;
  webhookSecret?: string;
}
```

---

#### hasAppForOrganization

Checks if an organization has a registered GitHub App.

```typescript
hasAppForOrganization(organizationLogin: string): boolean
```

---

#### unregisterInstallation

Removes a GitHub App registration.

```typescript
unregisterInstallation(organizationLogin: string): void
```

---

#### getRegisteredOrganizations

Lists all organizations with registered apps.

```typescript
getRegisteredOrganizations(): string[]
```

---

### Authentication

#### verifyWebhookSignature

Verifies a GitHub webhook signature.

```typescript
async verifyWebhookSignature(
  payload: string,
  signature: string,
  webhookSecret?: string
): Promise<boolean>
```

---

#### exchangeCodeForToken

Exchanges OAuth code for access token.

```typescript
async exchangeCodeForToken(
  organizationLogin: string,
  code: string
): Promise<{
  access_token: string;
  token_type: string;
  scope: string;
}>
```

---

#### getInstallationAccessToken

Gets an installation access token.

```typescript
async getInstallationAccessToken(
  organizationLogin: string,
  installationId: number
): Promise<string>
```

---

### Repository Operations

#### listInstallationRepositories

Lists repositories accessible by an installation.

```typescript
async listInstallationRepositories(
  organizationLogin: string,
  installationId: number
): Promise<Array<{
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  description: string | null;
  html_url: string;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
}>>
```

---

#### getRepository

Gets repository information.

```typescript
async getRepository(
  owner: string,
  repo: string,
  organizationLogin?: string,
  installationId?: number
): Promise<RepositoryInfo>
```

---

#### getCommit

Gets commit information.

```typescript
async getCommit(
  owner: string,
  repo: string,
  sha: string,
  organizationLogin?: string,
  installationId?: number
): Promise<{
  sha: string;
  message: string;
  author: {
    name: string;
    email: string;
    date: string;
  };
  url: string;
}>
```

---

### Deployment Status

#### createDeploymentStatus

Creates a GitHub deployment status.

```typescript
async createDeploymentStatus(
  owner: string,
  repo: string,
  deploymentId: number,
  state: 'error' | 'failure' | 'inactive' | 'in_progress' | 'queued' | 'pending' | 'success',
  organizationLogin: string,
  installationId: number,
  options?: {
    description?: string;
    environment_url?: string;
    log_url?: string;
  }
): Promise<void>
```

---

### Octokit Access

#### getInstallationOctokit

Gets an authenticated Octokit instance for an installation.

```typescript
async getInstallationOctokit(
  organizationLogin: string,
  installationId: number
): Promise<Octokit>
```

---

#### getOctokitWithToken

Gets an Octokit instance with personal access token.

```typescript
getOctokitWithToken(token: string): Octokit
```

---

#### getPublicOctokit

Gets an unauthenticated Octokit instance.

```typescript
getPublicOctokit(): Octokit
```

## Configuration

| Environment Variable | Required | Description |
|---------------------|----------|-------------|
| `GITHUB_WEBHOOK_SECRET` | No | Default webhook secret for signature verification |

## Documentation Index

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Current architecture and migration plan |
| [services/README.md](./services/README.md) | Service integration guide |
