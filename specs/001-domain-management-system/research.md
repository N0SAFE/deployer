# Research & Technical Decisions: Domain Management System

**Feature**: 001-domain-management-system  
**Date**: 2025-01-11  
**Status**: Research Complete

---

## Overview

This document captures research findings and technical decisions for unknowns identified during Phase 0 planning. Each unknown is researched, alternatives are considered, and a final decision is documented with clear rationale.

---

## Research Item 1: DNS Verification Implementation with Node.js `dns` Module

### Question
How should we implement DNS verification using the native Node.js `dns` module? What are the specific methods, error handling patterns, and verification flows required?

### Research Findings

**Node.js `dns` Module Capabilities:**
1. **Promises API**: Node.js v15+ provides `dns.promises` for async/await usage
2. **TXT Record Resolution**: `dns.promises.resolveTxt(hostname)` returns array of TXT records
3. **CNAME Record Resolution**: `dns.promises.resolveCname(hostname)` returns CNAME targets
4. **Error Handling**: Throws errors with codes: `ENOTFOUND` (no record), `ENODATA` (no data), `ETIMEOUT` (timeout)
5. **Custom Resolver**: `dns.Resolver` class for custom DNS servers and timeout configuration

**Verification Token Generation:**
- Use `crypto.randomBytes(32).toString('hex')` for unique verification tokens
- Store token in database for comparison during verification

**TXT Record Verification Pattern:**
```typescript
async verifyDomainTxt(domain: string, expectedToken: string): Promise<boolean> {
  try {
    const records = await dns.promises.resolveTxt(`_deployer-verify.${domain}`);
    // records is array of arrays: [['deployer-verify=abc123'], ['other-txt']]
    const flat = records.flat();
    return flat.some(record => record.includes(`deployer-verify=${expectedToken}`));
  } catch (error) {
    if (error.code === 'ENOTFOUND' || error.code === 'ENODATA') {
      return false; // DNS not found or no TXT records
    }
    throw error; // Unexpected error (network, timeout, etc.)
  }
}
```

**CNAME Record Verification Pattern:**
```typescript
async verifyDomainCname(domain: string, orgId: string): Promise<boolean> {
  try {
    const cnames = await dns.promises.resolveCname(`_deployer-verify.${domain}`);
    const expected = `verify-${orgId}.deployer-system.com`;
    return cnames.includes(expected);
  } catch (error) {
    if (error.code === 'ENOTFOUND' || error.code === 'ENODATA') {
      return false;
    }
    throw error;
  }
}
```

**Timeout Configuration:**
- Default DNS timeout: 5 seconds (Node.js default)
- Specification requires: 10 seconds maximum
- Solution: Use custom `dns.Resolver` with `resolver.setServers()` and implement timeout wrapper

**Cache Strategy:**
- Specification requires: 5-minute cache for verification results
- Implementation: In-memory cache with timestamp (avoid re-querying same domain within 5 minutes)
- Cache key: `${domain}:${verificationToken}`

### Alternatives Considered

**Alternative 1: External DNS API (Cloudflare, Google DNS)**
- ❌ Rejected: Specification requires zero external dependencies
- ❌ Rejected: Would require API keys and configuration
- ❌ Rejected: Adds cost and rate limit concerns

**Alternative 2: Third-party DNS library (e.g., `dns2`, `node-dns`)**
- ❌ Rejected: Unnecessary dependency when native module sufficient
- ❌ Rejected: Adds maintenance burden and security review overhead

**Alternative 3: Native `dns` module (SELECTED)**
- ✅ Selected: Zero external dependencies
- ✅ Selected: Built-in to Node.js (no installation needed)
- ✅ Selected: Well-documented and stable API
- ✅ Selected: Sufficient for TXT/CNAME record queries

### Decision

**Use Node.js native `dns.promises` API with custom timeout wrapper and 5-minute in-memory cache.**

**Rationale:**
1. Meets specification requirement for "manual DNS lookup using native DNS resolution"
2. Zero external dependencies (constitution compliance)
3. Proven API with excellent TypeScript support
4. Sufficient for TXT and CNAME record verification
5. Easy to mock for testing

**Implementation Notes:**
- Create `DomainVerificationService` in `services/domain-verification.service.ts`
- Use `dns.promises.resolveTxt()` for TXT record verification
- Use `dns.promises.resolveCname()` for CNAME record verification
- Implement 10-second timeout wrapper using `Promise.race()` with `setTimeout()`
- Implement 5-minute in-memory cache using Map with timestamp cleanup
- Handle DNS error codes explicitly (`ENOTFOUND`, `ENODATA`, `ETIMEOUT`)
- Log all verification attempts with timestamp and result

---

## Research Item 2: BullMQ Background Job for DNS Auto-Retry

### Question
How should we implement the automatic DNS verification retry mechanism using BullMQ? What queue configuration, job scheduling, and error handling patterns are needed?

### Research Findings

**Existing BullMQ Infrastructure:**
- BullMQ already configured in `OrchestrationModule` for deployment jobs
- Redis connection available via `BullModule.forRoot()`
- Queue registration via `BullModule.registerQueue({ name: 'queue-name' })`

**Specification Requirements:**
- Auto-retry every 6 hours for pending domains
- Maximum 10 retry attempts before manual intervention required
- Rate limiting exempt for automatic retries
- Background job should not block deployment queue

**BullMQ Job Scheduling:**
1. **Cron Pattern**: Use BullMQ repeatable jobs with cron `0 */6 * * *` (every 6 hours)
2. **Job Data**: `{ domainId: string, organizationId: string, attempt: number }`
3. **Max Attempts**: Track in job metadata, not BullMQ retry mechanism (different purpose)
4. **Priority**: Low priority to avoid blocking deployment jobs

**Queue Naming Convention:**
- Existing: `deployment` queue for deployment jobs
- New: `domain-verification` queue for DNS auto-retry
- Separation ensures domain verification doesn't block deployments

**Processor Implementation Pattern:**
```typescript
@Processor('domain-verification')
export class DnsVerificationProcessor {
  @Process('retry-verification')
  async handleVerificationRetry(job: Job<{ domainId: string }>) {
    const domain = await this.domainService.findById(job.data.domainId);
    
    // Skip if already verified or exceeded max attempts
    if (domain.verificationStatus === 'verified') {
      return { skipped: true, reason: 'already verified' };
    }
    
    if (domain.retryAttempts >= 10) {
      await this.domainService.updateStatus(domain.id, 'requires_manual');
      return { skipped: true, reason: 'max attempts exceeded' };
    }
    
    // Attempt verification
    const result = await this.verificationService.verifyDomain(domain);
    
    // Update retry count and last attempt timestamp
    await this.domainService.incrementRetryAttempts(domain.id);
    
    return result;
  }
}
```

**Job Scheduling Strategy:**
- **Option A**: Single repeatable job that queries all pending domains
- **Option B**: Individual job per domain with delayed retry
- **Selected**: Option A (single repeatable job for efficiency)

**Error Handling:**
- Job failures logged but not retried by BullMQ (verification retry logic handled manually)
- Network errors logged and skipped (will retry in next scheduled run)
- Database errors propagate and fail job (require manual intervention)

### Alternatives Considered

**Alternative 1: Cron job (system-level)**
- ❌ Rejected: Not containerized, requires host configuration
- ❌ Rejected: No job tracking or failure monitoring
- ❌ Rejected: Doesn't integrate with existing queue infrastructure

**Alternative 2: NestJS @Cron decorator**
- ❌ Rejected: Less observable than BullMQ (no job dashboard)
- ❌ Rejected: No distributed job coordination (problematic in multi-server setup)
- ❌ Rejected: Less control over retry/failure handling

**Alternative 3: BullMQ repeatable job (SELECTED)**
- ✅ Selected: Integrates with existing BullMQ infrastructure
- ✅ Selected: Job history and monitoring via Bull Board (if configured)
- ✅ Selected: Distributed job coordination (leader election)
- ✅ Selected: Retry and error handling built-in

### Decision

**Use BullMQ repeatable job in dedicated `domain-verification` queue with cron schedule `0 */6 * * *`.**

**Rationale:**
1. Leverages existing BullMQ infrastructure (no new dependencies)
2. Provides job tracking and monitoring capabilities
3. Distributed job coordination for multi-server deployments
4. Separates domain verification from deployment jobs (different queue)
5. Easy to adjust retry interval via cron pattern

**Implementation Notes:**
- Create `DnsVerificationProcessor` in `processors/dns-verification.processor.ts`
- Register `domain-verification` queue in `DomainModule`
- Implement `@Process('retry-verification')` handler
- Single repeatable job queries all pending domains (where `verificationStatus = 'pending'` and `retryAttempts < 10`)
- Track retry attempts in `organizationDomains.retryAttempts` column (add via migration)
- Update `lastVerificationAttempt` timestamp after each attempt
- Mark as `requires_manual` status after 10 failed attempts

---

## Research Item 3: Role-Based Access Control (RBAC) Implementation

### Question
How should we implement the 4-tier RBAC system (Organization Owner, Admin, Project Admin, Member) for domain management operations? What guard patterns, decorator usage, and permission checking strategies are needed?

### Research Findings

**NestJS Guard Pattern:**
- Guards implement `CanActivate` interface
- Return `boolean` or `Promise<boolean>` to allow/deny access
- Placed on controllers via `@UseGuards()` decorator
- Can access request context to check user roles and permissions

**Better Auth Session Structure:**
- Better Auth provides `user` object in session
- User roles available via `session.user.role` or organization relationship
- Organization membership tracked in database (likely `organization_members` or similar table)

**4-Tier Role Hierarchy:**
```
Organization Owner > Organization Admin > Project Admin > Project Member
```

**Permission Matrix (from specification):**
| Operation | Owner | Admin | Project Admin | Member |
|-----------|-------|-------|---------------|--------|
| Add Org Domain | ✅ | ✅ | ❌ | ❌ |
| Verify Domain | ✅ | ✅ | ❌ | ❌ |
| Delete Org Domain | ✅ (all) | ✅ (unused only) | ❌ | ❌ |
| Assign to Project | ✅ (all) | ✅ (all) | ✅ (own) | ❌ |
| Configure Service Mapping | ✅ | ✅ | ✅ (own) | ✅ (own) |

**Guard Implementation Pattern:**
```typescript
@Injectable()
export class DomainRoleGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Get required roles from decorator metadata
    const requiredRoles = this.reflector.get<string[]>(
      'roles',
      context.getHandler()
    );
    
    if (!requiredRoles) {
      return true; // No role requirement
    }
    
    // Get user session from request
    const request = context.switchToHttp().getRequest();
    const user = request.user; // From Better Auth middleware
    
    // Check organization membership and role
    const organizationId = request.params.organizationId || request.body.organizationId;
    const userRole = await this.getUserOrganizationRole(user.id, organizationId);
    
    return requiredRoles.includes(userRole);
  }
  
  private async getUserOrganizationRole(userId: string, orgId: string): Promise<string> {
    // Query organization_members or organization_collaborators table
    // Return: 'owner', 'admin', 'project_admin', 'member'
  }
}
```

**Decorator Usage:**
```typescript
@UseGuards(DomainRoleGuard)
@Roles('owner', 'admin')
@Implement(domainContract.create)
async createDomain() {
  // Only Organization Owners and Admins can reach this
}

@UseGuards(DomainRoleGuard)
@Roles('owner', 'admin', 'project_admin')
@Implement(projectDomainContract.assign)
async assignDomain() {
  // Project Admins can assign to their own projects
  // Logic checks project ownership inside controller
}
```

**Resource-Scoped Authorization:**
- Project Admin can only assign domains to **their own projects**
- Project Admin can only configure mappings for **services in their projects**
- Implementation: Check project membership inside controller after guard passes

**Delete Permission Special Case:**
- Organization Admin can delete **unused** domains only
- Organization Owner can delete **any** domain
- Implementation: Check domain usage inside controller, not in guard

### Alternatives Considered

**Alternative 1: Manual role check in controllers**
- ❌ Rejected: Code duplication across controllers
- ❌ Rejected: Easy to forget permission checks
- ❌ Rejected: Harder to test and audit

**Alternative 2: CASL (authorization library)**
- ❌ Rejected: Additional dependency (prefer native NestJS patterns)
- ❌ Rejected: Overkill for 4-tier role hierarchy
- ❌ Rejected: Learning curve and complexity overhead

**Alternative 3: NestJS Guards with custom decorator (SELECTED)**
- ✅ Selected: Native NestJS pattern (no extra dependencies)
- ✅ Selected: Reusable across controllers
- ✅ Selected: Clear and declarative (`@Roles()` decorator)
- ✅ Selected: Easy to test and audit
- ✅ Selected: Integrates with Better Auth session

### Decision

**Implement custom `DomainRoleGuard` with `@Roles()` decorator for declarative RBAC enforcement.**

**Rationale:**
1. Native NestJS pattern (no external dependencies)
2. Reusable and maintainable across all domain controllers
3. Declarative role requirements at method level
4. Clear authorization intent visible in code
5. Easy to test (mock guard or test with real auth)

**Implementation Notes:**
- Create `DomainRoleGuard` in `guards/domain-role.guard.ts`
- Create `@Roles()` decorator using `SetMetadata('roles', ...)`
- Query organization membership from database (need to identify correct table)
- Return 403 Forbidden for unauthorized requests with clear error message
- Special handling for "delete unused domains" (Admin vs Owner) in controller logic
- Project-scoped operations checked in controller after guard passes

---

## Research Item 4: Frontend Polling Strategy for Real-Time Status Updates

### Question
How should we implement the 30-second polling for domain status updates without causing excessive server load or poor user experience? What patterns ensure efficient polling with proper cleanup?

### Research Findings

**Specification Requirements:**
- Poll every 30 seconds when page is active
- Update status chips automatically (pending→verified transitions)
- Pause polling when page is backgrounded
- Resume polling when page becomes active
- Server load increase <5%

**React Query Polling Features:**
1. **`refetchInterval`**: Auto-refetch at specified interval (ms)
2. **`refetchIntervalInBackground`**: Control polling when tab is inactive
3. **`enabled`**: Conditionally enable/disable query
4. **`staleTime`**: How long data is considered fresh

**Efficient Polling Pattern:**
```typescript
// hooks/useDomains.ts
export function useDomains(organizationId: string) {
  return useQuery(
    orpc.domain.list.queryOptions({
      input: { organizationId },
      refetchInterval: 30000, // 30 seconds
      refetchIntervalInBackground: false, // Pause when tab inactive
      staleTime: 25000, // Consider fresh for 25s (slightly less than interval)
    })
  );
}
```

**Page Visibility API:**
- `document.visibilityState`: "visible" or "hidden"
- `document.addEventListener('visibilitychange', ...)`: Detect tab switches
- React Query automatically uses Page Visibility API when `refetchIntervalInBackground: false`

**Optimization Strategies:**
1. **Conditional Polling**: Only poll pages that need real-time updates (organization domains dashboard)
2. **Stale Time**: Set stale time to prevent redundant requests
3. **Background Polling Disabled**: Reduce server load when tab is inactive
4. **Debounced User Actions**: Prevent polling immediately after user-triggered refetch

**Server-Side Optimization:**
- Query only `organizationDomains` with `verificationStatus = 'pending'` for auto-update check
- Use database index on `verificationStatus` column (already exists in schema)
- Return only changed domains (compare `updatedAt` timestamp)
- Implement lightweight endpoint for status-only queries

**Alternative: WebSocket Real-Time Updates:**
- ✅ More efficient than polling (push-based)
- ❌ Specification requires polling (simpler implementation for MVP)
- ❌ Adds WebSocket infrastructure complexity
- 📋 Consider for future iteration if polling causes issues

### Alternatives Considered

**Alternative 1: Long polling (HTTP keep-alive)**
- ❌ Rejected: More complex than interval polling
- ❌ Rejected: Server resource holding (connections open)
- ❌ Rejected: No clear benefit over 30-second interval

**Alternative 2: Server-Sent Events (SSE)**
- ❌ Rejected: One-way push (overkill for status updates)
- ❌ Rejected: Adds infrastructure complexity
- ❌ Rejected: Specification explicitly requires polling

**Alternative 3: React Query interval polling (SELECTED)**
- ✅ Selected: Simple implementation with React Query
- ✅ Selected: Automatic background pause (battery efficient)
- ✅ Selected: Built-in stale time and cache management
- ✅ Selected: No additional dependencies

### Decision

**Use React Query `refetchInterval` with 30-second polling, background pause, and stale time optimization.**

**Rationale:**
1. Meets specification requirement for 30-second polling
2. Automatic background pause reduces server load
3. Built-in to React Query (no extra dependencies)
4. Easy to configure per-query basis
5. Leverages Page Visibility API automatically

**Implementation Notes:**
- Configure `refetchInterval: 30000` for domain list queries
- Set `refetchIntervalInBackground: false` to pause when tab inactive
- Set `staleTime: 25000` to prevent redundant requests
- Only enable polling on organization domains dashboard page
- Disable polling on other pages (project domain assignment, service mapping)
- Test server load impact with 100+ concurrent users (should be <5% increase)

---

## Research Item 5: Testing Strategy for DNS Verification

### Question
How should we test DNS verification functionality without making real DNS queries? What mocking strategies ensure reliable and fast tests?

### Research Findings

**Testing Challenges:**
- Real DNS queries are slow (100-500ms per query)
- Real DNS queries are unreliable (network dependency)
- Real DNS queries can't be reproduced exactly (DNS changes)
- Need to test both success and failure scenarios

**Mocking Strategies:**

**Strategy 1: Mock `dns.promises` module**
```typescript
// In test file
import * as dns from 'dns/promises';

jest.mock('dns/promises');

describe('DomainVerificationService', () => {
  it('should verify TXT record successfully', async () => {
    // Mock DNS response
    (dns.resolveTxt as jest.Mock).mockResolvedValue([
      ['deployer-verify=abc123'],
    ]);
    
    const result = await service.verifyDomainTxt('example.com', 'abc123');
    expect(result).toBe(true);
  });
  
  it('should handle ENOTFOUND error', async () => {
    const error = new Error('ENOTFOUND');
    error.code = 'ENOTFOUND';
    (dns.resolveTxt as jest.Mock).mockRejectedValue(error);
    
    const result = await service.verifyDomainTxt('nonexistent.com', 'abc123');
    expect(result).toBe(false);
  });
});
```

**Strategy 2: Dependency Injection with Interface**
```typescript
// Create DNS resolver interface
interface IDnsResolver {
  resolveTxt(hostname: string): Promise<string[][]>;
  resolveCname(hostname: string): Promise<string[]>;
}

// Real implementation
class NativeDnsResolver implements IDnsResolver {
  async resolveTxt(hostname: string) {
    return dns.promises.resolveTxt(hostname);
  }
  
  async resolveCname(hostname: string) {
    return dns.promises.resolveCname(hostname);
  }
}

// Mock implementation for tests
class MockDnsResolver implements IDnsResolver {
  private mockData = new Map<string, any>();
  
  setMockTxtRecord(hostname: string, records: string[][]) {
    this.mockData.set(`txt:${hostname}`, records);
  }
  
  async resolveTxt(hostname: string) {
    const data = this.mockData.get(`txt:${hostname}`);
    if (!data) {
      const error = new Error('ENOTFOUND');
      error.code = 'ENOTFOUND';
      throw error;
    }
    return data;
  }
  
  async resolveCname(hostname: string) {
    // Similar implementation
  }
}
```

**Integration Test Strategy:**
- Unit tests: Use mocked DNS resolver
- Integration tests: Use test DNS records on controlled test domain
- E2E tests: Optional real DNS verification (requires test domain setup)

**Test Coverage Requirements:**
✅ DNS TXT record verification success  
✅ DNS TXT record verification failure (record not found)  
✅ DNS CNAME record verification success  
✅ DNS CNAME record verification failure  
✅ DNS timeout handling  
✅ DNS network error handling  
✅ Token mismatch scenario  
✅ Cache hit scenario (5-minute cache)  
✅ Cache miss scenario  
✅ Multiple TXT records (should find correct one)

### Alternatives Considered

**Alternative 1: Direct `dns.promises` mocking with Jest**
- ✅ Simple and straightforward
- ✅ No abstraction overhead
- ❌ Tight coupling to Node.js `dns` module
- ❌ Harder to test different DNS implementations

**Alternative 2: Dependency Injection with DNS Resolver Interface (SELECTED)**
- ✅ Loose coupling (can swap DNS implementations)
- ✅ Easy to test (inject mock resolver)
- ✅ Better architecture (follows SOLID principles)
- ✅ Future-proof (could add custom DNS server support)
- ❌ Slightly more complex setup

### Decision

**Use Dependency Injection pattern with `IDnsResolver` interface for testability and flexibility.**

**Rationale:**
1. Loose coupling enables easy testing with mock implementation
2. Better architecture follows SOLID dependency inversion principle
3. Future-proof for potential DNS resolver customization
4. Clear separation between DNS logic and verification logic
5. Easy to test both success and failure scenarios

**Implementation Notes:**
- Create `IDnsResolver` interface in `interfaces/dns-resolver.interface.ts`
- Implement `NativeDnsResolver` using `dns.promises`
- Implement `MockDnsResolver` for unit tests
- Inject resolver into `DomainVerificationService` constructor
- Use `NativeDnsResolver` in production module configuration
- Use `MockDnsResolver` in test module configuration
- Test coverage: 100% for DNS verification logic (including error cases)

---

## Summary: Research Outcomes

| Research Item | Decision | Key Technology | Complexity |
|---------------|----------|----------------|------------|
| DNS Verification | Native `dns.promises` API | Node.js built-in | Low |
| Background Jobs | BullMQ repeatable job | Existing infrastructure | Medium |
| RBAC Implementation | NestJS Guards + Decorator | Native NestJS pattern | Medium |
| Frontend Polling | React Query `refetchInterval` | React Query feature | Low |
| DNS Testing | Dependency Injection + Mock | Interface abstraction | Medium |

**Overall Complexity**: Medium  
**External Dependencies**: 0 (all use existing infrastructure or native modules)  
**Constitution Compliance**: ✅ All decisions align with project constitution

---

## Next Steps

1. ✅ Research complete - proceed to Phase 1 (Data Model, Contracts, Quickstart, Tests)
2. Create `data-model.md` with complete database schema design
3. Create `/contracts/` directory with ORPC contract definitions
4. Create `quickstart.md` with developer onboarding guide
5. Create `/tests/` directory with comprehensive test specifications
