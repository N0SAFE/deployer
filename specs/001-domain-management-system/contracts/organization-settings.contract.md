# Organization Settings Contract

**Purpose**: ORPC contract for organization-level domain limit and quota management

**Location**: `packages/api-contracts/domain/organization-settings.contract.ts`

---

## Contract Definition

```typescript
import { z } from 'zod';
import { procedure } from '@orpc/core';

// ============================================================================
// Zod Schemas
// ============================================================================

export const organizationSettingsSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  maxDomains: z.number().int().min(1).max(10000),
  maxDomainMappingsPerProject: z.number().int().min(1).max(1000),
  maxConcurrentVerifications: z.number().int().min(1).max(50),
  verificationRateLimit: z.number().int().min(1).max(100),
  maxAutoRetryAttempts: z.number().int().min(1).max(100),
  autoRetryIntervalHours: z.number().int().min(1).max(168),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const settingsWithUsageSchema = organizationSettingsSchema.extend({
  currentDomains: z.number().int().min(0),
  currentVerifications: z.number().int().min(0),
  quotaPercentage: z.number().min(0).max(100),
});

// ============================================================================
// Input Schemas
// ============================================================================

export const getSettingsInputSchema = z.object({
  organizationId: z.string().uuid(),
});

export const updateSettingsInputSchema = z.object({
  organizationId: z.string().uuid(),
  maxDomains: z.number().int().min(1).max(10000).optional(),
  maxDomainMappingsPerProject: z.number().int().min(1).max(1000).optional(),
  maxConcurrentVerifications: z.number().int().min(1).max(50).optional(),
  verificationRateLimit: z.number().int().min(1).max(100).optional(),
  maxAutoRetryAttempts: z.number().int().min(1).max(100).optional(),
  autoRetryIntervalHours: z.number().int().min(1).max(168).optional(),
});

// ============================================================================
// Output Schemas
// ============================================================================

export const getSettingsOutputSchema = settingsWithUsageSchema;

export const updateSettingsOutputSchema = z.object({
  settings: organizationSettingsSchema,
  message: z.string(),
});

// ============================================================================
// ORPC Procedures
// ============================================================================

export const organizationSettingsContract = {
  /**
   * Get organization settings with current usage
   * 
   * RBAC: Organization Owner, Organization Admin
   */
  get: procedure
    .input(getSettingsInputSchema)
    .output(getSettingsOutputSchema)
    .query(),

  /**
   * Update organization settings
   * 
   * RBAC: Organization Owner ONLY
   */
  update: procedure
    .input(updateSettingsInputSchema)
    .output(updateSettingsOutputSchema)
    .mutation(),
};
```

---

## Default Values

| Setting | Default | Min | Max | Purpose |
|---------|---------|-----|-----|---------|
| `maxDomains` | 50 | 1 | 10000 | Total domains per org |
| `maxDomainMappingsPerProject` | 100 | 1 | 1000 | Mappings per project |
| `maxConcurrentVerifications` | 5 | 1 | 50 | Concurrent DNS checks |
| `verificationRateLimit` | 1 | 1 | 100 | Verifications per hour |
| `maxAutoRetryAttempts` | 10 | 1 | 100 | Auto-retry attempts |
| `autoRetryIntervalHours` | 6 | 1 | 168 | Hours between retries |

---

## Usage Example

```typescript
import { useQuery, useMutation } from '@tanstack/react-query';
import { orpc } from '@/lib/api';

function OrganizationSettingsPage({ organizationId }: Props) {
  const { data: settings } = useQuery(
    orpc.domain.organizationSettings.get.queryOptions({
      input: { organizationId },
    })
  );

  const updateMutation = useMutation({
    mutationFn: (values: Partial<UpdateSettingsInput>) =>
      orpc.domain.organizationSettings.update({
        organizationId,
        ...values,
      }),
  });

  return (
    <div>
      <h2>Domain Limits</h2>
      <p>Current: {settings?.currentDomains} / {settings?.maxDomains}</p>
      <p>Quota: {settings?.quotaPercentage}%</p>
      
      <Form onSubmit={(values) => updateMutation.mutate(values)}>
        <Input 
          name="maxDomains" 
          defaultValue={settings?.maxDomains}
          min={1}
          max={10000}
        />
        <Button type="submit">Update Settings</Button>
      </Form>
    </div>
  );
}
```

---

## Next Steps

1. ✅ All 4 contracts complete
2. Create `quickstart.md` (developer onboarding guide)
3. Create `/tests/` directory with test specifications
