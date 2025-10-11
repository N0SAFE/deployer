# Unit Test Plan: Domain Management System

**Purpose**: Unit test specifications for isolated component testing

**Test Runner**: Vitest (NOT bun test)

**Command**: `bun run test` or `npm run test`

---

## Testing Principles

1. **Test adapters first** - No dependencies, pure transformation logic
2. **Mock DNS resolver** - Use dependency injection with IDnsResolver interface
3. **Use database transactions** - Rollback after each test
4. **Mock Better Auth** - Inject mock user sessions
5. **Follow AAA pattern** - Arrange, Act, Assert

---

## 1. Adapter Tests (Priority: HIGHEST)

**Why first**: Adapters have no dependencies, pure transformation functions

### 1.1 OrganizationDomainAdapterService

**File**: `apps/api/src/modules/domain/adapters/__tests__/organization-domain-adapter.service.spec.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { OrganizationDomainAdapterService } from '../organization-domain-adapter.service';
import { OrganizationDomain } from '@/config/drizzle/schema/domain';

describe('OrganizationDomainAdapterService', () => {
  const adapter = new OrganizationDomainAdapterService();

  describe('adaptToContract', () => {
    it('should transform organizationDomain entity to contract type', () => {
      // Arrange
      const entity: OrganizationDomain = {
        id: '123',
        organizationId: 'org-456',
        domain: 'example.com',
        verificationMethod: 'txt',
        verificationToken: 'token-abc',
        verificationStatus: 'verified',
        verifiedAt: new Date('2024-01-01'),
        retryAttempts: 0,
        lastVerificationAttempt: null,
        nextRetryAt: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      // Act
      const contract = adapter.adaptToContract(entity);

      // Assert
      expect(contract.id).toBe('123');
      expect(contract.domain).toBe('example.com');
      expect(contract.verificationStatus).toBe('verified');
      expect(contract.verifiedAt).toEqual(new Date('2024-01-01'));
    });

    it('should handle nullable fields correctly', () => {
      const entity: OrganizationDomain = {
        id: '123',
        organizationId: 'org-456',
        domain: 'pending.com',
        verificationMethod: 'cname',
        verificationToken: 'token-def',
        verificationStatus: 'pending',
        verifiedAt: null, // Not verified yet
        retryAttempts: 3,
        lastVerificationAttempt: new Date('2024-01-10'),
        nextRetryAt: new Date('2024-01-11'),
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-10'),
      };

      const contract = adapter.adaptToContract(entity);

      expect(contract.verifiedAt).toBeNull();
      expect(contract.retryAttempts).toBe(3);
    });
  });

  describe('adaptToContractWithUsage', () => {
    it('should include usage information', () => {
      const entity: OrganizationDomain = { /* ... */ };
      const assignedProjectsCount = 3;
      const activeMappingsCount = 5;

      const contract = adapter.adaptToContractWithUsage(
        entity,
        assignedProjectsCount,
        activeMappingsCount
      );

      expect(contract.assignedProjectsCount).toBe(3);
      expect(contract.activeMappingsCount).toBe(5);
      expect(contract.canDelete).toBe(false); // Has usage, cannot delete
    });

    it('should mark as deletable when no usage', () => {
      const entity: OrganizationDomain = { /* ... */ };

      const contract = adapter.adaptToContractWithUsage(entity, 0, 0);

      expect(contract.canDelete).toBe(true);
    });
  });
});
```

**Test Coverage**: 100% of adapter methods

---

## 2. Service Tests (Priority: HIGH)

**Mock strategy**: Inject mock repositories and DNS resolver

### 2.1 DomainVerificationService

**File**: `apps/api/src/modules/domain/services/__tests__/domain-verification.service.spec.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DomainVerificationService } from '../domain-verification.service';
import { MockDnsResolver } from '../__mocks__/mock-dns-resolver';

describe('DomainVerificationService', () => {
  let service: DomainVerificationService;
  let mockDnsResolver: MockDnsResolver;

  beforeEach(() => {
    mockDnsResolver = new MockDnsResolver();
    service = new DomainVerificationService(mockDnsResolver);
  });

  describe('verifyDomainTxt', () => {
    it('should verify TXT record successfully', async () => {
      // Arrange
      const domain = 'example.com';
      const token = 'abc123';
      mockDnsResolver.setMockTxtRecord(`_deployer-verify.${domain}`, [
        [`deployer-verify=${token}`],
      ]);

      // Act
      const result = await service.verifyDomainTxt(domain, token);

      // Assert
      expect(result).toBe(true);
    });

    it('should fail verification when token mismatch', async () => {
      const domain = 'example.com';
      mockDnsResolver.setMockTxtRecord(`_deployer-verify.${domain}`, [
        [`deployer-verify=wrong-token`],
      ]);

      const result = await service.verifyDomainTxt(domain, 'expected-token');

      expect(result).toBe(false);
    });

    it('should handle ENOTFOUND error gracefully', async () => {
      const domain = 'nonexistent.com';
      // Mock DNS resolver throws ENOTFOUND (no mock data set)

      const result = await service.verifyDomainTxt(domain, 'token');

      expect(result).toBe(false); // Should not throw, return false
    });

    it('should cache verification results for 5 minutes', async () => {
      const domain = 'cached.com';
      const token = 'cache-token';
      
      mockDnsResolver.setMockTxtRecord(`_deployer-verify.${domain}`, [
        [`deployer-verify=${token}`],
      ]);

      // First call
      await service.verifyDomainTxt(domain, token);
      
      // Second call (should use cache, not query DNS again)
      await service.verifyDomainTxt(domain, token);

      // Assert DNS was only queried once
      expect(mockDnsResolver.getTxtCallCount()).toBe(1);
    });
  });

  describe('verifyDomainCname', () => {
    it('should verify CNAME record successfully', async () => {
      const domain = 'example.com';
      const orgId = 'org-123';
      const expected = `verify-${orgId}.deployer-system.com`;
      
      mockDnsResolver.setMockCnameRecord(`_deployer-verify.${domain}`, [expected]);

      const result = await service.verifyDomainCname(domain, orgId);

      expect(result).toBe(true);
    });
  });
});
```

**Test Coverage**:
- ✅ TXT record verification success
- ✅ TXT record verification failure (token mismatch)
- ✅ CNAME record verification success
- ✅ CNAME record verification failure
- ✅ DNS ENOTFOUND error handling
- ✅ DNS timeout error handling
- ✅ 5-minute cache functionality

### 2.2 OrganizationDomainService

**File**: `apps/api/src/modules/domain/services/__tests__/organization-domain.service.spec.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OrganizationDomainService } from '../organization-domain.service';
import { OrganizationDomainRepository } from '../../repositories/organization-domain.repository';
import { db } from '@/config/drizzle/db';

describe('OrganizationDomainService', () => {
  let service: OrganizationDomainService;
  let repository: OrganizationDomainRepository;

  beforeEach(async () => {
    // Start database transaction
    await db.transaction(async (tx) => {
      repository = new OrganizationDomainRepository(tx);
      service = new OrganizationDomainService(repository);
    });
  });

  afterEach(async () => {
    // Rollback transaction (cleanup)
    await db.rollback();
  });

  describe('create', () => {
    it('should create organization domain with pending status', async () => {
      // Arrange
      const input = {
        organizationId: 'org-123',
        domain: 'test.com',
        verificationMethod: 'txt' as const,
      };

      // Act
      const domain = await service.create(input);

      // Assert
      expect(domain.domain).toBe('test.com');
      expect(domain.verificationStatus).toBe('pending');
      expect(domain.verificationToken).toBeTruthy();
      expect(domain.retryAttempts).toBe(0);
    });

    it('should throw error if domain already exists', async () => {
      const input = {
        organizationId: 'org-123',
        domain: 'duplicate.com',
        verificationMethod: 'txt' as const,
      };

      await service.create(input);

      await expect(service.create(input)).rejects.toThrow('DOMAIN_ALREADY_EXISTS');
    });
  });

  describe('findById', () => {
    it('should return domain by ID', async () => {
      const created = await service.create({
        organizationId: 'org-123',
        domain: 'findme.com',
        verificationMethod: 'txt',
      });

      const found = await service.findById(created.id);

      expect(found?.id).toBe(created.id);
      expect(found?.domain).toBe('findme.com');
    });

    it('should return null for non-existent domain', async () => {
      const found = await service.findById('non-existent-id');

      expect(found).toBeNull();
    });
  });
});
```

**Test Coverage**: All service methods (create, findById, findByOrganization, update, delete, incrementRetryAttempts)

---

## 3. Guard Tests (Priority: HIGH)

### 3.1 DomainRoleGuard

**File**: `apps/api/src/modules/domain/guards/__tests__/domain-role.guard.spec.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { DomainRoleGuard } from '../domain-role.guard';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

describe('DomainRoleGuard', () => {
  let guard: DomainRoleGuard;
  let mockReflector: Reflector;

  beforeEach(() => {
    mockReflector = {
      get: vi.fn(),
    } as any;
    
    guard = new DomainRoleGuard(mockReflector);
  });

  describe('canActivate', () => {
    it('should allow Organization Owner to access Owner-only endpoint', async () => {
      // Arrange
      mockReflector.get.mockReturnValue(['owner']);
      
      const mockContext = createMockContext({
        user: { id: 'user-1', role: 'owner' },
        params: { organizationId: 'org-1' },
      });

      // Act
      const result = await guard.canActivate(mockContext);

      // Assert
      expect(result).toBe(true);
    });

    it('should deny Project Admin from accessing Owner-only endpoint', async () => {
      mockReflector.get.mockReturnValue(['owner']);
      
      const mockContext = createMockContext({
        user: { id: 'user-2', role: 'project_admin' },
        params: { organizationId: 'org-1' },
      });

      const result = await guard.canActivate(mockContext);

      expect(result).toBe(false);
    });

    it('should allow Project Admin to access project-admin endpoint', async () => {
      mockReflector.get.mockReturnValue(['owner', 'admin', 'project_admin']);
      
      const mockContext = createMockContext({
        user: { id: 'user-3', role: 'project_admin' },
        params: { organizationId: 'org-1' },
      });

      const result = await guard.canActivate(mockContext);

      expect(result).toBe(true);
    });
  });
});

function createMockContext(data: any): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => data,
    }),
    getHandler: () => ({}),
  } as any;
}
```

**Test Coverage**: All 4 role tiers (Owner, Admin, Project Admin, Member)

---

## 4. Repository Tests (Priority: MEDIUM)

**Strategy**: Test actual database operations with transactions

### 4.1 OrganizationDomainRepository

**File**: `apps/api/src/modules/domain/repositories/__tests__/organization-domain.repository.spec.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OrganizationDomainRepository } from '../organization-domain.repository';
import { db } from '@/config/drizzle/db';

describe('OrganizationDomainRepository', () => {
  let repository: OrganizationDomainRepository;

  beforeEach(async () => {
    await db.transaction(async (tx) => {
      repository = new OrganizationDomainRepository(tx);
    });
  });

  afterEach(async () => {
    await db.rollback();
  });

  describe('create', () => {
    it('should insert domain into database', async () => {
      const domain = await repository.create({
        organizationId: 'org-123',
        domain: 'test.com',
        verificationMethod: 'txt',
        verificationToken: 'token-abc',
        verificationStatus: 'pending',
      });

      expect(domain.id).toBeTruthy();
      expect(domain.domain).toBe('test.com');
    });
  });

  describe('findPendingDomainsForRetry', () => {
    it('should return domains ready for retry', async () => {
      // Create pending domain with nextRetryAt in past
      await repository.create({
        organizationId: 'org-123',
        domain: 'retry.com',
        verificationMethod: 'txt',
        verificationToken: 'token',
        verificationStatus: 'pending',
        retryAttempts: 3,
        nextRetryAt: new Date(Date.now() - 3600000), // 1 hour ago
      });

      const pending = await repository.findPendingDomainsForRetry();

      expect(pending.length).toBeGreaterThan(0);
      expect(pending[0].domain).toBe('retry.com');
    });
  });
});
```

**Test Coverage**: All repository methods (create, findById, findByOrganization, findPendingForRetry, update, delete)

---

## Test Execution

### Run All Unit Tests
```bash
bun run test
```

### Run Specific Test File
```bash
bun run test domain-adapter.service.spec.ts
```

### Run with Coverage
```bash
bun run test:coverage
```

### Watch Mode (TDD)
```bash
bun run test -- --watch
```

---

## Mock Implementations

### MockDnsResolver

**File**: `apps/api/src/modules/domain/services/__mocks__/mock-dns-resolver.ts`

```typescript
import { IDnsResolver } from '../../interfaces/dns-resolver.interface';

export class MockDnsResolver implements IDnsResolver {
  private txtRecords = new Map<string, string[][]>();
  private cnameRecords = new Map<string, string[]>();
  private txtCallCount = 0;
  private cnameCallCount = 0;

  setMockTxtRecord(hostname: string, records: string[][]) {
    this.txtRecords.set(hostname, records);
  }

  setMockCnameRecord(hostname: string, records: string[]) {
    this.cnameRecords.set(hostname, records);
  }

  async resolveTxt(hostname: string): Promise<string[][]> {
    this.txtCallCount++;
    const records = this.txtRecords.get(hostname);
    
    if (!records) {
      const error: any = new Error('ENOTFOUND');
      error.code = 'ENOTFOUND';
      throw error;
    }
    
    return records;
  }

  async resolveCname(hostname: string): Promise<string[]> {
    this.cnameCallCount++;
    const records = this.cnameRecords.get(hostname);
    
    if (!records) {
      const error: any = new Error('ENOTFOUND');
      error.code = 'ENOTFOUND';
      throw error;
    }
    
    return records;
  }

  getTxtCallCount() {
    return this.txtCallCount;
  }

  getCnameCallCount() {
    return this.cnameCallCount;
  }
}
```

---

## Coverage Goals

| Component | Target Coverage | Priority |
|-----------|----------------|----------|
| Adapters | 100% | HIGHEST |
| Services | 90%+ | HIGH |
| Guards | 95%+ | HIGH |
| Repositories | 85%+ | MEDIUM |
| Controllers | 80%+ | MEDIUM |

---

## Next Steps

1. ✅ Unit test plan complete
2. Create `integration-test-plan.md` (API endpoint testing)
3. Create `e2e-test-plan.md` (end-to-end workflow testing)
