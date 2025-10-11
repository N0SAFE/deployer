# Organization Domain Contract

**Purpose**: ORPC contract for organization-level domain management operations

**Location**: `packages/api-contracts/domain/organization-domain.contract.ts`

---

## Contract Definition

```typescript
import { z } from 'zod';
import { procedure } from '@orpc/core';

// ============================================================================
// Zod Schemas (Input/Output Types)
// ============================================================================

// Domain Entity
export const organizationDomainSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  domain: z.string().min(1).max(255),
  verificationMethod: z.enum(['txt', 'cname']),
  verificationToken: z.string().nullable(),
  verificationStatus: z.enum(['pending', 'verified', 'failed', 'requires_manual']),
  verifiedAt: z.date().nullable(),
  retryAttempts: z.number().int().min(0),
  lastVerificationAttempt: z.date().nullable(),
  nextRetryAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Domain with usage information (for conflict checking)
export const domainWithUsageSchema = organizationDomainSchema.extend({
  assignedProjectsCount: z.number().int().min(0),
  activeMappingsCount: z.number().int().min(0),
  canDelete: z.boolean(),
});

// DNS verification instructions
export const verificationInstructionsSchema = z.object({
  method: z.enum(['txt', 'cname']),
  recordType: z.enum(['TXT', 'CNAME']),
  hostname: z.string(),
  value: z.string(),
  ttl: z.number().int().default(3600),
  exampleCommand: z.string().optional(),
});

// ============================================================================
// Input Schemas
// ============================================================================

// List domains input
export const listDomainsInputSchema = z.object({
  organizationId: z.string().uuid(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(50),
  status: z.enum(['pending', 'verified', 'failed', 'requires_manual']).optional(),
  search: z.string().optional(),
});

// Get by ID input
export const getDomainByIdInputSchema = z.object({
  organizationId: z.string().uuid(),
  domainId: z.string().uuid(),
});

// Create domain input
export const createDomainInputSchema = z.object({
  organizationId: z.string().uuid(),
  domain: z.string()
    .min(1)
    .max(255)
    .regex(/^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/, 'Invalid domain format'),
  verificationMethod: z.enum(['txt', 'cname']).default('txt'),
});

// Verify domain input
export const verifyDomainInputSchema = z.object({
  organizationId: z.string().uuid(),
  domainId: z.string().uuid(),
});

// Delete domain input
export const deleteDomainInputSchema = z.object({
  organizationId: z.string().uuid(),
  domainId: z.string().uuid(),
  force: z.boolean().default(false), // Only Organization Owner can force delete
});

// Get domain usage input
export const getDomainUsageInputSchema = z.object({
  organizationId: z.string().uuid(),
  domainId: z.string().uuid(),
});

// ============================================================================
// Output Schemas
// ============================================================================

// List domains output
export const listDomainsOutputSchema = z.object({
  domains: z.array(domainWithUsageSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  hasMore: z.boolean(),
});

// Get domain output
export const getDomainOutputSchema = domainWithUsageSchema.extend({
  verificationInstructions: verificationInstructionsSchema,
});

// Create domain output
export const createDomainOutputSchema = z.object({
  domain: organizationDomainSchema,
  verificationInstructions: verificationInstructionsSchema,
});

// Verify domain output
export const verifyDomainOutputSchema = z.object({
  domain: organizationDomainSchema,
  success: z.boolean(),
  message: z.string(),
  verifiedAt: z.date().nullable(),
});

// Delete domain output
export const deleteDomainOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

// Domain usage output
export const domainUsageOutputSchema = z.object({
  domainId: z.string().uuid(),
  domain: z.string(),
  assignedProjects: z.array(z.object({
    projectId: z.string().uuid(),
    projectName: z.string(),
    assignedAt: z.date(),
  })),
  serviceMappings: z.array(z.object({
    mappingId: z.string().uuid(),
    serviceName: z.string(),
    subdomain: z.string().nullable(),
    basePath: z.string(),
    projectName: z.string(),
  })),
  canDelete: z.boolean(),
  deleteBlockedReason: z.string().nullable(),
});

// ============================================================================
// ORPC Procedures
// ============================================================================

export const organizationDomainContract = {
  /**
   * List organization domains with pagination and filters
   * 
   * RBAC: Organization Owner, Organization Admin
   * 
   * Features:
   * - Pagination (default: 50 per page)
   * - Filter by verification status
   * - Search by domain name (partial match)
   * - Returns usage information for each domain
   */
  list: procedure
    .input(listDomainsInputSchema)
    .output(listDomainsOutputSchema)
    .query(),

  /**
   * Get single domain by ID with verification instructions
   * 
   * RBAC: Organization Owner, Organization Admin
   * 
   * Returns:
   * - Full domain details
   * - Verification instructions (TXT/CNAME)
   * - Usage information (projects, mappings)
   */
  getById: procedure
    .input(getDomainByIdInputSchema)
    .output(getDomainOutputSchema)
    .query(),

  /**
   * Create new organization domain
   * 
   * RBAC: Organization Owner, Organization Admin
   * 
   * Validations:
   * - Check maxDomains quota (from OrganizationSettings)
   * - Validate domain format (RFC 1035)
   * - Check for duplicate domain in organization
   * - Generate verification token
   * 
   * Returns verification instructions immediately
   */
  create: procedure
    .input(createDomainInputSchema)
    .output(createDomainOutputSchema)
    .mutation(),

  /**
   * Manually trigger domain verification
   * 
   * RBAC: Organization Owner, Organization Admin
   * 
   * Process:
   * 1. Check verification rate limit (from OrganizationSettings)
   * 2. Query DNS for TXT/CNAME record
   * 3. Update status to 'verified' or 'failed'
   * 4. Reset retry attempts on success
   * 5. Return verification result
   * 
   * Rate limited to prevent DNS abuse
   */
  verify: procedure
    .input(verifyDomainInputSchema)
    .output(verifyDomainOutputSchema)
    .mutation(),

  /**
   * Delete organization domain
   * 
   * RBAC:
   * - Organization Owner: Can delete ANY domain (even if in use with force=true)
   * - Organization Admin: Can delete UNUSED domains only
   * 
   * Validations:
   * - Check if domain has assigned projects
   * - Check if domain has service mappings
   * - Block deletion if in use (unless force=true + Owner role)
   * 
   * Cascade:
   * - Deletes projectDomains entries
   * - Deletes serviceDomainMappings entries
   */
  delete: procedure
    .input(deleteDomainInputSchema)
    .output(deleteDomainOutputSchema)
    .mutation(),

  /**
   * Get domain usage information
   * 
   * RBAC: Organization Owner, Organization Admin
   * 
   * Returns:
   * - List of projects using this domain
   * - List of service mappings configured
   * - Whether domain can be safely deleted
   * - Reason if deletion is blocked
   */
  getUsage: procedure
    .input(getDomainUsageInputSchema)
    .output(domainUsageOutputSchema)
    .query(),
};
```

---

## TypeScript Type Exports

```typescript
// Input types
export type ListDomainsInput = z.infer<typeof listDomainsInputSchema>;
export type GetDomainByIdInput = z.infer<typeof getDomainByIdInputSchema>;
export type CreateDomainInput = z.infer<typeof createDomainInputSchema>;
export type VerifyDomainInput = z.infer<typeof verifyDomainInputSchema>;
export type DeleteDomainInput = z.infer<typeof deleteDomainInputSchema>;
export type GetDomainUsageInput = z.infer<typeof getDomainUsageInputSchema>;

// Output types
export type ListDomainsOutput = z.infer<typeof listDomainsOutputSchema>;
export type GetDomainOutput = z.infer<typeof getDomainOutputSchema>;
export type CreateDomainOutput = z.infer<typeof createDomainOutputSchema>;
export type VerifyDomainOutput = z.infer<typeof verifyDomainOutputSchema>;
export type DeleteDomainOutput = z.infer<typeof deleteDomainOutputSchema>;
export type DomainUsageOutput = z.infer<typeof domainUsageOutputSchema>;

// Entity types
export type OrganizationDomain = z.infer<typeof organizationDomainSchema>;
export type DomainWithUsage = z.infer<typeof domainWithUsageSchema>;
export type VerificationInstructions = z.infer<typeof verificationInstructionsSchema>;
```

---

## Validation Rules

### Domain Format Regex
```regex
^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$
```

**Valid Examples**:
- `example.com`
- `sub.example.com`
- `my-app.example.co.uk`

**Invalid Examples**:
- `example` (no TLD)
- `Example.com` (uppercase)
- `-example.com` (starts with hyphen)
- `example-.com` (ends with hyphen)

### Quota Validation
- Check `organizationSettings.maxDomains` before allowing creation
- Return 403 error if quota exceeded with upgrade prompt message

### Rate Limiting
- Verify operation limited to `organizationSettings.verificationRateLimit` requests per hour
- Return 429 Too Many Requests with `Retry-After` header

---

## Error Responses

### HTTP 400 Bad Request
```json
{
  "error": "INVALID_DOMAIN_FORMAT",
  "message": "Domain must be lowercase and follow RFC 1035 format",
  "field": "domain"
}
```

### HTTP 403 Forbidden (Quota Exceeded)
```json
{
  "error": "DOMAIN_QUOTA_EXCEEDED",
  "message": "Organization has reached maximum of 50 domains. Upgrade plan to add more.",
  "quota": {
    "current": 50,
    "max": 50
  }
}
```

### HTTP 409 Conflict (Duplicate Domain)
```json
{
  "error": "DOMAIN_ALREADY_EXISTS",
  "message": "Domain 'example.com' is already registered in this organization",
  "existingDomainId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### HTTP 429 Too Many Requests (Rate Limit)
```json
{
  "error": "VERIFICATION_RATE_LIMIT_EXCEEDED",
  "message": "Maximum 1 verification attempt per hour. Please try again later.",
  "retryAfter": 3420
}
```

### HTTP 400 Bad Request (Cannot Delete)
```json
{
  "error": "DOMAIN_IN_USE",
  "message": "Cannot delete domain with active projects or service mappings",
  "usage": {
    "projectsCount": 3,
    "mappingsCount": 5
  }
}
```

---

## Usage Examples (Frontend)

### List Organization Domains
```typescript
import { useQuery } from '@tanstack/react-query';
import { orpc } from '@/lib/api';

function OrganizationDomainsPage({ organizationId }: { organizationId: string }) {
  const { data, isLoading } = useQuery(
    orpc.domain.organizationDomain.list.queryOptions({
      input: {
        organizationId,
        page: 1,
        limit: 50,
        status: 'verified', // Optional filter
      },
    })
  );

  if (isLoading) return <div>Loading domains...</div>;

  return (
    <div>
      <h2>Domains ({data.total})</h2>
      {data.domains.map(domain => (
        <DomainCard key={domain.id} domain={domain} />
      ))}
    </div>
  );
}
```

### Create Domain with Verification Instructions
```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { orpc } from '@/lib/api';

function CreateDomainForm({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient();
  
  const createMutation = useMutation({
    mutationFn: (domain: string) =>
      orpc.domain.organizationDomain.create({
        organizationId,
        domain,
        verificationMethod: 'txt',
      }),
    onSuccess: (data) => {
      // Invalidate domain list query
      queryClient.invalidateQueries({ 
        queryKey: orpc.domain.organizationDomain.list.getQueryKey() 
      });
      
      // Show verification instructions
      showVerificationModal(data.verificationInstructions);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    createMutation.mutate(formData.get('domain') as string);
  };

  return (
    <form onSubmit={handleSubmit}>
      <input name="domain" placeholder="example.com" required />
      <button type="submit" disabled={createMutation.isPending}>
        Add Domain
      </button>
    </form>
  );
}
```

### Verify Domain
```typescript
import { useMutation } from '@tanstack/react-query';
import { orpc } from '@/lib/api';

function VerifyDomainButton({ organizationId, domainId }: Props) {
  const verifyMutation = useMutation({
    mutationFn: () =>
      orpc.domain.organizationDomain.verify({
        organizationId,
        domainId,
      }),
    onSuccess: (data) => {
      if (data.success) {
        toast.success(`Domain verified successfully!`);
      } else {
        toast.error(data.message);
      }
    },
    onError: (error) => {
      if (error.code === 'TOO_MANY_REQUESTS') {
        toast.error('Too many verification attempts. Please wait.');
      }
    },
  });

  return (
    <button onClick={() => verifyMutation.mutate()}>
      {verifyMutation.isPending ? 'Verifying...' : 'Verify Domain'}
    </button>
  );
}
```

---

## Next Steps

1. ✅ Organization domain contract complete
2. Create `project-domain.contract.ts` (project-level domain assignment)
3. Create `service-domain-mapping.contract.ts` (service routing configuration)
4. Create `organization-settings.contract.ts` (quota and limit management)
