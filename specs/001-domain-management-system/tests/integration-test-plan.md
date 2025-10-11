# Integration Test Plan: Domain Management System

**Purpose**: API endpoint testing with mock DNS and database transactions

**Test Runner**: Vitest

**Command**: `bun run test -- integration`

---

## Test Strategy

- Test ORPC endpoints (not HTTP directly)
- Mock DNS resolver for verification tests
- Use database transactions (rollback after each test)
- Mock Better Auth session
- Test happy path + error scenarios

---

## 1. Organization Domain Endpoints

### File: `apps/api/src/modules/domain/__tests__/integration/organization-domain.integration.spec.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createCaller } from '@/test/helpers/orpc-test-helper';
import { MockDnsResolver } from '../../services/__mocks__/mock-dns-resolver';
import { db } from '@/config/drizzle/db';

describe('OrganizationDomain Integration', () => {
  let caller: ReturnType<typeof createCaller>;
  let mockDns: MockDnsResolver;

  beforeEach(async () => {
    await db.transaction(async (tx) => {
      mockDns = new MockDnsResolver();
      caller = createCaller({
        user: { id: 'user-1', role: 'owner', organizationId: 'org-1' },
        dnsResolver: mockDns,
        tx,
      });
    });
  });

  afterEach(async () => {
    await db.rollback();
  });

  describe('list', () => {
    it('should return paginated domains', async () => {
      // Create test domains
      await caller.domain.organizationDomain.create({
        organizationId: 'org-1',
        domain: 'example1.com',
        verificationMethod: 'txt',
      });

      await caller.domain.organizationDomain.create({
        organizationId: 'org-1',
        domain: 'example2.com',
        verificationMethod: 'txt',
      });

      // Act
      const result = await caller.domain.organizationDomain.list({
        organizationId: 'org-1',
        page: 1,
        limit: 50,
      });

      // Assert
      expect(result.total).toBe(2);
      expect(result.domains).toHaveLength(2);
      expect(result.hasMore).toBe(false);
    });

    it('should filter by verification status', async () => {
      await caller.domain.organizationDomain.create({
        organizationId: 'org-1',
        domain: 'verified.com',
        verificationMethod: 'txt',
      });
      
      // Manually update to verified status
      // (would be done via verify endpoint in real flow)

      const result = await caller.domain.organizationDomain.list({
        organizationId: 'org-1',
        status: 'verified',
      });

      expect(result.domains.every(d => d.verificationStatus === 'verified')).toBe(true);
    });
  });

  describe('create', () => {
    it('should create domain and return verification instructions', async () => {
      const result = await caller.domain.organizationDomain.create({
        organizationId: 'org-1',
        domain: 'newdomain.com',
        verificationMethod: 'txt',
      });

      expect(result.domain.domain).toBe('newdomain.com');
      expect(result.domain.verificationStatus).toBe('pending');
      expect(result.verificationInstructions.method).toBe('txt');
      expect(result.verificationInstructions.recordType).toBe('TXT');
      expect(result.verificationInstructions.hostname).toContain('_deployer-verify');
    });

    it('should throw error when quota exceeded', async () => {
      // Set org settings to maxDomains = 1
      await setOrganizationSettings('org-1', { maxDomains: 1 });

      // Create first domain (should succeed)
      await caller.domain.organizationDomain.create({
        organizationId: 'org-1',
        domain: 'first.com',
        verificationMethod: 'txt',
      });

      // Create second domain (should fail - quota exceeded)
      await expect(
        caller.domain.organizationDomain.create({
          organizationId: 'org-1',
          domain: 'second.com',
          verificationMethod: 'txt',
        })
      ).rejects.toThrow('DOMAIN_QUOTA_EXCEEDED');
    });
  });

  describe('verify', () => {
    it('should verify TXT record and update status', async () => {
      // Create domain
      const created = await caller.domain.organizationDomain.create({
        organizationId: 'org-1',
        domain: 'verify-me.com',
        verificationMethod: 'txt',
      });

      // Mock DNS response
      mockDns.setMockTxtRecord(
        `_deployer-verify.verify-me.com`,
        [[`deployer-verify=${created.domain.verificationToken}`]]
      );

      // Verify
      const result = await caller.domain.organizationDomain.verify({
        organizationId: 'org-1',
        domainId: created.domain.id,
      });

      expect(result.success).toBe(true);
      expect(result.domain.verificationStatus).toBe('verified');
      expect(result.domain.verifiedAt).toBeTruthy();
      expect(result.domain.retryAttempts).toBe(0); // Reset on success
    });

    it('should handle verification failure gracefully', async () => {
      const created = await caller.domain.organizationDomain.create({
        organizationId: 'org-1',
        domain: 'fail-verify.com',
        verificationMethod: 'txt',
      });

      // No DNS mock set (will fail with ENOTFOUND)

      const result = await caller.domain.organizationDomain.verify({
        organizationId: 'org-1',
        domainId: created.domain.id,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('DNS record not found');
    });
  });

  describe('delete', () => {
    it('should delete unused domain (Organization Owner)', async () => {
      const created = await caller.domain.organizationDomain.create({
        organizationId: 'org-1',
        domain: 'deleteme.com',
        verificationMethod: 'txt',
      });

      const result = await caller.domain.organizationDomain.delete({
        organizationId: 'org-1',
        domainId: created.domain.id,
        force: false,
      });

      expect(result.success).toBe(true);
    });

    it('should block deletion of domain in use (Organization Admin)', async () => {
      // Create domain + assign to project + create service mapping
      const created = await caller.domain.organizationDomain.create({
        organizationId: 'org-1',
        domain: 'in-use.com',
        verificationMethod: 'txt',
      });

      await assignDomainToProject(created.domain.id, 'project-1');
      await createServiceMapping(created.domain.id, 'service-1');

      // Try to delete as Organization Admin (not Owner)
      const adminCaller = createCaller({
        user: { id: 'admin-1', role: 'admin', organizationId: 'org-1' },
      });

      await expect(
        adminCaller.domain.organizationDomain.delete({
          organizationId: 'org-1',
          domainId: created.domain.id,
          force: false,
        })
      ).rejects.toThrow('DOMAIN_IN_USE');
    });

    it('should allow force delete with Organization Owner role', async () => {
      // Same setup as above but with force=true
      const created = await caller.domain.organizationDomain.create({
        organizationId: 'org-1',
        domain: 'force-delete.com',
        verificationMethod: 'txt',
      });

      await assignDomainToProject(created.domain.id, 'project-1');

      const result = await caller.domain.organizationDomain.delete({
        organizationId: 'org-1',
        domainId: created.domain.id,
        force: true, // Organization Owner can force delete
      });

      expect(result.success).toBe(true);
    });
  });
});
```

---

## 2. Project Domain Endpoints

### File: `apps/api/src/modules/domain/__tests__/integration/project-domain.integration.spec.ts`

```typescript
describe('ProjectDomain Integration', () => {
  describe('assignDomains (multi-select + auto-register)', () => {
    it('should assign multiple existing domains atomically', async () => {
      // Create 3 domains
      const domains = await Promise.all([
        createDomain('org-1', 'dom1.com'),
        createDomain('org-1', 'dom2.com'),
        createDomain('org-1', 'dom3.com'),
      ]);

      const result = await caller.domain.projectDomain.assignDomains({
        organizationId: 'org-1',
        projectId: 'proj-1',
        domains: domains.map(d => ({ type: 'existing', organizationDomainId: d.id })),
      });

      expect(result.success).toBe(true);
      expect(result.assigned).toHaveLength(3);
    });

    it('should create new domain + assign in single operation', async () => {
      const result = await caller.domain.projectDomain.assignDomains({
        organizationId: 'org-1',
        projectId: 'proj-1',
        domains: [
          { type: 'new', domain: 'auto-register.com', verificationMethod: 'txt' },
        ],
      });

      expect(result.assigned[0].isNew).toBe(true);
      expect(result.assigned[0].verificationInstructions).toBeTruthy();
    });

    it('should skip duplicates and continue with others', async () => {
      const domain1 = await createDomain('org-1', 'existing.com');
      await assignDomainToProject(domain1.id, 'proj-1'); // Already assigned

      const domain2 = await createDomain('org-1', 'new.com');

      const result = await caller.domain.projectDomain.assignDomains({
        organizationId: 'org-1',
        projectId: 'proj-1',
        domains: [
          { type: 'existing', organizationDomainId: domain1.id }, // Will skip
          { type: 'existing', organizationDomainId: domain2.id }, // Will succeed
        ],
      });

      expect(result.assigned).toHaveLength(1);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toContain('Already assigned');
    });
  });

  describe('RBAC - Project Admin restrictions', () => {
    it('should allow Project Admin to assign to own project', async () => {
      const projectAdminCaller = createCaller({
        user: { id: 'proj-admin-1', role: 'project_admin', projectIds: ['proj-1'] },
      });

      const domain = await createDomain('org-1', 'my-project.com');

      const result = await projectAdminCaller.domain.projectDomain.assignDomains({
        organizationId: 'org-1',
        projectId: 'proj-1', // Own project
        domains: [{ type: 'existing', organizationDomainId: domain.id }],
      });

      expect(result.success).toBe(true);
    });

    it('should deny Project Admin assigning to other project', async () => {
      const projectAdminCaller = createCaller({
        user: { id: 'proj-admin-1', role: 'project_admin', projectIds: ['proj-1'] },
      });

      const domain = await createDomain('org-1', 'other-project.com');

      await expect(
        projectAdminCaller.domain.projectDomain.assignDomains({
          organizationId: 'org-1',
          projectId: 'proj-2', // NOT their project
          domains: [{ type: 'existing', organizationDomainId: domain.id }],
        })
      ).rejects.toThrow('PROJECT_ACCESS_DENIED');
    });
  });
});
```

---

## 3. Service Domain Mapping Endpoints

### File: `apps/api/src/modules/domain/__tests__/integration/service-domain-mapping.integration.spec.ts`

```typescript
describe('ServiceDomainMapping Integration', () => {
  describe('checkConflict', () => {
    it('should detect conflict for exact match (projectDomain + subdomain + basePath)', async () => {
      // Create existing mapping
      await createMapping({
        projectDomainId: 'pd-1',
        subdomain: 'api',
        basePath: '/v1',
      });

      // Check for conflict
      const result = await caller.domain.serviceDomainMapping.checkConflict({
        projectDomainId: 'pd-1',
        subdomain: 'api',
        basePath: '/v1',
      });

      expect(result.conflict).toBe(true);
      expect(result.existingMapping).toBeTruthy();
    });

    it('should allow different subdomain on same domain', async () => {
      await createMapping({
        projectDomainId: 'pd-1',
        subdomain: 'api',
        basePath: '/v1',
      });

      const result = await caller.domain.serviceDomainMapping.checkConflict({
        projectDomainId: 'pd-1',
        subdomain: 'dashboard', // Different subdomain
        basePath: '/v1',
      });

      expect(result.conflict).toBe(false);
    });
  });

  describe('create', () => {
    it('should create service mapping with routing config', async () => {
      const result = await caller.domain.serviceDomainMapping.create({
        organizationId: 'org-1',
        projectId: 'proj-1',
        projectDomainId: 'pd-1',
        serviceId: 'svc-1',
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

      expect(result.mapping.subdomain).toBe('api');
      expect(result.mapping.internalPort).toBe(3000);
      expect(result.mapping.protocolConfig.httpsEnabled).toBe(true);
    });
  });
});
```

---

## Coverage Goals

| Integration Test Type | Coverage | Priority |
|----------------------|----------|----------|
| ORPC Endpoints | 100% (all procedures) | HIGHEST |
| RBAC Scenarios | 100% (all 4 roles) | HIGH |
| Error Scenarios | 90%+ | HIGH |
| Transaction Rollback | 100% | MEDIUM |

---

## Next: `e2e-test-plan.md`
