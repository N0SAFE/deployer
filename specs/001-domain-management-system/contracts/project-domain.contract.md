# Project Domain Contract

**Purpose**: ORPC contract for project-level domain assignment and management

**Location**: `packages/api-contracts/domain/project-domain.contract.ts`

---

## Contract Definition

```typescript
import { z } from 'zod';
import { procedure } from '@orpc/core';

// ============================================================================
// Zod Schemas (Input/Output Types)
// ============================================================================

// Project Domain Entity (Join Table)
export const projectDomainSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  organizationDomainId: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Project Domain with enriched data
export const projectDomainWithDetailsSchema = projectDomainSchema.extend({
  domain: z.string(), // From organizationDomains.domain
  verificationStatus: z.enum(['pending', 'verified', 'failed', 'requires_manual']),
  verifiedAt: z.date().nullable(),
  serviceMappingsCount: z.number().int().min(0),
});

// Available domain for assignment (not yet assigned to project)
export const availableDomainSchema = z.object({
  id: z.string().uuid(),
  domain: z.string(),
  verificationStatus: z.enum(['pending', 'verified', 'failed', 'requires_manual']),
  verifiedAt: z.date().nullable(),
  isVerified: z.boolean(),
});

// ============================================================================
// Input Schemas
// ============================================================================

// List project domains input
export const listProjectDomainsInputSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  includeUnverified: z.boolean().default(false), // Include pending/failed domains
});

// Get available domains input (for assignment dropdown)
export const getAvailableDomainsInputSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  onlyVerified: z.boolean().default(true), // Only show verified domains
});

// Assign domains input (multi-select + auto-register new domains)
export const assignDomainsInputSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  domains: z.array(
    z.discriminatedUnion('type', [
      // Existing domain (select from dropdown)
      z.object({
        type: z.literal('existing'),
        organizationDomainId: z.string().uuid(),
      }),
      // New domain (auto-register + assign)
      z.object({
        type: z.literal('new'),
        domain: z.string()
          .min(1)
          .max(255)
          .regex(/^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/, 'Invalid domain format'),
        verificationMethod: z.enum(['txt', 'cname']).default('txt'),
      }),
    ])
  ).min(1, 'At least one domain required'),
});

// Unassign domain input
export const unassignDomainInputSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectDomainId: z.string().uuid(),
  deleteIfUnused: z.boolean().default(false), // Delete from org if no other projects use it
});

// ============================================================================
// Output Schemas
// ============================================================================

// List project domains output
export const listProjectDomainsOutputSchema = z.object({
  domains: z.array(projectDomainWithDetailsSchema),
  total: z.number().int().min(0),
});

// Available domains output
export const availableDomainsOutputSchema = z.object({
  domains: z.array(availableDomainSchema),
  total: z.number().int().min(0),
});

// Assign domains output
export const assignDomainsOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  assigned: z.array(z.object({
    projectDomainId: z.string().uuid(),
    organizationDomainId: z.string().uuid(),
    domain: z.string(),
    isNew: z.boolean(), // Whether domain was auto-registered
    verificationStatus: z.enum(['pending', 'verified', 'failed', 'requires_manual']),
    verificationInstructions: z.object({
      method: z.enum(['txt', 'cname']),
      recordType: z.enum(['TXT', 'CNAME']),
      hostname: z.string(),
      value: z.string(),
    }).optional(), // Only for new domains
  })),
  skipped: z.array(z.object({
    domain: z.string().optional(),
    organizationDomainId: z.string().uuid().optional(),
    reason: z.string(),
  })).optional(),
});

// Unassign domain output
export const unassignDomainOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  domainDeleted: z.boolean(), // True if domain was deleted from organization
});

// ============================================================================
// ORPC Procedures
// ============================================================================

export const projectDomainContract = {
  /**
   * List domains assigned to a project
   * 
   * RBAC: Organization Owner, Organization Admin, Project Admin, Project Member
   * 
   * Features:
   * - Show only domains assigned to specific project
   * - Include verification status
   * - Count service mappings per domain
   * - Optional: Include unverified domains (for admin view)
   */
  listByProject: procedure
    .input(listProjectDomainsInputSchema)
    .output(listProjectDomainsOutputSchema)
    .query(),

  /**
   * Get available domains for assignment
   * 
   * RBAC: Organization Owner, Organization Admin, Project Admin
   * 
   * Returns:
   * - Domains NOT yet assigned to this project
   * - Only verified domains by default (optional: include pending)
   * - Sorted alphabetically
   * 
   * Used in: Domain assignment dropdown/multi-select
   */
  getAvailable: procedure
    .input(getAvailableDomainsInputSchema)
    .output(availableDomainsOutputSchema)
    .query(),

  /**
   * Assign domains to project (multi-select + auto-register)
   * 
   * RBAC:
   * - Organization Owner: Can assign ANY domain to ANY project
   * - Organization Admin: Can assign ANY domain to ANY project
   * - Project Admin: Can assign domains to THEIR OWN projects only
   * 
   * Features:
   * - Assign multiple domains in single request (atomic operation)
   * - Auto-register new domains if type='new' (creates in organizationDomains + assigns)
   * - Skip duplicates (already assigned domains)
   * - Return verification instructions for new domains
   * 
   * Validations:
   * - Check maxDomains quota for new domains
   * - Verify project ownership for Project Admin role
   * - Prevent duplicate assignments
   * - Validate domain format for new domains
   * 
   * Transaction:
   * - All assignments succeed or all fail (atomic)
   * - New domain registration + assignment in single transaction
   */
  assignDomains: procedure
    .input(assignDomainsInputSchema)
    .output(assignDomainsOutputSchema)
    .mutation(),

  /**
   * Unassign domain from project
   * 
   * RBAC:
   * - Organization Owner: Can unassign from ANY project
   * - Organization Admin: Can unassign from ANY project
   * - Project Admin: Can unassign from THEIR OWN projects only
   * 
   * Features:
   * - Remove project-domain assignment
   * - Optional: Delete domain from organization if no other projects use it
   * - Check for service mappings before deletion
   * 
   * Cascade:
   * - Deletes serviceDomainMappings for this project-domain pair
   * - Optionally deletes organizationDomain if deleteIfUnused=true + no other projects
   */
  unassignDomain: procedure
    .input(unassignDomainInputSchema)
    .output(unassignDomainOutputSchema)
    .mutation(),
};
```

---

## TypeScript Type Exports

```typescript
// Input types
export type ListProjectDomainsInput = z.infer<typeof listProjectDomainsInputSchema>;
export type GetAvailableDomainsInput = z.infer<typeof getAvailableDomainsInputSchema>;
export type AssignDomainsInput = z.infer<typeof assignDomainsInputSchema>;
export type UnassignDomainInput = z.infer<typeof unassignDomainInputSchema>;

// Output types
export type ListProjectDomainsOutput = z.infer<typeof listProjectDomainsOutputSchema>;
export type AvailableDomainsOutput = z.infer<typeof availableDomainsOutputSchema>;
export type AssignDomainsOutput = z.infer<typeof assignDomainsOutputSchema>;
export type UnassignDomainOutput = z.infer<typeof unassignDomainOutputSchema>;

// Entity types
export type ProjectDomain = z.infer<typeof projectDomainSchema>;
export type ProjectDomainWithDetails = z.infer<typeof projectDomainWithDetailsSchema>;
export type AvailableDomain = z.infer<typeof availableDomainSchema>;
```

---

## Key Features Explained

### 1. Multi-Select Domain Assignment with Auto-Registration

**Specification Requirement (FR-024)**:
> Users can assign multiple existing domains in a single action via multi-select interface

**Specification Requirement (FR-025)**:
> During assignment, users can create and assign new domains in a single action

**Implementation**:
```typescript
// Example input
{
  organizationId: "org-123",
  projectId: "proj-456",
  domains: [
    // Assign existing verified domain
    { type: "existing", organizationDomainId: "dom-abc" },
    
    // Assign existing pending domain
    { type: "existing", organizationDomainId: "dom-def" },
    
    // Create new domain + assign (auto-register)
    { 
      type: "new", 
      domain: "newdomain.com", 
      verificationMethod: "txt" 
    },
  ]
}
```

**Backend Logic**:
1. Validate all domains in single transaction
2. Create new domains in `organizationDomains` table
3. Create `projectDomains` entries for all assignments
4. Return verification instructions for new domains
5. Skip duplicates with informative message

**Frontend UX**:
```typescript
<Combobox multiple>
  {/* Existing domains section */}
  <ComboboxGroup label="Verified Domains">
    {verifiedDomains.map(d => <ComboboxOption value={d.id}>{d.domain}</ComboboxOption>)}
  </ComboboxGroup>
  
  {/* Create new domain option */}
  <ComboboxOption value="create-new">
    + Create and assign new domain
  </ComboboxOption>
</Combobox>
```

### 2. Atomic Assignment Operations

**All assignments succeed or all fail** (database transaction):
- If quota exceeded: Rollback entire operation
- If domain format invalid: Rollback entire operation
- If duplicate found: Skip duplicate, continue with others (optional behavior)

**Error Handling**:
```typescript
// Partial success example
{
  success: true,
  message: "2 of 3 domains assigned successfully",
  assigned: [
    { domain: "example.com", isNew: false, ... },
    { domain: "newdomain.com", isNew: true, ... }
  ],
  skipped: [
    { domain: "duplicate.com", reason: "Already assigned to this project" }
  ]
}
```

### 3. Project-Scoped RBAC

**Project Admin Restrictions**:
- Can only assign domains to **their own projects**
- Cannot assign to other projects (403 Forbidden)
- Validation happens in controller after guard passes

**Implementation**:
```typescript
// In controller
async assignDomains(input: AssignDomainsInput, user: AuthUser) {
  // Check if user is Project Admin for this specific project
  if (user.role === 'project_admin') {
    const isMember = await this.projectService.isProjectMember(
      input.projectId,
      user.id
    );
    
    if (!isMember) {
      throw new ForbiddenException('You can only assign domains to your own projects');
    }
  }
  
  // Proceed with assignment
}
```

---

## Validation Rules

### Domain Assignment Limits
- Check `organizationSettings.maxDomains` before creating new domains
- No limit on assigning existing domains (reusing verified domains encouraged)

### Duplicate Prevention
- Query `projectDomains` table for existing assignments
- Skip duplicates with informative message
- Do NOT throw error for duplicates (allow partial success)

### Domain Format (for new domains)
```regex
^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$
```

---

## Error Responses

### HTTP 403 Forbidden (Project Admin - Not Own Project)
```json
{
  "error": "PROJECT_ACCESS_DENIED",
  "message": "You can only assign domains to your own projects",
  "projectId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### HTTP 409 Conflict (All Domains Already Assigned)
```json
{
  "error": "ALL_DOMAINS_ALREADY_ASSIGNED",
  "message": "All selected domains are already assigned to this project",
  "skipped": [
    { "organizationDomainId": "dom-abc", "reason": "Already assigned" },
    { "organizationDomainId": "dom-def", "reason": "Already assigned" }
  ]
}
```

### HTTP 400 Bad Request (Quota Exceeded for New Domains)
```json
{
  "error": "DOMAIN_QUOTA_EXCEEDED",
  "message": "Cannot create 3 new domains. Organization limit: 50, current: 49",
  "quota": {
    "current": 49,
    "max": 50,
    "requested": 3
  }
}
```

---

## Usage Examples (Frontend)

### List Project Domains
```typescript
import { useQuery } from '@tanstack/react-query';
import { orpc } from '@/lib/api';

function ProjectDomainsPage({ organizationId, projectId }: Props) {
  const { data } = useQuery(
    orpc.domain.projectDomain.listByProject.queryOptions({
      input: {
        organizationId,
        projectId,
        includeUnverified: false, // Only verified domains
      },
    })
  );

  return (
    <div>
      <h2>Project Domains ({data?.total})</h2>
      {data?.domains.map(pd => (
        <DomainCard 
          key={pd.id} 
          domain={pd.domain}
          status={pd.verificationStatus}
          mappingsCount={pd.serviceMappingsCount}
        />
      ))}
    </div>
  );
}
```

### Assign Domains (Multi-Select + Auto-Register)
```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { orpc } from '@/lib/api';
import { useState } from 'react';

function AssignDomainsForm({ organizationId, projectId }: Props) {
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const queryClient = useQueryClient();

  // Get available domains for dropdown
  const { data: availableDomains } = useQuery(
    orpc.domain.projectDomain.getAvailable.queryOptions({
      input: { organizationId, projectId, onlyVerified: true },
    })
  );

  // Assign mutation
  const assignMutation = useMutation({
    mutationFn: (domains: AssignDomainsInput['domains']) =>
      orpc.domain.projectDomain.assignDomains({
        organizationId,
        projectId,
        domains,
      }),
    onSuccess: (data) => {
      // Invalidate project domains list
      queryClient.invalidateQueries({ 
        queryKey: orpc.domain.projectDomain.listByProject.getQueryKey() 
      });
      
      // Show verification instructions for new domains
      data.assigned
        .filter(d => d.isNew && d.verificationInstructions)
        .forEach(d => showVerificationModal(d.verificationInstructions!));
      
      toast.success(data.message);
    },
  });

  const handleSubmit = () => {
    const domains: AssignDomainsInput['domains'] = [
      // Existing domains
      ...selectedDomains.map(id => ({ type: 'existing' as const, organizationDomainId: id })),
      
      // New domain (if provided)
      ...(newDomain ? [{ 
        type: 'new' as const, 
        domain: newDomain, 
        verificationMethod: 'txt' as const 
      }] : []),
    ];

    assignMutation.mutate(domains);
  };

  return (
    <div>
      {/* Multi-select existing domains */}
      <MultiSelect
        options={availableDomains?.domains || []}
        value={selectedDomains}
        onChange={setSelectedDomains}
        placeholder="Select existing domains..."
      />

      {/* Add new domain input */}
      <Input
        value={newDomain}
        onChange={(e) => setNewDomain(e.target.value)}
        placeholder="Or enter new domain (e.g., newdomain.com)"
      />

      <Button onClick={handleSubmit} disabled={assignMutation.isPending}>
        {assignMutation.isPending ? 'Assigning...' : 'Assign Domains'}
      </Button>
    </div>
  );
}
```

### Unassign Domain
```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { orpc } from '@/lib/api';

function UnassignDomainButton({ organizationId, projectId, projectDomainId }: Props) {
  const queryClient = useQueryClient();

  const unassignMutation = useMutation({
    mutationFn: () =>
      orpc.domain.projectDomain.unassignDomain({
        organizationId,
        projectId,
        projectDomainId,
        deleteIfUnused: true, // Delete from org if no other projects use it
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ 
        queryKey: orpc.domain.projectDomain.listByProject.getQueryKey() 
      });
      
      toast.success(data.message);
      
      if (data.domainDeleted) {
        toast.info('Domain was also removed from organization (no other projects were using it)');
      }
    },
  });

  return (
    <Button 
      variant="destructive" 
      onClick={() => {
        if (confirm('Are you sure you want to unassign this domain?')) {
          unassignMutation.mutate();
        }
      }}
    >
      Unassign Domain
    </Button>
  );
}
```

---

## Database Queries (Common Operations)

### Get Available Domains for Assignment
```typescript
async getAvailableDomains(organizationId: string, projectId: string, onlyVerified: boolean) {
  const assignedDomainIds = db
    .select({ id: projectDomains.organizationDomainId })
    .from(projectDomains)
    .where(eq(projectDomains.projectId, projectId));

  return db
    .select()
    .from(organizationDomains)
    .where(
      and(
        eq(organizationDomains.organizationId, organizationId),
        notInArray(organizationDomains.id, assignedDomainIds),
        onlyVerified ? eq(organizationDomains.verificationStatus, 'verified') : undefined
      )
    )
    .orderBy(asc(organizationDomains.domain));
}
```

### Assign Domains (Transaction)
```typescript
async assignDomains(input: AssignDomainsInput) {
  return db.transaction(async (tx) => {
    const assigned = [];
    const skipped = [];
    
    for (const domain of input.domains) {
      if (domain.type === 'new') {
        // Check quota
        const count = await this.countOrganizationDomains(input.organizationId);
        const settings = await this.getOrganizationSettings(input.organizationId);
        
        if (count >= settings.maxDomains) {
          throw new Error('DOMAIN_QUOTA_EXCEEDED');
        }
        
        // Create new domain
        const newDomain = await tx
          .insert(organizationDomains)
          .values({
            organizationId: input.organizationId,
            domain: domain.domain,
            verificationMethod: domain.verificationMethod,
            verificationToken: generateToken(),
            verificationStatus: 'pending',
          })
          .returning();
        
        // Assign to project
        const projectDomain = await tx
          .insert(projectDomains)
          .values({
            projectId: input.projectId,
            organizationDomainId: newDomain[0].id,
          })
          .returning();
        
        assigned.push({ ...newDomain[0], isNew: true });
      } else {
        // Check if already assigned
        const existing = await tx
          .select()
          .from(projectDomains)
          .where(
            and(
              eq(projectDomains.projectId, input.projectId),
              eq(projectDomains.organizationDomainId, domain.organizationDomainId)
            )
          );
        
        if (existing.length > 0) {
          skipped.push({ organizationDomainId: domain.organizationDomainId, reason: 'Already assigned' });
          continue;
        }
        
        // Assign existing domain
        await tx
          .insert(projectDomains)
          .values({
            projectId: input.projectId,
            organizationDomainId: domain.organizationDomainId,
          });
        
        assigned.push({ organizationDomainId: domain.organizationDomainId, isNew: false });
      }
    }
    
    return { assigned, skipped };
  });
}
```

---

## Next Steps

1. ✅ Project domain contract complete
2. Create `service-domain-mapping.contract.ts` (service routing configuration)
3. Create `organization-settings.contract.ts` (quota and limit management)
