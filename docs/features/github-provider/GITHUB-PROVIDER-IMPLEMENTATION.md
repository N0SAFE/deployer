# GitHub Provider Implementation

This document describes the GitHub provider integration for automatic deployments based on configurable rules.

## Overview

The GitHub provider allows users to:
1. Connect GitHub repositories via GitHub App installation
2. Configure deployment rules that trigger deployments automatically
3. Support multiple deployment environments (production, staging, preview, development)
4. Match deployments based on branches, tags, PRs, and custom patterns

## Database Schema

### GitHub Installations (`github_installations`)
Stores GitHub App installations per user/organization.

**Fields:**
- `installationId`: GitHub's installation ID
- `accountLogin`: GitHub username or org name
- `accountType`: "User" or "Organization"
- `permissions`: App permissions (contents, metadata, pull_requests, webhooks)
- `isActive`: Whether the installation is active

### GitHub Repositories (`github_repositories`)
Tracks repositories connected to the platform.

**Fields:**
- `repositoryId`: GitHub's repository ID
- `fullName`: owner/repo format
- `defaultBranch`: Main branch name
- `private`: Whether the repo is private

### Deployment Rules (`deployment_rules`)
Configurable rules that determine when and how deployments are triggered.

**Fields:**
- `serviceId`: Service this rule applies to
- `name`: Human-readable rule name
- `trigger`: Event type (push, pull_request, tag, release, manual)
- `isEnabled`: Whether the rule is active
- `priority`: Rule priority (higher = checked first)
- `branchPattern`: Branch matching pattern (supports wildcards)
- `excludeBranchPattern`: Branches to exclude
- `tagPattern`: Tag matching pattern
- `prLabels`: Required PR labels
- `prTargetBranches`: Allowed PR target branches
- `requireApproval`: Whether PR needs approval
- `minApprovals`: Minimum number of approvals
- `environment`: Deployment environment (production, staging, preview, development)
- `autoMergeOnSuccess`: Auto-merge PR on successful deployment
- `autoDeleteOnMerge`: Auto-delete preview environment when PR is merged
- `environmentVariables`: Custom environment variables for this rule
- `builderConfigOverride`: Override builder configuration

## Configuration Examples

### Example 1: Production Deployments on Main Branch

```typescript
{
  name: "Production from main",
  trigger: "push",
  branchPattern: "main",
  environment: "production",
  isEnabled: true,
  priority: 100
}
```

This rule triggers a production deployment whenever code is pushed to the `main` branch.

### Example 2: Preview Deployments for Feature PRs

```typescript
{
  name: "Preview for feature branches",
  trigger: "pull_request",
  branchPattern: "feature/*",
  prTargetBranches: ["main", "develop"],
  environment: "preview",
  autoDeleteOnMerge: true,
  isEnabled: true,
  priority: 50
}
```

This rule creates preview deployments for pull requests from `feature/*` branches targeting `main` or `develop`.

### Example 3: Staging Deployments for Release Tags

```typescript
{
  name: "Staging for release tags",
  trigger: "tag",
  tagPattern: "v*.*.*",
  environment: "staging",
  isEnabled: true,
  priority: 75
}
```

This rule triggers staging deployments for tags matching semantic versioning (v1.0.0, v2.1.3, etc.).

### Example 4: Preview with Required Labels

```typescript
{
  name: "Preview with deploy label",
  trigger: "pull_request",
  prLabels: ["deploy-preview", "needs-testing"],
  environment: "preview",
  requireApproval: true,
  minApprovals: 1,
  isEnabled: true,
  priority: 60
}
```

This rule creates preview deployments only for PRs with specific labels and at least one approval.

### Example 5: Multiple Environment Rules

```typescript
// Rule 1: Production (highest priority)
{
  name: "Production deployments",
  trigger: "push",
  branchPattern: "main",
  environment: "production",
  priority: 100
}

// Rule 2: Staging (medium priority)
{
  name: "Staging deployments",
  trigger: "push",
  branchPattern: "develop",
  environment: "staging",
  priority: 75
}

// Rule 3: Preview PRs (lower priority)
{
  name: "Preview PRs",
  trigger: "pull_request",
  prTargetBranches: ["main"],
  environment: "preview",
  autoDeleteOnMerge: true,
  priority: 50
}
```

## Pattern Matching

Deployment rules support glob-style patterns for branches and tags:

| Pattern | Matches | Example |
|---------|---------|---------|
| `main` | Exact match | `main` |
| `master` | Exact match | `master` |
| `feature/*` | Any feature branch | `feature/auth`, `feature/dashboard` |
| `release/*` | Any release branch | `release/1.0`, `release/2.1` |
| `v*` | Any tag starting with v | `v1.0.0`, `v2.1.3` |
| `v*.*.*` | Semantic version tags | `v1.0.0`, `v2.1.3` |
| `hotfix/*` | Hotfix branches | `hotfix/security`, `hotfix/bug` |

### Exclude Patterns

Use `excludeBranchPattern` to prevent deployments on certain branches:

```typescript
{
  branchPattern: "feature/*",      // Match all feature branches
  excludeBranchPattern: "feature/wip-*"  // Except WIP branches
}
```

## Webhook Events

The system handles these GitHub webhook events:

### Push Events
- **Trigger**: `push`
- **Matching**: Branch name against `branchPattern`
- **Use Cases**: Production, staging, development deployments

### Pull Request Events
- **Trigger**: `pull_request`
- **Actions**: `opened`, `synchronize`, `reopened`
- **Matching**: 
  - Source branch against `branchPattern`
  - Target branch against `prTargetBranches`
  - Labels against `prLabels`
- **Use Cases**: Preview environments, testing deployments

### Tag Events
- **Trigger**: `tag`
- **Matching**: Tag name against `tagPattern`
- **Use Cases**: Release deployments, versioned deployments

### Release Events
- **Trigger**: `release`
- **Actions**: `published`
- **Matching**: Release tag against `tagPattern`
- **Filters**: Excludes drafts and prereleases
- **Use Cases**: Production releases, public deployments

## Priority System

Rules are evaluated in order of priority (highest first). The first matching rule triggers the deployment.

**Priority Guidelines:**
- **100+**: Critical production rules
- **75-99**: Staging and pre-production
- **50-74**: Preview and testing environments
- **0-49**: Development and experimental deployments

## API Endpoints

### Create Deployment Rule
```typescript
POST /deployment-rules
{
  serviceId: "uuid",
  name: "Production deployments",
  trigger: "push",
  branchPattern: "main",
  environment: "production",
  priority: 100
}
```

### List Service Rules
```typescript
GET /deployment-rules?serviceId={uuid}
```

### Update Rule
```typescript
PATCH /deployment-rules/{id}
{
  isEnabled: false,
  priority: 90
}
```

### Test Rule
```typescript
POST /deployment-rules/{id}/test
{
  event: {
    type: "push",
    branch: "feature/new-feature"
  }
}
```

## Frontend Configuration

The frontend should display conditional configuration based on:

### Provider Type
- **GitHub**: Show repository URL, branch selection, deployment rules
- **Manual**: Show file upload interface
- **GitLab**: Show GitLab-specific options (future)
- **Docker Registry**: Show registry URL, image, tag (future)

### Builder Type
- **Static**: Show output directory
- **Docker/Dockerfile**: Show Dockerfile path, build args
- **Node.js**: Show build command, start command
- **Python**: Show requirements, entry point

### Configuration UI Flow

1. **Service Configuration**
   ```
   Provider: [GitHub v]
   Builder: [Static v]
   ```

2. **Provider Configuration** (conditional on GitHub)
   ```
   Repository: [Select from connected repos v]
   Default Branch: [main v]
   ```

3. **Deployment Rules**
   ```
   [+ Add Rule]
   
   Rule 1: Production deployments
   - Trigger: Push to branch
   - Branch: main
   - Environment: Production
   - [Edit] [Delete] [Toggle]
   
   Rule 2: Preview for PRs
   - Trigger: Pull request
   - Target branches: main, develop
   - Environment: Preview
   - [Edit] [Delete] [Toggle]
   ```

4. **Builder Configuration** (conditional on Static)
   ```
   Output Directory: [build]
   Build Command: [npm run build]
   ```

## Security Considerations

1. **GitHub App Permissions**: Request minimal permissions needed
2. **Webhook Validation**: Verify GitHub webhook signatures
3. **Access Control**: Users can only configure rules for their services
4. **Secret Management**: Store access tokens securely
5. **Rate Limiting**: Implement rate limits on rule creation

## Future Enhancements

1. **Manual Approval Workflows**: Require manual approval before deployment
2. **Scheduled Deployments**: Deploy at specific times
3. **Conditional Rules**: Complex rule conditions (file changes, commit messages)
4. **Multi-Environment Promotion**: Automatic promotion between environments
5. **Rollback Rules**: Automatic rollback on health check failure
6. **Notification Rules**: Custom notifications per rule
7. **GitLab Integration**: Similar rule system for GitLab
8. **Deployment Locks**: Prevent deployments during maintenance windows

## Migration Guide

For existing services using hardcoded deployment logic:

1. **Create Default Rules**: Migrate existing behavior to deployment rules
2. **Test Rules**: Use the test endpoint to verify rule matching
3. **Enable Rules**: Activate rules once tested
4. **Monitor**: Watch initial deployments for issues
5. **Optimize**: Adjust priorities and patterns as needed

## Troubleshooting

### Rule Not Triggering

1. **Check if rule is enabled**: `isEnabled: true`
2. **Verify pattern matching**: Use test endpoint
3. **Check priority**: Higher priority rules might match first
4. **Verify webhook delivery**: Check GitHub webhook logs
5. **Check service repository**: Ensure repository URL matches

### Multiple Rules Triggering

- Rules are evaluated by priority (highest first)
- Only the first matching rule triggers deployment
- Adjust priorities to control precedence

### Pattern Not Matching

- Use the test endpoint to debug pattern matching
- Check for typos in patterns
- Verify glob syntax (use `*` for wildcards)
- Test with exact branch/tag names first

## Related Documentation

- [API Contracts](../packages/api-contracts/modules/deployment-rules.ts)
- [GitHub Provider Service](../apps/api/src/modules/github/services/github-provider.service.ts)
- [Deployment Service](../apps/api/src/core/services/deployment.service.ts)
