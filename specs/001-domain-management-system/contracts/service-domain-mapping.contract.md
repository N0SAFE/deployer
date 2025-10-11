# Service Domain Mapping Contract

**Purpose**: ORPC contract for service routing configuration and conflict detection

**Location**: `packages/api-contracts/domain/service-domain-mapping.contract.ts`

---

## Contract Definition

```typescript
import { z } from 'zod';
import { procedure } from '@orpc/core';

// ============================================================================
// Zod Schemas
// ============================================================================

export const serviceDomainMappingSchema = z.object({
  id: z.string().uuid(),
  projectDomainId: z.string().uuid(),
  serviceId: z.string().uuid(),
  subdomain: z.string().nullable(),
  basePath: z.string(),
  internalPath: z.string(),
  internalPort: z.number().int().min(1).max(65535),
  stripPathEnabled: z.boolean(),
  protocolConfig: z.object({
    httpEnabled: z.boolean(),
    httpsEnabled: z.boolean(),
    autoRedirectToHttps: z.boolean(),
  }),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const mappingWithDetailsSchema = serviceDomainMappingSchema.extend({
  domain: z.string(),
  serviceName: z.string(),
  projectName: z.string(),
  fullUrl: z.string(), // e.g., "https://api.example.com/v1"
});

// ============================================================================
// Input Schemas
// ============================================================================

export const createMappingInputSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectDomainId: z.string().uuid(),
  serviceId: z.string().uuid(),
  subdomain: z.string().max(63).nullable().default(null),
  basePath: z.string().max(255).default('/'),
  internalPath: z.string().max(255).default('/'),
  internalPort: z.number().int().min(1).max(65535),
  stripPathEnabled: z.boolean().default(true),
  protocolConfig: z.object({
    httpEnabled: z.boolean().default(true),
    httpsEnabled: z.boolean().default(true),
    autoRedirectToHttps: z.boolean().default(true),
  }).default({}),
});

export const updateMappingInputSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  mappingId: z.string().uuid(),
  subdomain: z.string().max(63).nullable().optional(),
  basePath: z.string().max(255).optional(),
  internalPath: z.string().max(255).optional(),
  internalPort: z.number().int().min(1).max(65535).optional(),
  stripPathEnabled: z.boolean().optional(),
  protocolConfig: z.object({
    httpEnabled: z.boolean(),
    httpsEnabled: z.boolean(),
    autoRedirectToHttps: z.boolean(),
  }).optional(),
});

export const deleteMappingInputSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  mappingId: z.string().uuid(),
});

export const checkConflictInputSchema = z.object({
  projectDomainId: z.string().uuid(),
  subdomain: z.string().nullable(),
  basePath: z.string(),
  excludeMappingId: z.string().uuid().optional(), // Exclude current mapping when updating
});

export const listMappingsInputSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
});

// ============================================================================
// Output Schemas
// ============================================================================

export const createMappingOutputSchema = z.object({
  mapping: mappingWithDetailsSchema,
  message: z.string(),
});

export const updateMappingOutputSchema = z.object({
  mapping: mappingWithDetailsSchema,
  message: z.string(),
});

export const deleteMappingOutputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export const checkConflictOutputSchema = z.object({
  conflict: z.boolean(),
  existingMapping: mappingWithDetailsSchema.nullable(),
  message: z.string(),
});

export const listMappingsOutputSchema = z.object({
  mappings: z.array(mappingWithDetailsSchema),
  total: z.number().int().min(0),
});

// ============================================================================
// ORPC Procedures
// ============================================================================

export const serviceDomainMappingContract = {
  create: procedure
    .input(createMappingInputSchema)
    .output(createMappingOutputSchema)
    .mutation(),

  update: procedure
    .input(updateMappingInputSchema)
    .output(updateMappingOutputSchema)
    .mutation(),

  delete: procedure
    .input(deleteMappingInputSchema)
    .output(deleteMappingOutputSchema)
    .mutation(),

  checkConflict: procedure
    .input(checkConflictInputSchema)
    .output(checkConflictOutputSchema)
    .query(),

  list: procedure
    .input(listMappingsInputSchema)
    .output(listMappingsOutputSchema)
    .query(),
};
```

---

## Key Features

### Real-Time Conflict Detection (FR-046, FR-047)
- **500ms debounced validation** as user types
- Check for exact match: `(projectDomainId, subdomain, basePath)` must be unique
- Return existing mapping details if conflict found

### Routing Configuration
- **Internal Path**: Where requests are forwarded inside container (e.g., `/api`)
- **Internal Port**: Container port (e.g., 3000, 8080)
- **Strip Path**: Remove `basePath` before forwarding to service
- **Protocol**: HTTP/HTTPS/Auto-redirect configuration

### Example Routing
```
Domain: api.myapp.com
Subdomain: NULL (root)
Base Path: /v1
Internal Path: /api
Internal Port: 3000
Strip Path: true

External: https://api.myapp.com/v1/users
Internal: http://service:3000/api/users (path stripped + internal path added)
```

---

## Usage Examples

### Real-Time Conflict Detection
```typescript
import { useQuery } from '@tanstack/react-query';
import { orpc } from '@/lib/api';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

function ServiceMappingForm({ projectDomainId }: Props) {
  const [subdomain, setSubdomain] = useState('');
  const [basePath, setBasePath] = useState('/');
  
  const debouncedSubdomain = useDebouncedValue(subdomain, 500);
  const debouncedBasePath = useDebouncedValue(basePath, 500);

  const { data: conflict } = useQuery(
    orpc.domain.serviceDomainMapping.checkConflict.queryOptions({
      input: {
        projectDomainId,
        subdomain: debouncedSubdomain || null,
        basePath: debouncedBasePath,
      },
      enabled: !!projectDomainId, // Only check when domain selected
    })
  );

  return (
    <div>
      <Input value={subdomain} onChange={(e) => setSubdomain(e.target.value)} />
      <Input value={basePath} onChange={(e) => setBasePath(e.target.value)} />
      
      {conflict?.conflict && (
        <Alert variant="destructive">
          Conflict: {conflict.message}
        </Alert>
      )}
    </div>
  );
}
```

---

## Next Steps

1. ✅ Service domain mapping contract complete
2. Create `organization-settings.contract.ts` (final contract)
