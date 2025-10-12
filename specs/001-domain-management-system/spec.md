# Feature Specification: Enhanced Domain Management with Project Registration and Service Routing

**Feature Branch**: `001-domain-management-system`  
**Created**: 2025-10-11  
**Status**: Draft  
**Input**: User description: "Domain management system for organization-based routing with customizable path handling and protocol configuration"

## Clarifications

### Migration Generation Policy (CRITICAL)

**MANDATORY RULES - Never Create Migration Files Manually**:

**Database Migrations**:
- ❌ **FORBIDDEN**: Manually creating files in `apps/api/src/config/drizzle/migrations/`
- ❌ **FORBIDDEN**: Manually editing migration SQL files
- ❌ **FORBIDDEN**: Manually editing snapshot files or `_journal.json`
- ✅ **MANDATORY**: Always use `bun run api -- db:generate` after schema changes
- ✅ **MANDATORY**: Review generated SQL before applying

**Workflow**:
```bash
# 1. Modify schema in apps/api/src/config/drizzle/schema/domain.ts
export const organizationDomains = pgTable('organization_domains', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  domain: text('domain').notNull().unique(),
  // ... add/modify columns
})

# 2. Generate migration (REQUIRED)
bun run api -- db:generate
# Creates: 0001_migration_name.sql, meta/0001_snapshot.json, updates _journal.json

# 3. Review generated SQL
# Verify the generated migration matches intended changes

# 4. Apply to development database
bun run api -- db:push
```

**Better Auth Plugin Changes**:
```bash
# When adding/removing Better Auth plugins:
# 1. Modify apps/api/src/auth.ts (add/remove plugin)
# 2. Generate auth configuration (REQUIRED)
bun run api -- auth:generate
# 3. If schema changed, generate database migration
bun run api -- db:generate
# 4. Apply changes
bun run api -- db:push
```

**Removing Migrations** (only if NOT in production):
```bash
# Step 1: Delete migration SQL file
rm apps/api/src/config/drizzle/migrations/0001_name.sql

# Step 2: Delete snapshot
rm apps/api/src/config/drizzle/migrations/meta/0001_snapshot.json

# Step 3: Remove from _journal.json
# Edit meta/_journal.json and remove entry from "entries" array

# Step 4: Regenerate with corrected schema
bun run api -- db:generate
```

**⚠️ WARNING**: Never remove migrations applied to production. Create new migration to revert.

**Rationale**: Drizzle Kit generates correct SQL, maintains snapshot consistency, and ensures _journal.json integrity. Manual migration creation causes SQL errors, snapshot mismatches, and type safety issues.

### Migration & Seed Execution Policy (CRITICAL)

**AUTOMATIC EXECUTION - Do Not Run Manually**:

**`db:migrate` - Runs Automatically on Container Start**:
- ❌ **DO NOT RUN** on local machine (outside container)
- ✅ **Automatic**: Migrations execute when dev container starts
- 🔧 **Manual run only if**:
  * Generated new migration AND container already running
  * Don't want to restart container
  * Run: `docker exec -it deployer-api-1 bun run db:migrate`
  * **OR** (recommended): Restart container with `bun run dev:api`

**`db:seed` - Runs Automatically on Fresh Container Start**:
- ❌ **NEVER RUN** on local machine
- ❌ **NEVER RUN** in running container (causes data duplication)
- ✅ **Automatic**: Seed executes when container starts with fresh volumes
- 🔄 **To re-seed** (only when seed data changed):
  ```bash
  docker compose down -v  # Remove volumes
  bun run dev:api         # Restart with fresh DB (auto-seeds)
  ```

**Development Scenarios**:

```bash
# Scenario 1: Just generated new migration
# Recommended approach:
bun run dev:api  # Restart container (migrations run automatically)

# Alternative (if container must stay running):
docker exec -it deployer-api-1 bun run db:migrate

# Scenario 2: Updated seed data, need fresh database
docker compose down -v  # Remove volumes
bun run dev:api         # Migrations + seed run automatically

# Scenario 3: Iterating on schema (development)
bun run api -- db:generate  # Generate migration
bun run api -- db:push      # Apply directly (faster than migrate)
```

**When to Use Each Command**:

| Command | Use Case | Frequency |
|---------|----------|----------|
| `db:generate` | After schema changes | Every schema change |
| `db:push` | Development iteration | During active development |
| `db:migrate` | Manual migration run | Rarely (automatic on start) |
| `db:seed` | Manual seed run | Never (automatic on fresh volumes) |
| `db:studio` | Database inspection | As needed |

**Rationale**: 
- **Automatic migrations** prevent database drift and ensure consistency
- **Automatic seeding** gives developers fresh test data without manual steps
- **Container restart** is the safest way to apply migrations and re-seed
- **Manual runs** only needed in specific edge cases to avoid container restart

### Code Replacement Policy (Mandatory)

**CRITICAL REQUIREMENT**: All new implementations MUST completely replace legacy code.

**Rules**:
- ❌ **FORBIDDEN**: Leaving old and new implementations side-by-side
- ❌ **FORBIDDEN**: Commenting out old code "just in case"
- ❌ **FORBIDDEN**: Renaming with `_old`, `_legacy`, `_deprecated` suffixes
- ✅ **MANDATORY**: Complete deletion of old code when new implementation is ready
- ✅ **MANDATORY**: Update all references to use new implementation
- ✅ **MANDATORY**: Add explanatory comments for non-trivial architectural changes

**Comment Requirements**:
- Add 2-5 line comments explaining WHY, WHAT, and HOW for significant changes
- Reference spec requirements (FR-XXX) when applicable
- Place at top of new implementation, not scattered throughout
- Skip comments for simple refactoring or formatting changes

**Example**:
```typescript
// ❌ WRONG: Both implementations present
class DomainService {
  async verifyDomainOld(domain: string) { ... }  // Legacy
  async verifyDomain(domain: string) { ... }     // New
}

// ✅ CORRECT: Only new implementation with comment
/**
 * Domain verification service using native DNS resolution.
 * 
 * REPLACED: Third-party DNS API with Node.js dns module
 * - Rationale: Zero dependencies, works with any DNS provider (FR-004)
 */
class DomainService {
  async verifyDomain(domain: string): Promise<VerificationResult> { ... }
}
```

**Enforcement**: Pull requests with legacy code alongside new code will be rejected. Git history preserves old implementations - no need to keep in codebase.

### DNS Verification Mechanism (Clarified: 2025-10-11)

**Question**: How should DNS verification be performed?

**Decision**: Native DNS Resolution (Option A)

**Rationale**:
- **Zero external dependencies**: Works immediately without API keys or provider setup
- **Universal compatibility**: Works with any DNS provider (Route53, Cloudflare, Namecheap, GoDaddy, etc.)
- **Simple implementation**: Use Node.js `dns.resolve()` or similar built-in DNS resolution capabilities
- **No additional cost**: No third-party API fees or rate limits
- **Sufficient for MVP**: 24-48 hour verification delay is acceptable for domain setup (one-time operation)
- **Industry standard**: Matches how Google Workspace, GitHub Pages, and Vercel verify domain ownership

**Implementation Notes**:
- System performs direct DNS TXT/CNAME record queries using native DNS resolution
- No third-party DNS API integration required
- Verification may take 24-48 hours due to DNS propagation delays (handled in edge cases)
- Automatic retry mechanism checks pending domains every 6 hours
- Users can manually trigger verification at any time via "Verify Now" button

### Permission Model for Domain Management (Clarified: 2025-10-11)

**Question**: What is the permission model for domain management operations?

**Decision**: Organization Role-Based Access Control (Option A)

**Rationale**:
- **Aligns with existing architecture**: Project already has organization → project hierarchy
- **Security best practice**: Implements principle of least privilege (developers can't delete org domains)
- **Clear mental model**: Maps to real-world organizational structures and team responsibilities
- **Prevents accidental deletion**: Only owners can delete domains used by multiple projects
- **Scalable**: Works equally well for small teams and large organizations

**Role Definitions & Permissions**:

| Role | Add Org Domain | Verify Domain | Delete Org Domain | Assign to Project | Configure Service Mapping |
|------|----------------|---------------|-------------------|-------------------|---------------------------|
| **Organization Owner** | ✅ | ✅ | ✅ (all domains) | ✅ (all projects) | ✅ (all services) |
| **Organization Admin** | ✅ | ✅ | ✅ (unused only) | ✅ (all projects) | ✅ (all services) |
| **Project Admin** | ❌ | ❌ | ❌ | ✅ (own project) | ✅ (own project) |
| **Project Member** | ❌ | ❌ | ❌ | ❌ | ✅ (own project) |

**Implementation Notes**:
- Organization Owner can perform all domain operations across the entire organization
- Organization Admin can manage domains but cannot delete domains currently in use by any project
- Project Admin can assign existing verified org domains to their project and configure service mappings
- Project Member can only configure service domain mappings for services they have access to
- All role checks enforced at API level with authorization guards
- UI elements disabled/hidden based on user role (progressive disclosure)

### Rate Limiting & Resource Constraints (Clarified: 2025-10-11)

**Question**: What rate limiting and resource constraints should be enforced?

**Decision**: Conservative Limits (Option A) with Organization Settings Configuration

**Rationale**:
- **Prevents abuse**: DNS verification spam, domain hoarding, resource exhaustion
- **Cost control**: Limits SSL certificate provisioning costs and DNS query expenses
- **Reasonable for MVP**: Default limits sufficient for 95% of organizations
- **Configurable per organization**: Limits stored in organization settings, not hard-coded
- **Graceful degradation**: Soft limits with clear error messages and upgrade paths
- **Performance protection**: Prevents query overload on domain lookups and database

**Default Limit Values** (Configurable in Organization Settings):

| Constraint | Default Value | Configurable | Purpose |
|------------|---------------|--------------|----------|
| **Domain Quota** | 50 domains | ✅ Yes | Maximum organization domains allowed |
| **Verification Rate Limit** | 1/minute/domain | ✅ Yes | Manual verification attempts (auto-retry exempt) |
| **Domain Mappings per Project** | 100 mappings | ✅ Yes | Maximum service domain mappings per project |
| **Concurrent Verifications** | 5 simultaneous | ✅ Yes | Maximum parallel verification requests per org |
| **Auto-Retry Attempts** | 10 attempts | ✅ Yes | Maximum automatic verification retries |
| **Auto-Retry Interval** | 6 hours | ✅ Yes | Time between automatic verification attempts |

**Implementation Notes**:
- Limits stored in `OrganizationSettings` table with fallback to system defaults
- Organization Owners can modify limits via organization settings page
- System displays current usage vs. limits (e.g., "23/50 domains used")
- When limit reached, display clear error message with current usage and upgrade options
- API endpoints enforce limits before performing operations
- Limits can be increased per-organization without code changes (e.g., for enterprise customers)

### Notification System for Domain Events (Clarified: 2025-10-11)

**Question**: How should users be notified about domain verification status and errors?

**Decision**: In-App Notifications Only (Option A)

**Rationale**:
- **Zero external dependencies**: No email service setup or API integration required
- **Immediate feedback**: Real-time status updates via polling or WebSocket
- **Simple implementation**: Reuse existing in-app notification system
- **Sufficient for MVP**: Domain operations are typically interactive (user is present during verification)
- **Cost effective**: No email service fees or deliverability management
- **Privacy friendly**: No email tracking, spam concerns, or external data sharing

**Notification Types**:

| Event | Notification Type | Duration | Appearance |
|-------|------------------|----------|------------|
| **Verification Success** | Toast (success) | 5 seconds | Green checkmark, "Domain example.com verified successfully" |
| **Verification Failure** | Toast (error) | 10 seconds | Red X icon, "Domain verification failed: TXT record not found" |
| **Domain Created** | Toast (info) | 5 seconds | Blue info icon, "Domain example.com added. Verification required." |
| **Domain Deleted** | Toast (warning) | 5 seconds | Orange warning, "Domain example.com and all mappings deleted" |
| **Conflict Detected** | Toast (warning) | 8 seconds | Orange warning, "Routing conflict detected for api.example.com" |
| **Rate Limit Hit** | Toast (warning) | 5 seconds | Orange clock icon, "Verification rate limit. Retry in 45s." |
| **Quota Limit Reached** | Toast (error) | 10 seconds | Red stop icon, "Domain limit reached (50/50). Upgrade needed." |

**Real-Time Updates**:
- **Polling strategy**: Status badges and domain lists refresh every 30 seconds when page is active
- **Notification panel**: Persistent event history (last 50 events) accessible via notification bell icon
- **Badge updates**: Automatic status chip color changes (yellow→green for verification success)
- **Visual feedback**: Animated checkmark when verification succeeds, shake animation on error

**Implementation Notes**:
- Toast notifications auto-dismiss after specified duration with manual dismiss option (X button)
- Notification panel persists events for current session (cleared on logout)
- All notifications include timestamp and relevant domain name
- Clicking notification navigates to relevant page (e.g., organization domains page)
- Future enhancement: Email notifications can be added in later iteration without specification changes

### Bulk Operations Support (Clarified: 2025-10-11)

**Question**: Should the system support bulk operations for domain management?

**Decision**: No Bulk Operations for MVP (Option A)

**Rationale**:
- **MVP simplicity**: Focus on core individual domain operations first
- **Typical usage patterns**: Most organizations manage 10-20 domains; individual operations are acceptable for this scale
- **Clear user intent**: Single-domain actions reduce risk of accidental bulk deletions or misconfigurations
- **Easier error handling**: No partial success scenarios or complex rollback logic required
- **Faster implementation**: Reduces development time, allowing earlier feature delivery
- **Future enhancement path**: Can add bulk verify and bulk delete in iteration 2 based on user feedback and usage patterns

**Scope for MVP**:
- All domain operations performed individually (one domain at a time)
- No multi-select checkboxes on domain lists
- No "Select All" or "Bulk Actions" UI elements
- Each operation (verify, delete, assign) requires explicit individual action

**Future Enhancement Considerations** (Out of Scope for MVP):
- **Phase 2 (if requested)**: Bulk verify for multiple pending domains, bulk delete for unused domains
- **Phase 3 (if requested)**: Bulk assign domains to projects, bulk export/import domain lists
- Decision to implement bulk operations will be based on: user feedback, typical domain counts per organization, and frequency of bulk operation requests

**Implementation Notes**:
- Individual operations provide clearer audit trails (one event per domain)
- Error messages simpler to display and debug (no partial failure states)
- Confirmation dialogs clearer (single domain context vs. "X domains selected")
- UI remains uncluttered without checkbox columns and bulk action toolbars

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Project Domain Registration with Auto-Organization Domain Creation (Priority: P1)

A **project administrator** needs to quickly assign domains to a project, including domains that haven't been registered to the organization yet, without switching between organization and project settings pages.

**User Role**: Project Admin (minimum required role)

**Why this priority**: This is the foundation for domain assignment. Without the ability to assign domains to projects, no services can use domains. The auto-registration feature significantly improves user experience by eliminating context switching.

**Independent Test**: Can be fully tested by logging in as a Project Admin, navigating to project domain settings, selecting multiple domains from a multi-select interface (including typing new domains), submitting the form, and verifying that: (1) new domains are added to the organization's domain list with pending verification status, (2) all selected domains (existing + new) are assigned to the project, (3) verification instructions appear for newly created domains, (4) only Organization Owners/Admins can verify these domains.

**Acceptance Scenarios**:

1. **Given** a project without any assigned domains, **When** the administrator opens the project domain settings page, **Then** they see a multi-select interface showing all verified organization domains and an option to type new domain names
2. **Given** the multi-select domain interface is open, **When** the administrator types a new domain name (e.g., "newdomain.com") that doesn't exist in the organization, **Then** the system creates a tag/chip for the new domain and marks it as "New - Requires Verification"
3. **Given** multiple domains are selected (mix of existing verified domains and new unverified domains), **When** the administrator submits the domain assignment, **Then** the system:
   - Creates organization domain records for each new domain with status "pending"
   - Assigns all selected domains (existing + new) to the project
   - Returns verification instructions for each new domain
   - Displays success confirmation with next steps
4. **Given** a new domain was added during project assignment, **When** the domain list is refreshed, **Then** the new domain appears in both the organization domain list and project domain list with verification status "pending"
5. **Given** a domain with verification status "pending", **When** verification is completed at the organization level, **Then** the domain becomes available for full use across all projects

---

### User Story 2 - Service Domain Mapping with Internal Routing Configuration (Priority: P1)

A **Project Member** needs to configure how external requests are routed to internal container services, including specifying subdomain, base path (external), internal path, internal port, and whether the external base path should be stripped before forwarding to the container.

**User Role**: Project Member (minimum required role)

**Why this priority**: This is the core routing functionality that determines how traffic flows to services. Without this, services cannot receive traffic. This must be implemented immediately after domain assignment to provide a complete MVP.

**Independent Test**: Can be fully tested by logging in as a Project Member, creating a service, opening its domain mapping settings, selecting a project domain, configuring subdomain (e.g., "api"), external base path (e.g., "/v1"), internal path (e.g., "/"), internal port (e.g., "3000"), enabling "Strip Path" option, and verifying the configuration preview shows "https://api.example.com/v1 → http://container:3000/" with the note "External path /v1 will be stripped before forwarding".

**Acceptance Scenarios**:

1. **Given** a service that needs domain configuration, **When** the developer opens the service domain mapping interface, **Then** they see a form with fields for:
   - Domain selection (from assigned project domains)
   - Subdomain (optional text field)
   - External base path (optional text field with validation)
   - Internal path (text field, defaults to "/")
   - Internal port (number field, defaults to service's exposed port)
   - Strip Path toggle (checkbox, defaults to enabled)
2. **Given** the domain mapping form is filled with subdomain="api", externalBasePath="/v1", internalPath="/", port=3000, stripPath=true, **When** the configuration is saved, **Then** the system creates a routing rule that:
   - Accepts requests at https://api.example.com/v1/*
   - Strips "/v1" from the request path
   - Forwards to http://internal-service:3000/*
3. **Given** stripPath is disabled (unchecked), **When** a request arrives at https://api.example.com/v1/users, **Then** the request is forwarded to http://internal-service:3000/v1/users (path preserved)
4. **Given** stripPath is enabled (checked), **When** a request arrives at https://api.example.com/v1/users, **Then** the request is forwarded to http://internal-service:3000/users (path stripped)
5. **Given** no external base path is configured, **When** stripPath toggle is displayed, **Then** the toggle is disabled/grayed out with tooltip "Only applicable when external base path is set"
6. **Given** a complete domain mapping configuration, **When** viewing the service domain list, **Then** each mapping shows:
   - Full external URL (e.g., "https://api.example.com/v1")
   - Internal routing (e.g., "→ container:3000/")
   - Strip path status (e.g., "Path stripping: Enabled")

---

### User Story 3 - Protocol Configuration with HTTPS Auto-Redirect (Priority: P2)

A **security-conscious administrator** (Project Admin or higher) needs to configure whether services accept HTTP, HTTPS, or both protocols, with the option to automatically redirect HTTP requests to HTTPS for enhanced security.

**User Role**: Project Admin (minimum required role)

**Why this priority**: Essential for production security but can be implemented after basic routing is working. Most services default to HTTPS-only, making this a P2 priority.

**Independent Test**: Can be fully tested by logging in as a Project Admin, configuring a service domain mapping with protocol options (HTTP only, HTTPS only, Both, or Both with HTTP→HTTPS redirect), making test requests via HTTP and HTTPS, and verifying: (1) requests are accepted/rejected based on configuration, (2) HTTP requests are redirected to HTTPS when auto-redirect is enabled, (3) SSL certificates are provisioned when HTTPS is enabled.

**Acceptance Scenarios**:

1. **Given** a service domain mapping form, **When** configuring protocol settings, **Then** the administrator sees options:
   - "HTTPS Only" (default, recommended)
   - "HTTP Only" (not recommended, shows warning)
   - "Both HTTP and HTTPS" (shows security notice)
   - "Both with Auto-Redirect to HTTPS" (recommended for gradual migration)
2. **Given** protocol is set to "HTTPS Only", **When** an HTTP request arrives at http://api.example.com/users, **Then** the system:
   - Rejects the connection OR
   - Returns a redirect to https://api.example.com/users (based on platform policy)
3. **Given** protocol is set to "Both with Auto-Redirect to HTTPS", **When** an HTTP request arrives, **Then** the system responds with HTTP 301/302 redirect to the HTTPS equivalent URL
4. **Given** HTTPS is enabled for a domain mapping, **When** the configuration is saved, **Then** the system initiates SSL certificate provisioning using the configured SSL provider (Let's Encrypt, custom, or none)
5. **Given** a domain mapping with auto-redirect enabled, **When** viewing the domain mapping details, **Then** the protocol configuration shows "HTTP → HTTPS (Auto-Redirect)" with a green security badge

---

### User Story 4 - Organization Domain Management Dashboard (Priority: P1)

An **organization administrator** (Organization Admin or Owner) needs a centralized dashboard to manage all organization domains, view their verification status, see usage across projects, trigger verification checks, and identify conflicts - all from a single interface.

**User Role**: Organization Admin (minimum required role)

**Why this priority**: This is the primary entry point for domain management. Administrators need visibility into domain ownership, verification status, and usage before they can effectively assign domains to projects. Without this dashboard, domain management becomes fragmented and error-prone.

**Independent Test**: Can be fully tested by logging in as an Organization Admin, navigating to the organization domains page and verifying that: (1) all domains are listed with verification status chips (verified/pending/failed), (2) clicking "Verify" on a pending domain triggers verification and updates status, (3) clicking "Add Domain" opens a form to register new domains, (4) expanding a domain shows all projects using it with subdomain/path details, (5) conflict warnings appear for domains with routing conflicts, (6) "Delete" button is disabled for domains in use (with tooltip explaining Organization Owner required).

**Acceptance Scenarios**:

1. **Given** an organization with multiple domains (verified, pending, and failed), **When** the administrator views the organization domains page, **Then** they see a list of all domains with:
   - Domain name (e.g., "example.com")
   - Verification status chip (green "Verified", yellow "Pending", red "Failed")
   - Verification method (TXT record, CNAME record)
   - Date added and date verified (if applicable)
   - Action buttons (Verify, View Usage, Delete)

2. **Given** a domain with status "pending", **When** the administrator clicks the "Verify Now" button, **Then** the system:
   - Initiates DNS verification check
   - Shows loading indicator during verification
   - Updates status chip to "Verified" (green) if successful
   - Updates status chip to "Failed" (red) if unsuccessful with error details
   - Displays verification timestamp

3. **Given** the organization domains page, **When** the administrator clicks "Add Domain", **Then** a modal/form appears with fields for:
   - Domain name (text input with DNS validation)
   - Verification method selection (TXT record or CNAME record)
   - Submit button to create domain
   - Verification instructions preview

4. **Given** a verified domain in the list, **When** the administrator clicks "View Usage" or expands the domain row, **Then** they see:
   - Total number of projects using this domain
   - List of projects with expandable details:
     * Project name and ID
     * Assigned subdomains for that project
     * Services using this domain with subdomain+basePath combinations
     * Full URL for each service mapping (e.g., "https://api.example.com/v1")
   - If no projects are using the domain: "Not in use - Available for assignment"

5. **Given** a domain with routing conflicts (same subdomain+basePath used by multiple services), **When** viewing the domain usage, **Then** conflict warnings appear:
   - Red warning icon next to conflicting mappings
   - Warning message: "Conflict detected: Multiple services using api.example.com/v1"
   - List of conflicting services with links to their configuration
   - Suggestion to resolve conflict (e.g., "Use different base paths or subdomains")

6. **Given** a domain that is used by one or more projects, **When** attempting to delete it, **Then** the system:
   - Displays warning modal: "This domain is used by X projects and Y services"
   - Lists affected projects and services
   - Requires confirmation: "Type 'DELETE' to confirm"
   - Prevents accidental deletion

7. **Given** multiple domains in the list, **When** filtering or searching domains, **Then** the administrator can:
   - Search by domain name (real-time filtering)
   - Filter by verification status (Verified, Pending, Failed, All)
   - Sort by: Domain name (A-Z), Date added (newest/oldest), Verification date

---

### User Story 5 - Subdomain and Path Conflict Detection with Suggestions (Priority: P2)

A **Project Member** needs clear feedback when attempting to create a domain mapping that conflicts with existing mappings, along with actionable suggestions to resolve the conflict.

**User Role**: Project Member (minimum required role)

**Why this priority**: Prevents routing errors and improves developer experience, but basic routing can work without sophisticated conflict detection. Can be implemented after P1 stories.

**Independent Test**: Can be fully tested by logging in as a Project Member, creating a service domain mapping with subdomain="api" and basePath=null (root), then attempting to create a second mapping with the same subdomain="api" and basePath=null, and verifying that: (1) the system prevents the duplicate, (2) error message explains the conflict clearly, (3) suggestions include available base paths like "/v1", "/v2", "/api".

**Acceptance Scenarios**:

1. **Given** a service domain mapping exists with subdomain="api" and basePath=null, **When** a developer attempts to create another mapping with subdomain="api" and basePath=null on the same domain, **Then** the system displays an error: "Conflict: api.example.com is already in use. Suggestions: Use base paths like /v1, /v2, or /api to differentiate services."
2. **Given** a service domain mapping exists with subdomain="api" and basePath="/v1", **When** a developer attempts to create a mapping with subdomain="api" and basePath="/v2", **Then** the system allows the creation (different paths, no conflict)
3. **Given** a conflict is detected, **When** viewing the error message, **Then** the developer sees:
   - Clear explanation of what's conflicting
   - Link to the existing service using that URL
   - List of available base paths (e.g., "/v1", "/v2", "/v3", "/api", "/app")
   - Option to use a different subdomain
4. **Given** real-time conflict checking is enabled, **When** the developer types a subdomain and base path, **Then** the system shows inline validation feedback indicating whether the combination is available (green checkmark) or conflicts (red warning with suggestions)

---

### Edge Cases

- **What happens when** DNS verification is triggered but the DNS records haven't propagated yet?
  - System returns "Pending - DNS not propagated" status
  - User sees message: "Verification failed. DNS changes may take up to 48 hours to propagate. Try again later."
  - System tracks lastVerificationAttempt timestamp to prevent spam
  - Automatic retry mechanism checks pending domains every 6 hours
  - User can manually retry verification at any time

- **What happens when** viewing domain usage and a service is deleted while the usage panel is open?
  - Real-time polling (every 30 seconds) detects deletion and updates usage view
  - Deleted service fades out from usage list with animation
  - Project count decrements automatically
  - If project becomes empty (no services), shows "No services configured"
  - Conflict warnings update automatically if deletion resolved a conflict
  - Toast notification appears: "Service {name} removed from domain mapping"

- **What happens when** multiple administrators try to verify the same domain simultaneously?
  - First successful verification wins
  - Other attempts receive "Already verified" response
  - Database constraint ensures only one verification timestamp
  - All administrators receive toast notification: "Domain {domain} verified successfully"
  - Status chips update automatically via polling (within 30 seconds) for all viewing the page
  - Notification panel shows event for all organization members

- **What happens when** a user selects a domain for a project that is later deleted at the organization level?
  - System prevents deletion if domain is in use by any project (shows error: "Cannot delete domain - in use by 3 projects")
  - If force-deleted, project domains are automatically cleaned up (cascade delete)
  - Services using that domain are marked as "misconfigured" with alerts
  
- **What happens when** verification fails for a newly added domain during project assignment?
  - Domain remains in organization and project domain lists with status "pending"
  - Services cannot use unverified domains (selection disabled with tooltip)
  - User receives toast notification: "Domain verification failed: {error_reason}. Retry available."
  - Notification panel shows event with timestamp and link to organization domains page
  - System continues automatic retry attempts every 6 hours (up to 10 attempts)
  - User can manually retry verification at any time via "Verify Now" button
  
- **What happens when** two services try to use the same subdomain+basePath combination simultaneously?
  - First service to save gets the mapping
  - Second service receives conflict error with real-time notification
  - Race condition prevented by database unique constraint
  
- **What happens when** the internal path contains special characters or is malformed?
  - System validates path format (must start with "/", no spaces, URL-safe characters only)
  - Displays validation error before allowing save
  - Suggests corrected path format (e.g., "/my path" → "/my-path")
  
- **What happens when** Strip Path is enabled but the incoming request path doesn't match the configured external base path?
  - System handles gracefully: if request is to /api/users but basePath is /v1, path stripping only applies to /v1 prefix
  - Requests not matching base path are forwarded as-is or rejected based on routing rules
  
- **What happens when** a domain mapping has HTTPS enabled but SSL certificate provisioning fails?
  - Service shows status "SSL Provisioning Failed" with error details
  - Administrator receives notification with troubleshooting steps
  - Service falls back to HTTP or shows "Service Unavailable" based on configuration
  - Retry button available to re-attempt certificate provisioning

- **What happens when** searching/filtering domains and new domains are added by another administrator?
  - New domains appear in real-time if they match current filter
  - Search results update dynamically
  - Empty state changes to populated list automatically
  - User sees subtle notification: "1 new domain added"

- **What happens when** an organization reaches its domain quota limit while a user is adding domains?
  - Real-time validation prevents form submission if quota would be exceeded
  - Error message displays: "Domain limit reached (50/50 domains used). Remove unused domains or contact administrator to increase limit."
  - If multiple domains being added would exceed quota, system identifies which domains can fit within remaining quota
  - Organization settings page shows "Increase Limit" button for Organization Owners

- **What happens when** a user attempts to verify a domain too quickly (rate limit hit)?
  - "Verify Now" button becomes disabled with countdown timer (e.g., "Retry in 45s")
  - Error message explains: "Verification rate limit reached. Please wait before retrying."
  - Automatic background retries continue unaffected
  - User can verify different domains (rate limit is per-domain, not per-organization)

## Requirements *(mandatory)*

**Note**: All domain management operations are individual (one domain at a time) for MVP. Bulk operations (multi-select, bulk verify, bulk delete) are intentionally excluded to simplify implementation and UX. Future iterations may add bulk capabilities based on user feedback.

### Functional Requirements

#### Organization Domain Management Dashboard

- **FR-001**: Organization domains page MUST display a table/list of all domains owned by the organization with columns for:
  - Domain name
  - Verification status (with colored chip/badge indicator)
  - Verification method (TXT or CNAME)
  - Date added (createdAt)
  - Date verified (verifiedAt, if applicable)
  - Actions (Verify, View Usage, Delete)

- **FR-002**: Verification status chip MUST use distinct visual indicators:
  - **Verified**: Green chip with checkmark icon
  - **Pending**: Yellow/orange chip with clock icon
  - **Verifying**: Blue chip with spinner icon (check in progress)
  - **Failed-Temporary**: Orange chip with warning icon (DNS propagation delay, retryable)
  - **Failed-Permanent**: Red chip with error icon (token mismatch, requires manual fix)

- **FR-003**: System MUST provide "Verify Now" button for domains with status "pending" or "failed"

- **FR-004**: When "Verify Now" is clicked, system MUST:
  - Update status to "verifying" and display loading/progress indicator
  - Initiate real-time DNS verification check using native DNS resolution (e.g., Node.js `dns.resolve()`)
  - Query DNS TXT records (for TXT verification) or CNAME records (for CNAME verification) for the domain
  - Extract verification token from DNS record
  - Update status to "verified" if token found and matches expected value
  - Update status based on failure reason:
    * "failed-temporary" (DNS propagation delay) if: NXDOMAIN response OR "TXT record not found" OR "DNS query failed" (network/timeout)
    * "failed-permanent" (user action required) if: "Token mismatch" (record exists but value incorrect)
  - Update verifiedAt timestamp if successful
  - Display specific error details if verification fails:
    * "DNS not yet propagated (NXDOMAIN)" → failed-temporary
    * "TXT record not found" → failed-temporary
    * "DNS query failed (network error, timeout)" → failed-temporary
    * "Token mismatch (expected: X, found: Y)" → failed-permanent

- **FR-005**: Organization domains page MUST provide "Add Domain" button that opens a form/modal with:
  - Domain name input field (with real-time DNS format validation)
  - Verification method radio buttons (TXT record / CNAME record)
  - Submit button
  - Cancel button

- **FR-006**: Add domain form MUST validate domain name format before submission:
  - Valid DNS format (e.g., "example.com", "staging.app.io")
  - Not already registered to this organization
  - No invalid characters or formatting

- **FR-007**: When adding a new domain, system MUST:
  - Generate unique verification token
  - Create organization domain record with status "pending"
  - Display verification instructions immediately (DNS record to add)
  - Add domain to the domains list
  - Optionally auto-copy verification instructions to clipboard

- **FR-008**: Each domain row MUST provide "View Usage" action (button or expandable row)

- **FR-009**: When "View Usage" is activated, system MUST display:
  - Count: "Used by X projects" or "Not in use"
  - List of projects using this domain with project names
  - For each project: expandable section showing services
  - For each service: subdomain, basePath, full URL, service name

- **FR-010**: Domain usage view MUST show service domain mappings grouped by project:
  ```
  Project: E-Commerce Platform
    ├─ API Service: api.example.com/v1
    ├─ Web Service: example.com
    └─ Admin Panel: admin.example.com
  
  Project: Staging Environment
    └─ Staging API: api-staging.example.com
  ```

- **FR-011**: System MUST detect routing conflicts at the organization level:
  - Identify when same subdomain+basePath combination exists across multiple services
  - Flag conflicts even if services are in different projects
  - Example conflict: Project A's API at "api.example.com" AND Project B's API at "api.example.com"

- **FR-012**: When routing conflicts are detected, system MUST:
  - Display red warning icon next to affected domain
  - Show warning badge with conflict count (e.g., "2 conflicts")
  - In usage view, highlight conflicting mappings in red/yellow
  - Display conflict message: "Conflict: Multiple services using {url}"
  - List all services involved in conflict with links to their configuration pages

- **FR-013**: Conflict warnings MUST include resolution suggestions:
  - "Use different subdomains (e.g., api-v1, api-v2)"
  - "Add base paths to differentiate (e.g., /project-a, /project-b)"
  - "Consider using project-specific subdomains"

- **FR-014**: Organization domains page MUST provide search/filter capabilities:
  - Real-time search by domain name (debounced, client-side filtering)
  - Filter dropdown: All / Verified / Pending / Failed
  - Sort options: Domain name (A-Z, Z-A), Date added (newest, oldest), Date verified

- **FR-015**: When attempting to delete a domain, system MUST:
  - Check if domain is in use (assigned to any project)
  - If in use: Display warning modal with usage details
  - Warning message: "This domain is used by X projects and Y services. Deletion will remove all configurations."
  - List affected projects and services in modal
  - Require typed confirmation ("DELETE") to proceed
  - If not in use: Show simple confirmation dialog

- **FR-016**: Domain deletion MUST cascade delete:
  - All project domain assignments
  - All service domain mappings using this domain
  - System MUST maintain transaction integrity (all or nothing)

- **FR-017**: Organization domains page MUST display helpful empty states:
  - If no domains exist: "No domains added yet. Click 'Add Domain' to get started."
  - If search returns no results: "No domains match '{query}'"
  - If filter returns no results: "No {status} domains found"

- **FR-018**: Domain verification instructions MUST be easily accessible:
  - Display instructions immediately when adding domain
  - Provide "View Verification Instructions" button for pending domains
  - Instructions must include:
    * DNS record type (TXT or CNAME)
    * Record name/host
    * Record value (verification token)
    * Example of correct DNS configuration
  - "Copy to Clipboard" button for each instruction component

#### Project Domain Registration

- **FR-001**: System MUST provide a multi-select interface on the project domain settings page showing all verified organization domains
- **FR-002**: Multi-select interface MUST allow administrators to type new domain names that don't exist in the organization's domain registry
- **FR-003**: When a new domain name is typed in the multi-select, system MUST create a visual indicator (tag/chip) marked as "New - Requires Verification"
- **FR-004**: System MUST validate domain name format before accepting it (valid DNS format, e.g., "example.com", "app.staging.io")
- **FR-005**: When submitting domain assignment with new domains, system MUST:
  - Create organization domain records for each new domain with verification status "pending"
  - Assign all selected domains (existing verified + new pending) to the project
  - Generate unique verification tokens for each new domain
  - Return DNS verification instructions for each new domain
- **FR-006**: System MUST support both TXT record and CNAME record verification methods for new domains
- **FR-007**: Newly created domains MUST appear in the organization domain list immediately with status "pending verification"
- **FR-026**: System MUST prevent duplicate domain assignments to the same project (show warning if domain already assigned)

#### Service Domain Mapping & Internal Routing

- **FR-027**: Service domain mapping interface MUST provide fields for:
  - Project domain selection (dropdown from assigned project domains)
  - Subdomain (optional text input)
  - External base path (optional text input with "/" prefix validation)
  - Internal path (path where container service listens, required text input, defaults to "/")
  - Internal port (required number input, defaults to service's primary exposed port)
  - Strip Path toggle (checkbox, defaults to enabled)
- **FR-028**: System MUST validate subdomain format (alphanumeric, hyphens allowed, no spaces, max 63 characters per label)
- **FR-029**: System MUST validate external base path format (must start with "/", no trailing slash except for root "/", URL-safe characters only, max 255 characters)
- **FR-030**: System MUST validate internal path format (must start with "/", URL-safe characters only)
- **FR-031**: System MUST validate internal port number (1-65535 range)
- **FR-032**: When Strip Path is enabled and external base path is configured, system MUST:
  - Remove the external base path from the incoming request before forwarding to container
  - Example: External https://api.example.com/v1/users → Internal http://container:3000/users
- **FR-033**: When Strip Path is disabled, system MUST preserve the full path when forwarding:
  - Example: External https://api.example.com/v1/users → Internal http://container:3000/v1/users
- **FR-034**: When no external base path is configured, Strip Path toggle MUST be disabled/grayed out (not applicable)
- **FR-035**: System MUST generate and display a routing configuration preview showing:
  - Full external URL (e.g., "https://api.example.com/v1")
  - Internal routing target (e.g., "http://container-name:3000/")
  - Path stripping status (e.g., "Path /v1 will be stripped" or "Path preserved")
- **FR-036**: System MUST store domain mapping configuration in the service_domain_mappings table with new fields:
  - internalPath (container path where service listens)
  - internalPort (container port)
  - stripPathEnabled (boolean flag for path stripping)

#### Protocol Configuration

- **FR-037**: Service domain mapping interface MUST provide protocol configuration options:
  - "HTTPS Only" (default)
  - "HTTP Only"
  - "Both HTTP and HTTPS"
  - "Both with Auto-Redirect to HTTPS"
- **FR-038**: When "HTTP Only" is selected, system MUST display a security warning: "Not recommended for production. Traffic will not be encrypted."
- **FR-039**: When "Both HTTP and HTTPS" is selected, system MUST display a notice: "Services will accept both protocols. Consider enabling auto-redirect for better security."
- **FR-040**: When protocol includes HTTPS, system MUST initiate SSL/TLS certificate provisioning using the configured SSL provider (Let's Encrypt, custom, or self-signed)
- **FR-041**: When "Both with Auto-Redirect to HTTPS" is enabled, system MUST configure routing to:
  - Accept HTTP requests
  - Respond with HTTP 301 (permanent) or 302 (temporary) redirect to HTTPS equivalent URL
  - Preserve path and query parameters in redirect
- **FR-042**: System MUST display protocol configuration status on domain mapping list:
  - "HTTPS Only" with green padlock icon
  - "HTTP Only" with warning icon
  - "Both" with info icon
  - "HTTP → HTTPS" with green redirect icon
- **FR-043**: System MUST track SSL certificate status (provisioning, active, expired, failed) and display in domain mapping details

#### Conflict Detection & Suggestions

- **FR-044**: System MUST detect conflicts when creating a domain mapping where subdomain+basePath combination already exists on the same project domain
- **FR-045**: When a conflict is detected, system MUST:
  - Prevent the duplicate mapping creation
  - Display clear error message explaining the conflict
  - Show the existing service using that subdomain+basePath combination
  - Provide actionable suggestions (available base paths, alternative subdomains)
- **FR-046**: System MUST provide real-time conflict checking as users type subdomain and base path (debounced inline validation)
- **FR-047**: Conflict detection MUST use database unique constraint as final enforcement: UNIQUE(project_domain_id, subdomain, base_path)
- **FR-048**: When multiple mappings exist on the same subdomain (different base paths), system MUST display them grouped together with visual indication of path differentiation
- **FR-049**: Suggestion engine MUST offer available base paths from predefined list: "/v1", "/v2", "/v3", "/api", "/app", "/web", "/admin", "/dashboard"
- **FR-050**: Suggestion engine MUST filter out already-used base paths from suggestions

#### Data Integrity & Cascade Behavior

- **FR-051**: When an organization domain is deleted, system MUST cascade delete all related project domains and service domain mappings
- **FR-052**: Before allowing organization domain deletion, system MUST check for usage and display warning: "This domain is used by X projects and Y services. Deletion will remove all configurations."
- **FR-053**: When a project domain is removed from a project, system MUST cascade delete all service domain mappings using that project domain
- **FR-054**: When a service is deleted, system MUST cascade delete all its domain mappings
- **FR-055**: System MUST maintain referential integrity through foreign key constraints at database level

#### DNS Verification Implementation

- **FR-056**: System MUST implement DNS verification using native DNS resolution with the following specifications:
  - Use native DNS resolution libraries (Node.js `dns` module, Python `dnspython`, or equivalent)
  - For TXT record verification:
    * Query DNS TXT records for the domain (e.g., `_deployer-verify.example.com`)
    * Expected format: `deployer-verify=<verification-token>`
    * Verification succeeds if any TXT record contains the exact token
  - For CNAME record verification:
    * Query DNS CNAME records for a subdomain (e.g., `_deployer-verify.example.com`)
    * Expected value: `verify-<organization-id>.deployer-system.com`
    * Verification succeeds if CNAME points to expected verification domain
  - Implement automatic retry mechanism:
    * Background job checks "pending" and "failed-temporary" domains every 6 hours
    * Maximum 10 automatic retry attempts for "failed-temporary" before marking as "requires manual verification"
    * "failed-permanent" domains (token mismatch) are NOT retried automatically (require user to fix DNS record)
    * Exponential backoff not required (fixed 6-hour interval)
  - Implement rate limiting:
    * Manual verification attempts limited to 1 per minute per domain
    * Automatic retries exempt from rate limiting
  - DNS query timeout: 10 seconds maximum
  - Cache DNS verification results for 5 minutes to prevent excessive queries
  - Log all verification attempts with timestamp, result, error type (temporary/permanent), and error details for debugging

#### Access Control & Permissions

- **FR-057**: System MUST enforce role-based access control for all domain management operations:
  - **Organization Owner**: Can add, verify, delete (any), assign domains; configure all service mappings
  - **Organization Admin**: Can add, verify domains; can delete ONLY unused domains; assign to any project; configure all service mappings
  - **Project Admin**: Can assign existing verified org domains to their own project; configure service mappings within their project
  - **Project Member**: Can ONLY configure service domain mappings for services within projects they belong to

- **FR-058**: System MUST prevent Organization Admins from deleting domains that are currently assigned to any project:
  - Check domain usage before deletion
  - Return authorization error: "Insufficient permissions. Domain is in use and can only be deleted by Organization Owner."
  - Display usage details (which projects/services are using the domain)

- **FR-059**: System MUST implement authorization checks at the API level:
  - All domain management endpoints protected by role guards
  - Return HTTP 403 Forbidden for unauthorized access attempts
  - Include clear error messages indicating required role
  - Log unauthorized access attempts for security auditing

- **FR-060**: System MUST implement UI-level permission checks:
  - Hide "Add Domain" button for Project Admins and Project Members
  - Disable "Delete" button for Organization Admins when domain is in use
  - Hide "Verify Now" button for Project Admins and Project Members
  - Show permission-based tooltips on disabled actions (e.g., "Organization Owner role required")
  - Progressive disclosure: only show actions user has permission to perform

- **FR-061**: System MUST scope Project Admin and Project Member operations to their assigned projects:
  - Filter domain assignment lists to show only their project's domains
  - Prevent access to service domain mappings outside their projects
  - API queries automatically filtered by project membership
  - Return 404 Not Found (not 403) when accessing resources outside scope to prevent information disclosure

#### Rate Limiting & Resource Constraints

- **FR-062**: System MUST store organization-specific limit configuration in OrganizationSettings table:
  - System MUST automatically create OrganizationSettings record with default values when organization is created
  - `maxDomains` (integer, default: 50) - Maximum organization domains allowed
  - `verificationRateLimit` (integer, default: 1) - Manual verification attempts per minute per domain
  - `maxDomainMappingsPerProject` (integer, default: 100) - Maximum service mappings per project
  - `maxConcurrentVerifications` (integer, default: 5) - Simultaneous verification requests
  - `maxAutoRetryAttempts` (integer, default: 10) - Automatic verification retry attempts
  - `autoRetryIntervalHours` (integer, default: 6) - Hours between automatic retries

- **FR-063**: System MUST enforce domain quota limit:
  - Check current domain count before allowing new domain creation
  - If count >= `maxDomains`, return error: "Domain limit reached (X/Y domains used). Contact administrator to increase limit."
  - Display current usage on organization domains page (e.g., "23/50 domains")
  - Show progress bar or visual indicator of quota usage
  - Allow Organization Owners to increase limit via organization settings page

- **FR-064**: System MUST enforce verification rate limiting:
  - Track manual verification attempts per domain with timestamp
  - If last manual attempt was less than `verificationRateLimit` minutes ago, return error: "Please wait X seconds before retrying verification."
  - Display countdown timer on "Verify Now" button when rate limit active
  - Automatic retry attempts (background job) are exempt from this rate limit
  - Reset rate limit counter after successful verification

- **FR-065**: System MUST enforce concurrent verification limits:
  - Track active verification requests per organization
  - If active verification count >= `maxConcurrentVerifications`, queue request or return error: "Maximum concurrent verifications in progress. Please wait."
  - Display "X/Y verifications in progress" indicator on organization domains page
  - Automatically process queued verifications when slots become available

- **FR-066**: System MUST provide organization settings page for limit configuration (Organization Owner only):
  - Display all configurable limits with current values
  - Allow editing of limit values with validation (positive integers only)
  - Show impact warning when decreasing limits (e.g., "23 domains exist, cannot set limit below 23")
  - Prevent setting limits below current usage
  - Log all limit changes with timestamp and user who made the change
  - Display recommended values based on organization size or plan

#### In-App Notification System

- **FR-067**: System MUST display toast notifications for all domain management events:
  - **Verification success**: Green toast with checkmark icon, "Domain {domain} verified successfully", auto-dismiss after 5 seconds
  - **Verification failure**: Red toast with error icon, "Domain verification failed: {error_reason}", auto-dismiss after 10 seconds with manual dismiss option
  - **Domain created**: Blue toast with info icon, "Domain {domain} added. Verification required.", auto-dismiss after 5 seconds
  - **Domain deleted**: Orange toast with warning icon, "Domain {domain} and all mappings deleted", auto-dismiss after 5 seconds
  - **Conflict detected**: Orange toast with warning icon, "Routing conflict detected for {url}", auto-dismiss after 8 seconds
  - **Rate limit hit**: Orange toast with clock icon, "Verification rate limit. Retry in {seconds}s.", auto-dismiss after 5 seconds
  - **Quota limit reached**: Red toast with stop icon, "Domain limit reached ({current}/{max}). Contact administrator.", auto-dismiss after 10 seconds

- **FR-068**: System MUST implement notification panel/bell accessible from application header:
  - Display notification bell icon with unread count badge
  - Clicking bell opens dropdown panel with event history
  - Show last 50 domain-related events with timestamps (e.g., "2 minutes ago", "Yesterday at 3:45 PM")
  - Each event shows: icon, message, timestamp, and link to relevant page
  - Mark events as read when notification panel is opened
  - Clear all notifications button for current session
  - Events persist for current session only (cleared on logout)

- **FR-069**: System MUST implement real-time status updates using polling strategy:
  - Poll domain status every 30 seconds when organization domains page or project domain settings page is active
  - Update status chips automatically when verification status changes (pending→verified, pending→failed)
  - Update domain usage counts in real-time when domains are assigned/removed
  - Animate status chip color transition (smooth fade from yellow to green)
  - Display animated checkmark when verification succeeds (brief 1-second animation)
  - Pause polling when page is inactive/backgrounded to conserve resources
  - Resume polling when page becomes active again

- **FR-070**: System MUST provide visual feedback for user actions:
  - Show loading spinner on "Verify Now" button during verification check
  - Disable "Verify Now" button with countdown timer when rate limit active (e.g., "Retry in 45s")
  - Animate domain addition to list (slide-in animation from top)
  - Animate domain removal from list (fade-out and slide-up animation)
  - Show checkmark animation on successful operations (domain added, verified, mapped)
  - Shake animation on validation errors or operation failures

### Key Entities

- **OrganizationSettings**: Stores configurable limits and settings for the organization
  - Attributes: id, organizationId, maxDomains (default: 50), verificationRateLimit (default: 1 per minute), maxDomainMappingsPerProject (default: 100), maxConcurrentVerifications (default: 5), maxAutoRetryAttempts (default: 10), autoRetryIntervalHours (default: 6), createdAt, updatedAt
  - Purpose: Centralized configuration for domain management constraints and rate limiting
  - Relationships: One-to-one with Organization
  - Note: If no OrganizationSettings record exists for an organization, system uses global default values

- **OrganizationDomain**: Represents a domain owned by an organization
  - Attributes: id, organizationId, domain (e.g., "example.com"), verificationStatus ("pending" | "verified" | "failed"), verificationMethod ("txt_record" | "cname_record"), verificationToken, dnsRecordChecked, verifiedAt, createdAt, updatedAt, metadata
  - Purpose: Registry of all domains available to the organization with DNS verification tracking
  - Relationships: One-to-many with ProjectDomain

- **ProjectDomain**: Represents a domain assigned to a specific project
  - Attributes: id, projectId, organizationDomainId, allowedSubdomains (array), isPrimary, createdAt, updatedAt
  - Purpose: Links organization domains to projects and defines allowed subdomain allocations
  - Relationships: Many-to-one with OrganizationDomain, one-to-many with ServiceDomainMapping

- **ServiceDomainMapping**: Represents the complete routing configuration from external URL to internal container
  - Attributes: id, serviceId, projectDomainId, subdomain (optional), basePath (external path, optional), internalPath (container path, required), internalPort (required), stripPathEnabled (boolean), isPrimary (boolean), sslEnabled (boolean), sslProvider, protocolConfig (object with httpEnabled, httpsEnabled, autoRedirectToHttps), createdAt, updatedAt, metadata
  - Purpose: Defines how external requests are routed to internal service containers with path transformation rules
  - Relationships: Many-to-one with ProjectDomain, many-to-one with Service
  - Computed Properties: fullExternalUrl (e.g., "https://api.example.com/v1"), internalUrl (e.g., "http://container:3000/"), routingPreview (human-readable description of routing behavior)

- **RoutingRule** (derived/computed, not stored):
  - Represents the active Traefik routing configuration generated from ServiceDomainMapping
  - Properties: externalHost, externalPath, internalTarget, pathTransformation, tlsConfig, middlewares
  - Purpose: Translates ServiceDomainMapping to Traefik-compatible routing rules

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Administrators can view complete domain inventory with verification status in under 3 seconds (page load time)
- **SC-002**: Domain verification check completes and updates status within 5 seconds of clicking "Verify Now"
- **SC-003**: Administrators can add a new domain and receive verification instructions in under 20 seconds
- **SC-004**: Domain usage view accurately displays all projects and services using a domain within 2 seconds of expansion
- **SC-005**: Conflict warnings appear for 100% of domains with routing conflicts (no false negatives)
- **SC-006**: Search and filter operations return results within 300ms (real-time user experience)
- **SC-007**: Administrators can assign multiple domains to a project (including new unverified domains) in a single operation taking under 30 seconds
- **SC-008**: Developers can configure complete service domain mapping (subdomain, paths, port, protocol) in under 2 minutes
- **SC-009**: System prevents 100% of duplicate subdomain+basePath conflicts through validation and database constraints
- **SC-010**: Real-time conflict checking provides feedback within 500ms of user input (debounced)
- **SC-011**: 95% of path stripping configurations work correctly on first attempt (measured by successful request routing)
- **SC-012**: HTTPS auto-redirect configuration reduces HTTP traffic to less than 5% of total requests within 24 hours of enablement
- **SC-013**: SSL certificate provisioning succeeds for 98% of HTTPS-enabled domains within 5 minutes of configuration
- **SC-014**: Domain mapping configuration preview accurately reflects actual routing behavior in 100% of cases
- **SC-015**: Users can identify and resolve domain conflicts within 1 minute using system-provided suggestions
- **SC-016**: Zero data loss occurs during cascade deletion operations (verified through automated tests)
- **SC-017**: New domain verification instructions are clear enough that 90% of users complete verification without support tickets
- **SC-018**: System handles 1000+ domain mappings across all services without performance degradation (query response under 100ms)
- **SC-019**: Domain deletion warnings prevent 95% of accidental deletions (measured by confirmation dialog abandonment rate)
- **SC-020**: Organization domain dashboard loads and displays 500+ domains without performance degradation (under 3 seconds)
- **SC-021**: Domain quota limits prevent 100% of over-quota domain creation attempts with clear error messages
- **SC-022**: Verification rate limiting prevents DNS query spam while allowing 99% of legitimate retry attempts
- **SC-023**: Organization Owners can modify quota limits via settings page in under 30 seconds
- **SC-024**: System displays real-time quota usage (e.g., "23/50 domains") with less than 1 second delay after domain creation/deletion
- **SC-025**: Toast notifications appear within 500ms of triggering event with appropriate visual styling
- **SC-026**: Notification panel loads event history (50 events) in under 300ms when opened
- **SC-027**: Real-time polling updates status chips within 30 seconds of verification completion with less than 5% server load increase
- **SC-028**: Users receive clear, actionable error messages in notifications for 100% of failure scenarios
- **SC-029**: Individual domain operations (add, verify, delete, assign) complete in under 3 seconds with clear success feedback
- **SC-030**: Users can perform 10 sequential domain operations in under 2 minutes without confusion or workflow friction
