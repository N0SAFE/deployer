# Conflict Resolution

> **Last Updated**: 2025-11-30

## Overview

The domain module includes a conflict detection system that prevents URL collisions when mapping services to domains. The `DomainConflictService` checks for conflicts and provides suggestions for available alternatives.

## What is a Conflict?

A conflict occurs when two services try to use the same URL (same combination of project domain, subdomain, and base path).

```
Conflict Example:
Service A → api.example.com/v1  ← Already exists
Service B → api.example.com/v1  ← CONFLICT! Same URL
```

## Conflict Detection

### Check Availability

Before creating or updating a service domain mapping, always check availability:

```typescript
const availability = await conflictService.checkSubdomainAvailability(
  projectDomainId,      // Target project domain
  subdomain,            // Requested subdomain (can be multi-level like "staging.api")
  basePath,             // Requested base path
  excludeServiceId      // Optional: exclude current service when updating
);

interface SubdomainAvailabilityResult {
  available: boolean;                    // Can this URL be used?
  conflicts: SubdomainConflict[];        // Existing conflicting mappings
  suggestions: {
    availableBasePaths: string[];        // Suggested alternative paths
    message: string;                     // Human-readable explanation
  };
}
```

### Conflict Types

#### 1. Exact Match Conflict

Same subdomain AND same base path:

```typescript
// Existing: api.example.com/v1 → Service A
// Request:  api.example.com/v1 → Service B
// Result: CONFLICT

{
  available: false,
  conflicts: [{
    serviceId: 'svc_a',
    serviceName: 'Service A',
    subdomain: 'api',
    basePath: '/v1',
    fullUrl: 'https://api.example.com/v1'
  }],
  suggestions: {
    availableBasePaths: [],
    message: 'This exact URL is already in use. Please choose a different subdomain or base path.'
  }
}
```

#### 2. Root Path Conflict

Requesting root path when subdomain already has a root mapping:

```typescript
// Existing: api.example.com/ → Service A (root path)
// Request:  api.example.com/ → Service B
// Result: CONFLICT

{
  available: false,
  conflicts: [{
    serviceId: 'svc_a',
    subdomain: 'api',
    basePath: null,
    fullUrl: 'https://api.example.com/'
  }],
  suggestions: {
    availableBasePaths: ['/v1', '/v2', '/api', '/app'],
    message: 'This subdomain is already used without a base path. Add a base path to differentiate your service.'
  }
}
```

#### 3. Shared Subdomain (Not a Conflict)

Same subdomain but different base paths is ALLOWED:

```typescript
// Existing: api.example.com/v1 → Service A
// Request:  api.example.com/v2 → Service B
// Result: AVAILABLE (shared subdomain)

{
  available: true,
  conflicts: [{
    serviceId: 'svc_a',
    subdomain: 'api',
    basePath: '/v1',
    fullUrl: 'https://api.example.com/v1'
  }],
  suggestions: {
    availableBasePaths: ['/v3', '/api', '/app', '/admin'],
    message: 'This subdomain is shared with 1 other service(s) using different base paths.'
  }
}
```

## Subdomain Validation

### Format Rules

Subdomains must follow DNS naming conventions:

```typescript
validateSubdomain(subdomain: string): { valid: boolean; error?: string }
```

**Rules**:
- Start with alphanumeric character
- End with alphanumeric character
- Can contain hyphens (`-`) in the middle
- Each label max 63 characters
- Can be multi-level (e.g., `staging.api`, `v2.staging.api`)

**Valid Examples**:
```
api
www
my-service
staging-api
v2
staging.api           ← Multi-level
feature-123.dev.api   ← Multi-level
```

**Invalid Examples**:
```
-api           ← Starts with hyphen
api-           ← Ends with hyphen
my_service     ← Contains underscore
my..service    ← Double dot
```

### Multi-Level Subdomain Validation

For multi-level subdomains, each label is validated separately:

```typescript
function validateSubdomain(subdomain: string): { valid: boolean; error?: string } {
  if (!subdomain) {
    return { valid: true }; // null/empty is valid (root domain)
  }

  // Split multi-level subdomain into labels
  const labels = subdomain.split('.');
  
  for (const label of labels) {
    if (label.length > 63) {
      return { valid: false, error: 'Each subdomain label must be 63 characters or less' };
    }
    
    const labelRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i;
    if (!labelRegex.test(label)) {
      return { 
        valid: false, 
        error: `Label "${label}" must start and end with alphanumeric characters` 
      };
    }
  }

  return { valid: true };
}
```

## Base Path Validation

### Format Rules

```typescript
validateBasePath(basePath: string): { valid: boolean; error?: string }
```

**Rules**:
- Must start with `/`
- Must not end with `/` (except root `/`)
- Max 255 characters
- Should be URL-safe

**Valid Examples**:
```
/
/v1
/api
/api/v1
/users/admin
```

**Invalid Examples**:
```
v1           ← Missing leading slash
/api/        ← Trailing slash (not root)
```

## Using the Conflict Service

### In Controllers

```typescript
@Implement(domainContract.addServiceDomain)
addServiceDomain() {
  return implement(domainContract.addServiceDomain).handler(async ({ input }) => {
    // Verify project domain exists
    const projectDomain = await this.projectDomainRepository.findById(input.projectDomainId);
    if (!projectDomain) {
      throw new Error(`Project domain ${input.projectDomainId} not found`);
    }

    // Check subdomain availability
    const availabilityCheck = await this.conflictService.checkSubdomainAvailability(
      input.projectDomainId,
      input.subdomain,
      input.basePath || null
    );

    if (!availabilityCheck.available) {
      const suggestions = availabilityCheck.suggestions.availableBasePaths.join(', ') || 'none';
      throw new Error(
        `Subdomain+path combination already in use. Available base paths: ${suggestions}`
      );
    }

    // Create the mapping
    const mapping = await this.serviceMappingRepository.create({
      serviceId: input.serviceId,
      projectDomainId: input.projectDomainId,
      subdomain: input.subdomain,
      basePath: input.basePath || null,
      // ...
    });

    return mapping;
  });
}
```

### When Updating

```typescript
// When updating, exclude the current mapping from conflict check
if (input.subdomain !== undefined || input.basePath !== undefined) {
  const availabilityCheck = await this.conflictService.checkSubdomainAvailability(
    mapping.projectDomainId,
    input.subdomain ?? mapping.subdomain,
    input.basePath ?? mapping.basePath,
    mapping.id  // ← Exclude this mapping from check
  );

  if (!availabilityCheck.available) {
    throw new Error('New URL already in use');
  }
}
```

## Conflict Resolution Strategies

### Strategy 1: Use Different Base Path

```
Existing: api.example.com/v1
Solution: api.example.com/v2
```

### Strategy 2: Use Different Subdomain

```
Existing: api.example.com/
Solution: api-v2.example.com/
```

### Strategy 3: Use Multi-Level Subdomain

```
Existing: api.example.com/
Solution: v2.api.example.com/
```

### Strategy 4: Use Nested Environment Subdomain

```
Existing: api.example.com/v1       (production)
Solution: staging.api.example.com/v1  (staging)
         dev.api.example.com/v1       (development)
```

## Auto-Suggestions

The conflict service automatically generates path suggestions:

```typescript
private generateAvailableBasePaths(usedPaths: string[]): string[] {
  const commonPaths = ['/v1', '/v2', '/v3', '/api', '/app', '/web', '/admin', '/dashboard'];
  return commonPaths.filter(path => !usedPaths.includes(path));
}
```

### Custom Suggestions

For more intelligent suggestions, consider:

```typescript
// Future enhancement: Context-aware suggestions
function generateSmartSuggestions(
  existingMappings: ServiceDomainMapping[],
  serviceName: string,
  serviceType: 'api' | 'web' | 'admin'
): string[] {
  const suggestions: string[] = [];
  
  // Service-type based suggestions
  if (serviceType === 'api') {
    suggestions.push('/api', '/v1', '/v2');
  } else if (serviceType === 'admin') {
    suggestions.push('/admin', '/dashboard', '/manage');
  }
  
  // Version-based suggestions
  const maxVersion = findMaxVersion(existingMappings);
  suggestions.push(`/v${maxVersion + 1}`);
  
  // Service name based
  suggestions.push(`/${serviceName.toLowerCase()}`);
  
  return filterAvailable(suggestions, existingMappings);
}
```

## Conflict Detection Implementation

```typescript
async checkSubdomainAvailability(
  projectDomainId: string,
  subdomain: string | null,
  basePath: string | null,
  excludeServiceId?: string
): Promise<SubdomainAvailabilityResult> {
  try {
    // Find all mappings for this project domain with same subdomain
    const existingMappings = await this.serviceDomainMappingService
      .findByProjectDomainAndPathWithServiceNames(
        projectDomainId,
        subdomain,
        basePath,
        excludeServiceId,
      );

    // Check for exact match (same subdomain + same basePath)
    const exactMatch = existingMappings.find(m => m.basePath === basePath);

    if (exactMatch) {
      return {
        available: false,
        conflicts: existingMappings.map(m => ({
          ...m,
          fullUrl: this.computePlaceholderUrl(m.subdomain, m.basePath),
        })),
        suggestions: {
          availableBasePaths: [],
          message: 'This exact URL is already in use.',
        },
      };
    }

    // Check for root path conflict
    if (!basePath && existingMappings.some(m => !m.basePath)) {
      const usedBasePaths = existingMappings.map(m => m.basePath).filter(Boolean);
      
      return {
        available: false,
        conflicts: existingMappings.map(m => ({
          ...m,
          fullUrl: this.computePlaceholderUrl(m.subdomain, m.basePath),
        })),
        suggestions: {
          availableBasePaths: this.generateAvailableBasePaths(usedBasePaths),
          message: 'Add a base path to differentiate your service.',
        },
      };
    }

    // Shared subdomain (different paths) - ALLOWED
    if (existingMappings.length > 0) {
      const usedBasePaths = existingMappings.map(m => m.basePath).filter(Boolean);
      
      return {
        available: true,
        conflicts: existingMappings.map(m => ({
          ...m,
          fullUrl: this.computePlaceholderUrl(m.subdomain, m.basePath),
        })),
        suggestions: {
          availableBasePaths: this.generateAvailableBasePaths(usedBasePaths),
          message: `Shared with ${existingMappings.length} other service(s).`,
        },
      };
    }

    // No conflicts
    return {
      available: true,
      conflicts: [],
      suggestions: {
        availableBasePaths: [],
        message: 'This subdomain is available.',
      },
    };
  } catch (error) {
    this.logger.error(`Availability check failed: ${error.message}`);
    throw error;
  }
}
```

## Best Practices

### 1. Always Check Before Creating

```typescript
// ✅ Good: Check availability first
const check = await conflictService.checkSubdomainAvailability(...);
if (!check.available) {
  // Handle conflict
}
await repository.create(...);

// ❌ Bad: Create without checking (may fail on unique constraint)
await repository.create(...);
```

### 2. Provide Clear Error Messages

```typescript
// ✅ Good: Helpful error with suggestions
if (!check.available) {
  throw new Error(
    `URL "${subdomain}.domain.com${basePath}" is already in use by "${check.conflicts[0].serviceName}". ` +
    `Available alternatives: ${check.suggestions.availableBasePaths.join(', ')}`
  );
}

// ❌ Bad: Generic error
if (!check.available) {
  throw new Error('Conflict');
}
```

### 3. Use Exclusion When Updating

```typescript
// ✅ Good: Exclude current mapping when updating
await conflictService.checkSubdomainAvailability(
  projectDomainId,
  newSubdomain,
  newBasePath,
  currentMappingId  // ← Exclude self
);

// ❌ Bad: No exclusion (will always conflict with self)
await conflictService.checkSubdomainAvailability(
  projectDomainId,
  newSubdomain,
  newBasePath
);
```

### 4. Validate Input Format First

```typescript
// ✅ Good: Validate format before checking conflicts
const subdomainValidation = conflictService.validateSubdomain(subdomain);
if (!subdomainValidation.valid) {
  throw new Error(subdomainValidation.error);
}

const pathValidation = conflictService.validateBasePath(basePath);
if (!pathValidation.valid) {
  throw new Error(pathValidation.error);
}

// Then check conflicts
const availability = await conflictService.checkSubdomainAvailability(...);
```
