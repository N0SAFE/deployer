# Data Model: Domain Management System

**Feature**: 001-domain-management-system  
**Date**: 2025-01-11  
**Database**: PostgreSQL 16 with Drizzle ORM

---

## Overview

This document defines the complete database schema for the domain management system, including new tables, schema updates, relationships, indexes, and migration strategy.

---

## Schema Changes Summary

### New Tables
1. **`organizationSettings`**: Per-organization configuration for domain limits and verification settings

### Updated Tables
1. **`organizationDomains`**: Add retry attempt tracking for auto-retry functionality
2. **`serviceDomainMappings`**: Add routing configuration fields (internal path, port, protocol)

### No Changes Required
- ✅ `projectDomains`: Existing schema sufficient

### Non-Stored Entities (Computed/Derived)
- ⚠️ `RoutingRule`: NOT a database table - dynamically generated from ServiceDomainMapping entities for Traefik configuration (see spec.md Key Entities section)

---

## Table Definitions (Drizzle ORM)

### 1. organizationSettings (NEW TABLE)

**Purpose**: Store per-organization configuration for domain management limits and verification settings.

**Location**: `apps/api/src/config/drizzle/schema/domain.ts`

**Drizzle Schema**:
```typescript
import { pgTable, uuid, integer, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { organizations } from './organization'; // Adjust import path

export const organizationSettings = pgTable('organization_settings', {
  // Primary Key
  id: uuid('id').primaryKey().defaultRandom(),
  
  // Foreign Key
  organizationId: uuid('organization_id')
    .notNull()
    .unique()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  
  // Limit Configuration
  maxDomains: integer('max_domains').notNull().default(50),
  maxDomainMappingsPerProject: integer('max_domain_mappings_per_project').notNull().default(100),
  maxConcurrentVerifications: integer('max_concurrent_verifications').notNull().default(5),
  
  // Verification Rate Limiting (requests per hour)
  verificationRateLimit: integer('verification_rate_limit').notNull().default(1),
  
  // Auto-Retry Configuration
  maxAutoRetryAttempts: integer('max_auto_retry_attempts').notNull().default(10),
  autoRetryIntervalHours: integer('auto_retry_interval_hours').notNull().default(6),
  
  // Timestamps
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Relations
export const organizationSettingsRelations = relations(organizationSettings, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationSettings.organizationId],
    references: [organizations.id],
  }),
}));
```

**TypeScript Types**:
```typescript
// Export for use in services
export type OrganizationSettings = typeof organizationSettings.$inferSelect;
export type NewOrganizationSettings = typeof organizationSettings.$inferInsert;
```

**Constraints**:
- ✅ `PRIMARY KEY (id)`
- ✅ `UNIQUE (organization_id)` - One settings record per organization
- ✅ `FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE`
- ✅ All limit fields have sensible defaults (50 domains, 100 mappings, 5 concurrent, 1 req/hr)

**Indexes**:
```typescript
// Add to organizationSettings table definition
{
  indexes: {
    organizationIdIdx: index('organization_settings_org_id_idx').on(organizationSettings.organizationId),
  }
}
```

**Default Behavior**:
- When organization is created, automatically create settings row with default values
- Implement via database trigger OR application-level logic in OrganizationService
- Cascade delete when organization is deleted

---

### 2. organizationDomains (UPDATED TABLE)

**Purpose**: Add retry attempt tracking for DNS auto-retry background job.

**Location**: `apps/api/src/config/drizzle/schema/domain.ts`

**Existing Schema** (reference):
```typescript
export const organizationDomains = pgTable('organization_domains', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  domain: varchar('domain', { length: 255 }).notNull(),
  verificationMethod: varchar('verification_method', { length: 50 }).notNull(), // 'txt' | 'cname'
  verificationToken: varchar('verification_token', { length: 255 }),
  verificationStatus: varchar('verification_status', { length: 50 }).notNull(), // 'pending' | 'verified' | 'failed' | 'requires_manual'
  verifiedAt: timestamp('verified_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
```

**Schema Changes** (ADD these columns):
```typescript
export const organizationDomains = pgTable('organization_domains', {
  // ... existing columns ...
  
  // NEW: Auto-Retry Tracking
  retryAttempts: integer('retry_attempts').notNull().default(0),
  lastVerificationAttempt: timestamp('last_verification_attempt'),
  nextRetryAt: timestamp('next_retry_at'),
});
```

**Updated TypeScript Types**:
```typescript
export type OrganizationDomain = typeof organizationDomains.$inferSelect;
export type NewOrganizationDomain = typeof organizationDomains.$inferInsert;
```

**New Column Details**:

| Column | Type | Nullable | Default | Purpose |
|--------|------|----------|---------|---------|
| `retryAttempts` | INTEGER | NOT NULL | 0 | Track number of automatic verification attempts (max: 10) |
| `lastVerificationAttempt` | TIMESTAMP | NULL | NULL | Timestamp of last verification attempt (manual or auto) |
| `nextRetryAt` | TIMESTAMP | NULL | NULL | Scheduled time for next automatic retry (used by BullMQ processor) |

**Verification Status Flow**:
```
pending (0 attempts) 
  → pending (1-9 attempts with retries)
  → verified (success)
  → requires_manual (10 failed attempts)
  → failed (permanent failure)
```

**Indexes** (ADD):
```typescript
{
  indexes: {
    // ... existing indexes ...
    verificationStatusIdx: index('org_domains_verification_status_idx').on(organizationDomains.verificationStatus),
    nextRetryAtIdx: index('org_domains_next_retry_at_idx').on(organizationDomains.nextRetryAt),
  }
}
```
- `verificationStatusIdx`: Optimize queries for pending domains in background job
- `nextRetryAtIdx`: Optimize queries for domains ready for next retry

---

### 3. serviceDomainMappings (UPDATED TABLE)

**Purpose**: Add routing configuration fields for service reverse proxy setup.

**Location**: `apps/api/src/config/drizzle/schema/domain.ts`

**Existing Schema** (reference):
```typescript
export const serviceDomainMappings = pgTable('service_domain_mappings', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectDomainId: uuid('project_domain_id').notNull().references(() => projectDomains.id, { onDelete: 'cascade' }),
  serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
  subdomain: varchar('subdomain', { length: 255 }),
  basePath: varchar('base_path', { length: 255 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
```

**Schema Changes** (ADD these columns):
```typescript
export const serviceDomainMappings = pgTable('service_domain_mappings', {
  // ... existing columns ...
  
  // NEW: Internal Routing Configuration
  internalPath: varchar('internal_path', { length: 255 }).notNull().default('/'),
  internalPort: integer('internal_port').notNull(),
  stripPathEnabled: boolean('strip_path_enabled').notNull().default(true),
  
  // NEW: Protocol Configuration (JSONB for flexibility)
  protocolConfig: jsonb('protocol_config').notNull().default({
    httpEnabled: true,
    httpsEnabled: true,
    autoRedirectToHttps: true,
  }),
});
```

**Updated TypeScript Types**:
```typescript
export type ServiceDomainMapping = typeof serviceDomainMappings.$inferSelect;
export type NewServiceDomainMapping = typeof serviceDomainMappings.$inferInsert;

// Protocol configuration type
export type ProtocolConfig = {
  httpEnabled: boolean;
  httpsEnabled: boolean;
  autoRedirectToHttps: boolean;
};
```

**New Column Details**:

| Column | Type | Nullable | Default | Purpose |
|--------|------|----------|---------|---------|
| `internalPath` | VARCHAR(255) | NOT NULL | '/' | Internal path to forward requests to (e.g., '/api/v1') |
| `internalPort` | INTEGER | NOT NULL | - | Service container port (e.g., 3000, 8080) |
| `stripPathEnabled` | BOOLEAN | NOT NULL | true | Remove `basePath` before forwarding to service |
| `protocolConfig` | JSONB | NOT NULL | See below | HTTP/HTTPS protocol configuration |

**Protocol Config Default**:
```json
{
  "httpEnabled": true,
  "httpsEnabled": true,
  "autoRedirectToHttps": true
}
```

**Example Routing Configuration**:

**Example 1: API Service**
```
Domain: api.myapp.com (projectDomain)
Subdomain: NULL (root domain)
Base Path: /v1
Internal Path: /api
Internal Port: 3000
Strip Path: true

External Request: https://api.myapp.com/v1/users
Forwarded To: http://service-container:3000/api/users
(Base path /v1 stripped, internal path /api added)
```

**Example 2: Dashboard Service**
```
Domain: myapp.com (projectDomain)
Subdomain: dashboard
Base Path: /
Internal Path: /
Internal Port: 8080
Strip Path: false

External Request: https://dashboard.myapp.com/settings
Forwarded To: http://dashboard-container:8080/settings
```

**Validation Rules**:
- `internalPort`: Must be between 1-65535
- `internalPath`: Must start with `/` or be empty
- `basePath`: Must start with `/` if set
- `protocolConfig.httpEnabled` OR `protocolConfig.httpsEnabled`: At least one must be true

---

### 4. projectDomains (NO CHANGES)

**Purpose**: Many-to-many relationship between projects and organization domains.

**Existing Schema** (reference only - no changes):
```typescript
export const projectDomains = pgTable('project_domains', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  organizationDomainId: uuid('organization_domain_id').notNull().references(() => organizationDomains.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
```

**No changes required** - existing schema sufficient for domain assignment.

---

## Entity Relationships (ERD)

```
organizations (existing)
    ↓ 1:1
organizationSettings (NEW)
    - maxDomains
    - verificationRateLimit
    - maxDomainMappingsPerProject
    - maxConcurrentVerifications
    - maxAutoRetryAttempts
    - autoRetryIntervalHours

organizations (existing)
    ↓ 1:N
organizationDomains (UPDATED)
    - retryAttempts (NEW)
    - lastVerificationAttempt (NEW)
    - nextRetryAt (NEW)
    ↓ N:M (via projectDomains)
projects (existing)
    ↓ 1:N
serviceDomainMappings (UPDATED)
    - internalPath (NEW)
    - internalPort (NEW)
    - stripPathEnabled (NEW)
    - protocolConfig (NEW)
    ↓ N:1
services (existing)
```

---

## Migration Strategy

### Migration File Structure

**File**: `apps/api/src/config/drizzle/migrations/YYYYMMDDHHMMSS_add_domain_management_enhancements.sql`

### Migration Steps

**Step 1: Create `organization_settings` table**
```sql
CREATE TABLE organization_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  max_domains INTEGER NOT NULL DEFAULT 50,
  max_domain_mappings_per_project INTEGER NOT NULL DEFAULT 100,
  max_concurrent_verifications INTEGER NOT NULL DEFAULT 5,
  verification_rate_limit INTEGER NOT NULL DEFAULT 1,
  max_auto_retry_attempts INTEGER NOT NULL DEFAULT 10,
  auto_retry_interval_hours INTEGER NOT NULL DEFAULT 6,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX organization_settings_org_id_idx ON organization_settings(organization_id);
```

**Step 2: Populate default settings for existing organizations**
```sql
-- Backfill settings for existing organizations
INSERT INTO organization_settings (organization_id, created_at, updated_at)
SELECT id, NOW(), NOW()
FROM organizations
WHERE NOT EXISTS (
  SELECT 1 FROM organization_settings WHERE organization_id = organizations.id
);

-- Create trigger to auto-create settings when new organization is created
CREATE OR REPLACE FUNCTION create_organization_settings()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO organization_settings (organization_id, created_at, updated_at)
  VALUES (NEW.id, NOW(), NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER organization_settings_auto_create
AFTER INSERT ON organizations
FOR EACH ROW
EXECUTE FUNCTION create_organization_settings();
```

**Step 3: Add columns to `organization_domains`**
```sql
ALTER TABLE organization_domains
ADD COLUMN retry_attempts INTEGER NOT NULL DEFAULT 0,
ADD COLUMN last_verification_attempt TIMESTAMP,
ADD COLUMN next_retry_at TIMESTAMP;

CREATE INDEX org_domains_verification_status_idx ON organization_domains(verification_status);
CREATE INDEX org_domains_next_retry_at_idx ON organization_domains(next_retry_at);
```

**Step 4: Add columns to `service_domain_mappings`**
```sql
ALTER TABLE service_domain_mappings
ADD COLUMN internal_path VARCHAR(255) NOT NULL DEFAULT '/',
ADD COLUMN internal_port INTEGER NOT NULL DEFAULT 3000,
ADD COLUMN strip_path_enabled BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN protocol_config JSONB NOT NULL DEFAULT '{"httpEnabled": true, "httpsEnabled": true, "autoRedirectToHttps": true}'::jsonb;
```

**Step 5: Update existing service domain mappings with sensible defaults**
```sql
-- Update internal port based on service type (if identifiable)
-- This is a best-effort migration - may require manual review
UPDATE service_domain_mappings
SET internal_port = 3000
WHERE internal_port IS NULL;

-- Ensure all mappings have valid protocol config
UPDATE service_domain_mappings
SET protocol_config = '{"httpEnabled": true, "httpsEnabled": true, "autoRedirectToHttps": true}'::jsonb
WHERE protocol_config IS NULL;
```

### Rollback Strategy

**File**: `apps/api/src/config/drizzle/migrations/YYYYMMDDHHMMSS_add_domain_management_enhancements_rollback.sql`

```sql
-- Rollback Step 5: Remove new columns from service_domain_mappings
ALTER TABLE service_domain_mappings
DROP COLUMN IF EXISTS internal_path,
DROP COLUMN IF EXISTS internal_port,
DROP COLUMN IF EXISTS strip_path_enabled,
DROP COLUMN IF EXISTS protocol_config;

-- Rollback Step 3: Remove new columns from organization_domains
DROP INDEX IF EXISTS org_domains_next_retry_at_idx;
DROP INDEX IF EXISTS org_domains_verification_status_idx;

ALTER TABLE organization_domains
DROP COLUMN IF EXISTS retry_attempts,
DROP COLUMN IF EXISTS last_verification_attempt,
DROP COLUMN IF EXISTS next_retry_at;

-- Rollback Step 1: Drop organization_settings table
DROP INDEX IF EXISTS organization_settings_org_id_idx;
DROP TABLE IF EXISTS organization_settings;
```

---

## Database Queries (Common Operations)

### Query 1: Get organization domain limits
```typescript
// Repository method
async getOrganizationSettings(organizationId: string): Promise<OrganizationSettings> {
  const settings = await db
    .select()
    .from(organizationSettings)
    .where(eq(organizationSettings.organizationId, organizationId))
    .limit(1);
  
  if (!settings[0]) {
    // Create default settings if not exists
    const newSettings = await db
      .insert(organizationSettings)
      .values({ organizationId })
      .returning();
    return newSettings[0];
  }
  
  return settings[0];
}
```

### Query 2: Get pending domains for auto-retry (BullMQ processor)
```typescript
async getPendingDomainsForRetry(): Promise<OrganizationDomain[]> {
  const now = new Date();
  
  return db
    .select()
    .from(organizationDomains)
    .where(
      and(
        eq(organizationDomains.verificationStatus, 'pending'),
        lt(organizationDomains.retryAttempts, 10),
        or(
          isNull(organizationDomains.nextRetryAt),
          lte(organizationDomains.nextRetryAt, now)
        )
      )
    )
    .orderBy(asc(organizationDomains.nextRetryAt));
}
```

### Query 3: Check domain mapping conflicts
```typescript
async checkMappingConflict(
  projectDomainId: string,
  subdomain: string | null,
  basePath: string
): Promise<ServiceDomainMapping | null> {
  return db
    .select()
    .from(serviceDomainMappings)
    .where(
      and(
        eq(serviceDomainMappings.projectDomainId, projectDomainId),
        eq(serviceDomainMappings.subdomain, subdomain),
        eq(serviceDomainMappings.basePath, basePath)
      )
    )
    .limit(1)
    .then(results => results[0] || null);
}
```

### Query 4: Get service mappings for project domain
```typescript
async getMappingsByProjectDomain(projectDomainId: string): Promise<ServiceDomainMapping[]> {
  return db
    .select()
    .from(serviceDomainMappings)
    .where(eq(serviceDomainMappings.projectDomainId, projectDomainId))
    .orderBy(asc(serviceDomainMappings.createdAt));
}
```

### Query 5: Increment retry attempts and schedule next retry
```typescript
async incrementRetryAttempts(domainId: string, retryIntervalHours: number): Promise<void> {
  const nextRetryAt = new Date();
  nextRetryAt.setHours(nextRetryAt.getHours() + retryIntervalHours);
  
  await db
    .update(organizationDomains)
    .set({
      retryAttempts: sql`${organizationDomains.retryAttempts} + 1`,
      lastVerificationAttempt: new Date(),
      nextRetryAt,
      updatedAt: new Date(),
    })
    .where(eq(organizationDomains.id, domainId));
}
```

---

## Data Validation Rules

### OrganizationSettings
- ✅ `maxDomains`: Min: 1, Max: 10000, Default: 50
- ✅ `maxDomainMappingsPerProject`: Min: 1, Max: 1000, Default: 100
- ✅ `maxConcurrentVerifications`: Min: 1, Max: 50, Default: 5
- ✅ `verificationRateLimit`: Min: 1, Max: 100, Default: 1 (requests per hour)
- ✅ `maxAutoRetryAttempts`: Min: 1, Max: 100, Default: 10
- ✅ `autoRetryIntervalHours`: Min: 1, Max: 168, Default: 6

### OrganizationDomain Updates
- ✅ `retryAttempts`: Min: 0, Max: unlimited (but capped by business logic at `maxAutoRetryAttempts`)
- ✅ `lastVerificationAttempt`: Must be <= current time
- ✅ `nextRetryAt`: Must be > current time if set

### ServiceDomainMapping Updates
- ✅ `internalPath`: Must start with `/` or be empty
- ✅ `internalPort`: Min: 1, Max: 65535
- ✅ `stripPathEnabled`: Boolean (true/false)
- ✅ `protocolConfig.httpEnabled` OR `protocolConfig.httpsEnabled`: At least one must be true

---

## Testing Data

### Seed Data for Development

**File**: `apps/api/src/config/drizzle/seeds/domain-management.seed.ts`

```typescript
import { db } from '../db';
import { organizationSettings, organizationDomains, serviceDomainMappings } from '../schema/domain';

export async function seedDomainManagement() {
  // Seed organization settings for test organization
  await db.insert(organizationSettings).values({
    organizationId: 'test-org-id-1',
    maxDomains: 100, // Higher limit for testing
    verificationRateLimit: 10, // Higher rate for testing
    maxDomainMappingsPerProject: 200,
    maxConcurrentVerifications: 10,
    maxAutoRetryAttempts: 5, // Lower for faster testing
    autoRetryIntervalHours: 1, // Shorter interval for testing
  });
  
  // Seed test domains in different states
  await db.insert(organizationDomains).values([
    {
      organizationId: 'test-org-id-1',
      domain: 'verified-example.com',
      verificationMethod: 'txt',
      verificationToken: 'verified-token-123',
      verificationStatus: 'verified',
      verifiedAt: new Date(),
      retryAttempts: 0,
    },
    {
      organizationId: 'test-org-id-1',
      domain: 'pending-example.com',
      verificationMethod: 'txt',
      verificationToken: 'pending-token-456',
      verificationStatus: 'pending',
      retryAttempts: 2,
      lastVerificationAttempt: new Date(Date.now() - 3600000), // 1 hour ago
      nextRetryAt: new Date(Date.now() + 3600000), // 1 hour from now
    },
    {
      organizationId: 'test-org-id-1',
      domain: 'requires-manual.com',
      verificationMethod: 'cname',
      verificationToken: 'manual-token-789',
      verificationStatus: 'requires_manual',
      retryAttempts: 10, // Max attempts reached
      lastVerificationAttempt: new Date(Date.now() - 86400000), // 1 day ago
    },
  ]);
  
  // Seed test service domain mappings
  await db.insert(serviceDomainMappings).values({
    projectDomainId: 'test-project-domain-id-1',
    serviceId: 'test-service-id-1',
    subdomain: 'api',
    basePath: '/v1',
    internalPath: '/api',
    internalPort: 3000,
    stripPathEnabled: true,
    protocolConfig: {
      httpEnabled: true,
      httpsEnabled: true,
      autoRedirectToHttps: true,
    },
  });
}
```

---

## Performance Considerations

### Index Strategy
- ✅ `organization_settings.organization_id` (UNIQUE index) - Fast lookup by org
- ✅ `organization_domains.verification_status` - Optimize pending domain queries
- ✅ `organization_domains.next_retry_at` - Optimize auto-retry job queries
- ✅ Existing indexes on FK columns (projectDomainId, serviceId, etc.)

### Query Optimization
- Use `LIMIT` for paginated domain lists (prevent full table scans)
- Use `WHERE verification_status = 'pending'` with index for auto-retry job (< 5% table scan)
- Cache organization settings in application layer (rarely change)
- Use `SELECT COUNT(*)` with filters for quota checks (efficient with indexes)

### Expected Query Performance
- Organization settings lookup: < 10ms (unique index)
- Pending domains for retry (500+ domains): < 50ms (indexed status + nextRetryAt)
- Conflict detection (500+ mappings): < 30ms (composite index on projectDomainId + subdomain + basePath)
- Domain list with pagination: < 100ms (indexed + limit 50)

---

## Summary

### Tables Modified
- ✅ **NEW**: `organization_settings` (1 table)
- ✅ **UPDATED**: `organization_domains` (+3 columns)
- ✅ **UPDATED**: `service_domain_mappings` (+4 columns)
- ✅ **NO CHANGE**: `project_domains`

### Total Columns Added
- 3 columns to `organization_domains`
- 4 columns to `service_domain_mappings`
- 10 columns in new `organization_settings` table
- **Total**: 17 new columns

### Migration Complexity
- **Difficulty**: Medium (ALTER TABLE + new table creation)
- **Downtime**: None (additive changes only)
- **Rollback**: Safe (separate rollback SQL provided)
- **Data Migration**: Automatic (default values + backfill for existing orgs)

### Next Steps
1. ✅ Data model complete - proceed to contract definitions
2. Create ORPC contracts in `/contracts/` directory
3. Implement Drizzle schema changes in `apps/api/src/config/drizzle/schema/domain.ts`
4. Generate migration SQL using `bun run api -- db:generate`
5. Apply migration using `bun run api -- db:push` (dev) or `bun run api -- db:migrate` (prod)
