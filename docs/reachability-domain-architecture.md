# Reachability & Domain Ownership Module — Architecture

## 1. Core Reachability Module (New)

**Extends** `apps/api/src/core/modules/reachability/` with a new method:

```typescript
// New method in ReachabilityService
async checkPublicUrlReachability(url: string): Promise<{
  url: string
  reachable: boolean
  latencyMs: number
  statusCode?: number
  resolvedIp?: string
  error?: string
}>
```

**How it works** (multi-strategy):
1. **Primary**: HTTP GET to the target URL with 10s timeout — checks if it responds
2. **DNS resolution**: Resolves the hostname via public DNS (8.8.8.8) to verify DNS propagation
3. **Fallback**: If external checkers are configured, delegates to them

Integration with the existing mesh reachability (`checkMeshUrlReachability`) is via a shared utility.

## 2. DB-Stored Reachable URL

**Table**: `app_config` (already exists) — key-value store
- Key: `public_reachable_url`
- Value: URL string (e.g. `https://api.example.com`)

**Table**: `domain_verification_config` (new Drizzle table)
- `id`, `domain`, `verification_token`, `verification_method`, `verification_status`, `verified_at`, `reachability_status`, `last_checked_at`, `public_url`

Also stores `reachable_url` in node_config (local SQLite) for setup wizard access.

## 3. Reachability Check API (New ORPC Contracts)

```
GET /api/reachability/check?url=...   → { reachable, latencyMs, statusCode, error }
GET /api/reachability/self-check      → { reachable, publicUrl, localUrl, latencyMs }
GET /api/reachability/config          → { publicUrl, lastCheckedAt, status }
POST /api/reachability/config         → { publicUrl } (set the reachable URL)
```

## 4. Domain Ownership Verification UI (New Web Pages)

`apps/web/src/app/dashboard/admin/domains/` (under Providers/Admin)
- List domains with verification status
- Add domain dialog with DNS challenge
- Verify button (triggers DNS lookup)
- Manual DNS instruction display
- Reachability status column

Reuses existing v2 patterns from `OrganizationDomainManagement.tsx`.

## 5. DNS Provider Management (UI Scaffold)

`apps/web/src/app/dashboard/admin/providers/` with sub-pages:
- `cloudflare/` - Cloudflare API token config
- `route53/` - AWS Route53 config (future)
- Each stores API credentials encrypted in the existing providers pattern

## Implementation Order

### Phase 1: Core Reachability (This session)
1. Add `checkPublicUrlReachability()` to ReachabilityService
2. Create reachability ORPC contracts
3. Create reachability feature module (controller)
4. Add self-check endpoint
5. Create web domain (endpoints + hooks)
6. Add reachable URL config via app-config
7. Add UI to configure reachable URL

### Phase 2: Domain Ownership UI (This session)
8. Create admin domains page (list + add + verify)
9. Integrate existing domain verification service
10. Show DNS challenge instructions
11. Add reachability status display

### Phase 3: DNS Provider Scaffold (This session)
12. Create providers/dns page with Cloudflare card
13. Cloudflare API credential form (encrypted storage)
14. List/manage DNS records UI

### Phase 4: DNS Record Management (Future)
15. Cloudflare API integration for creating DNS records
16. Other providers
17. ACME/LetsEncrypt automation
