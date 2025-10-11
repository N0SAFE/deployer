# GitHub Module Services

## GitHubService

The main GitHub API integration service.

## GitHubProviderService - DO NOT CREATE HERE

**IMPORTANT**: There was previously a duplicate `github-provider.service.ts` file in this directory that caused severe NestJS dependency injection conflicts.

### Correct Location
`GitHubProviderService` is located at:
```
/apps/api/src/core/modules/providers/github/github-provider.service.ts
```

### Why Not Here?
1. **GitHubProviderService** belongs to the **providers** module hierarchy, not the GitHub module
2. Having it in two places created duplicate class definitions
3. NestJS couldn't resolve which instance to inject, causing dependency injection failures
4. The providers module exports GitHubProviderModule which should be imported by modules that need GitHubProviderService

### Module Structure
```
core/
├── modules/
│   ├── github/
│   │   ├── github.module.ts (imports GitHubProviderModule)
│   │   └── services/
│   │       └── github.service.ts (GitHub API integration)
│   └── providers/
│       └── github/
│           ├── github-provider.module.ts
│           └── github-provider.service.ts (GitHub installations & repositories)
```

### If You Need GitHubProviderService
Import `GitHubProviderModule` in your module:
```typescript
import { GitHubProviderModule } from '@/core/modules/providers/github/github-provider.module';

@Module({
  imports: [GitHubProviderModule],
  // ...
})
```

Or import the service directly in your code:
```typescript
import { GitHubProviderService } from '@/core/modules/providers/github/github-provider.service';
```

**DO NOT create a duplicate file here!**
