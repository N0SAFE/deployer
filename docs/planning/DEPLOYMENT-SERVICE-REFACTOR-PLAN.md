# DeploymentService Refactoring Plan

## Overview

**Current State**: DeploymentService (2,205 lines) violates the Repository Ownership Rule by directly using `DatabaseService` instead of `DeploymentRepository`.

**Problem**: 38 database operations need to be converted to use:
- `DeploymentRepository` for deployment-related queries
- `ServiceService` for service-related queries  
- `ProjectService` for project-related queries

**Goal**: Follow the Repository Ownership Rule where each repository is owned by ONE domain service, and cross-domain data access goes through domain services.

## File Information

- **File**: `apps/api/src/core/modules/deployment/services/deployment.service.ts`
- **Current Lines**: 2,205
- **Database Operations**: 38
- **Dependencies to Update**:
  - ❌ Remove: `DatabaseService`
  - ✅ Add: `DeploymentRepository`
  - ✅ Add: `ServiceService` 
  - ✅ Add: `ProjectService` (if needed)

## Database Operation Mapping

### Category 1: Deployment CRUD Operations (Use DeploymentRepository)

| Line | Current Code | Repository Method | Status |
|------|--------------|-------------------|--------|
| 145-151 | `db.select().from(services).where(eq(services.name, serviceName))` | ❌ Should use `ServiceService.findByName()` | CROSS-DOMAIN |
| 390-395 | `db.select({ svc: services, proj: projects }).from(services).innerJoin(projects)` | ❌ Should use `ServiceService.findByNameWithProject()` | CROSS-DOMAIN |
| 810 | `db.delete(deployments).where(eq(deployments.id, deploymentId))` | ✅ `deploymentRepository.delete(deploymentId)` | EXISTS |
| 934-938 | `db.update(deployments).set({...}).where(eq(deployments.id, id))` | ✅ `deploymentRepository.updateStatus()` | EXISTS |
| 955-958 | `db.insert(deployments).values(insertData).returning()` | ✅ `deploymentRepository.create()` | EXISTS |
| 969-974 | `db.select().from(deployments).where(eq(deployments.id, id))` | ✅ `deploymentRepository.findById()` | EXISTS |
| 995-1000 | `db.update(deployments).set({...}).where(eq(deployments.id, id))` | ✅ `deploymentRepository.updateStatus()` | EXISTS |
| 1009-1014 | `db.update(deployments).set({...}).where(eq(deployments.id, id))` | ✅ `deploymentRepository.updatePhase()` | EXISTS |
| 1030-1034 | `db.update(deployments).set({...}).where(eq(deployments.id, id))` | ✅ `deploymentRepository.updateStatus()` | EXISTS |
| 1218-1226 | `db.select().from(deployments).where(eq(deployments.serviceId, serviceId))` | ✅ `deploymentRepository.findMany({ serviceId })` | EXISTS |
| 1228 | `db.delete(deploymentLogs).where(eq(deploymentLogs.deploymentId, deployment.id))` | ✅ `deploymentRepository.deleteLogs()` | EXISTS |
| 1232 | `db.delete(deployments).where(eq(deployments.id, deployment.id))` | ✅ `deploymentRepository.delete()` | EXISTS |
| 1281-1287 | `db.select().from(deployments).where(eq(deployments.id, id))` | ✅ `deploymentRepository.findById()` | EXISTS |
| 1378-1384 | `db.select().from(deployments).where(eq(deployments.id, id))` | ✅ `deploymentRepository.findById()` | EXISTS |
| 1409-1415 | `db.update(deployments).set({...}).where(eq(deployments.id, id))` | ✅ `deploymentRepository.updatePhase()` | EXISTS |
| 1460-1466 | `db.select().from(deployments).where(eq(deployments.id, id))` | ✅ `deploymentRepository.findById()` | EXISTS |
| 1574-1580 | `db.select().from(deployments).where(inArray(deployments.status, ['queued', 'building', 'deploying']))` | ✅ `deploymentRepository.findActiveDeployments()` | EXISTS |
| 1595-1610 | `db.select().from(deployments).where(and(...filters))` | ✅ `deploymentRepository.findMany(filters)` | EXISTS |
| 1814-1820 | `db.select().from(deployments).where(eq(deployments.id, id))` | ✅ `deploymentRepository.findById()` | EXISTS |
| 2135-2141 | `db.select().from(deploymentRollbacks).where(eq(...))` | ⚠️ NEED NEW METHOD: `deploymentRepository.findRollbacksByDeployment()` | NEW |
| 2163-2169 | `db.update(deploymentRollbacks).set({...}).where(eq(...))` | ⚠️ NEED NEW METHOD: `deploymentRepository.updateRollback()` | NEW |
| 2188-2194 | `db.update(deployments).set({...}).where(eq(deployments.id, targetDeploymentId))` | ✅ `deploymentRepository.updateStatus()` | EXISTS |

### Category 2: Deployment Logs (Use DeploymentRepository)

| Line | Current Code | Repository Method | Status |
|------|--------------|-------------------|--------|
| 1063-1068 | `db.insert(deploymentLogs).values(insertData)` | ✅ `deploymentRepository.addLog()` | EXISTS |
| 1072-1086 | `db.select().from(deploymentLogs).where(eq(...))` | ✅ `deploymentRepository.getLogs()` | EXISTS |
| 1088-1098 | `db.select().from(deploymentLogs).where(eq(...)).orderBy(desc(...))` | ✅ `deploymentRepository.getRecentLogs()` | EXISTS |
| 1418-1426 | `db.insert(deploymentLogs).values({...})` | ✅ `deploymentRepository.addLog()` | EXISTS |
| 1474-1482 | `db.select().from(deploymentLogs).where(eq(...)).orderBy(desc(...))` | ✅ `deploymentRepository.getRecentLogs()` | EXISTS |
| 1514-1522 | `db.insert(deploymentLogs).values({...})` | ✅ `deploymentRepository.addLog()` | EXISTS |
| 1535-1543 | `db.insert(deploymentLogs).values({...})` | ✅ `deploymentRepository.addLog()` | EXISTS |

### Category 3: Deployment Statistics (Use DeploymentRepository)

| Line | Current Code | Repository Method | Status |
|------|--------------|-------------------|--------|
| 1100-1150 | Complex stats query with multiple `db.select({ count: count() })` | ✅ `deploymentRepository.getServiceStats(serviceId)` | EXISTS |
| 1134-1137 | Multiple count queries for success/failed/building | ✅ Part of `deploymentRepository.getServiceStats()` | EXISTS |

### Category 4: Service Queries (Use ServiceService - CROSS-DOMAIN)

| Line | Current Code | Required Service Method | Status |
|------|--------------|------------------------|--------|
| 145-151 | `db.select().from(services).where(eq(services.name, serviceName))` | ❌ `ServiceService.findByName(serviceName)` | VERIFY EXISTS |
| 390-395 | `db.select({ svc: services, proj: projects }).from(services).innerJoin(projects)` | ❌ `ServiceService.findByNameWithProject(serviceName)` | NEED NEW |
| 1825-1831 | `db.select().from(services).where(eq(services.id, serviceId))` | ❌ `ServiceService.findById(serviceId)` | VERIFY EXISTS |

### Category 5: Rollback Queries (Need New Repository Methods)

| Line | Current Code | Required Repository Method | Status |
|------|--------------|---------------------------|--------|
| 1779-1785 | `db.select().from(deploymentRollbacks).where(eq(...))` | ⚠️ `deploymentRepository.findRollbacksByDeployment()` | NEW |
| 2135-2141 | `db.select().from(deploymentRollbacks).where(eq(...))` | ⚠️ `deploymentRepository.findRollbackById()` | NEW |
| 2163-2169 | `db.update(deploymentRollbacks).set({...}).where(eq(...))` | ⚠️ `deploymentRepository.updateRollback()` | NEW |

## Refactoring Strategy

### Phase 1: Prepare Dependencies ✅ VERIFY READY

1. **Check DeploymentRepository has all methods**:
   - [x] findById() ✅
   - [x] create() ✅
   - [x] updateStatus() ✅
   - [x] updatePhase() ✅
   - [x] delete() ✅
   - [x] deleteMany() ✅
   - [x] addLog() ✅
   - [x] getLogs() ✅
   - [x] getRecentLogs() ✅
   - [x] deleteLogs() ✅
   - [x] findMany() ✅
   - [x] findActiveDeployments() ✅
   - [x] getServiceStats() ✅
   - [ ] findRollbacksByDeployment() ⚠️ NEED TO ADD
   - [ ] findRollbackById() ⚠️ NEED TO ADD
   - [ ] updateRollback() ⚠️ NEED TO ADD
   - [ ] createRollback() ⚠️ NEED TO ADD (if not exists)

2. **Check ServiceService has required methods**:
   - [ ] findByName(name: string) - VERIFY
   - [ ] findById(id: string) - VERIFY
   - [ ] findByNameWithProject(name: string) - NEED NEW METHOD

3. **Check ProjectService (if needed)**:
   - Dependencies analysis shows no direct project queries in deployment service
   - Project data is accessed via ServiceService joins

### Phase 2: Add Missing Repository Methods

**File**: `apps/api/src/core/modules/deployment/repositories/deployment.repository.ts`

Add rollback-related methods:

```typescript
/**
 * Find rollbacks for a deployment
 */
async findRollbacksByDeployment(deploymentId: string): Promise<DeploymentRollback[]> {
  return this.databaseService.db
    .select()
    .from(deploymentRollbacks)
    .where(eq(deploymentRollbacks.targetDeploymentId, deploymentId))
    .orderBy(desc(deploymentRollbacks.createdAt));
}

/**
 * Find rollback by ID
 */
async findRollbackById(id: string): Promise<DeploymentRollback | null> {
  const [rollback] = await this.databaseService.db
    .select()
    .from(deploymentRollbacks)
    .where(eq(deploymentRollbacks.id, id))
    .limit(1);
  
  return rollback || null;
}

/**
 * Create rollback record
 */
async createRollback(data: DeploymentRollbackInsert): Promise<DeploymentRollback> {
  const [rollback] = await this.databaseService.db
    .insert(deploymentRollbacks)
    .values(data)
    .returning();
  
  return rollback;
}

/**
 * Update rollback status
 */
async updateRollback(
  id: string, 
  data: Partial<DeploymentRollbackInsert>
): Promise<DeploymentRollback | null> {
  const [updated] = await this.databaseService.db
    .update(deploymentRollbacks)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(deploymentRollbacks.id, id))
    .returning();
  
  return updated || null;
}
```

### Phase 3: Add Missing ServiceService Methods

**File**: `apps/api/src/core/modules/service/services/service.service.ts`

Add method to get service with project:

```typescript
/**
 * Find service by name with project relation
 */
async findByNameWithProject(name: string): Promise<ServiceWithProject | null> {
  const result = await this.serviceRepository.findByNameWithProject(name);
  return result;
}
```

**Note**: This requires adding the method to ServiceRepository first:

**File**: `apps/api/src/core/modules/service/repositories/service.repository.ts`

```typescript
/**
 * Find service by name with project relation
 */
async findByNameWithProject(name: string): Promise<ServiceWithProject | null> {
  const [result] = await this.databaseService.db
    .select({
      service: services,
      project: projects,
    })
    .from(services)
    .innerJoin(projects, eq(services.projectId, projects.id))
    .where(eq(services.name, name))
    .limit(1);
  
  if (!result) return null;
  
  return {
    ...result.service,
    project: result.project,
  };
}
```

### Phase 4: Update DeploymentService Constructor

**Current**:
```typescript
constructor(
    private readonly dockerService: DockerService,
    private readonly databaseService: DatabaseService,  // ❌ REMOVE
    private readonly providerRegistry: ProviderRegistryService,
    private readonly builderRegistry: BuilderRegistryService,
) {}
```

**Target**:
```typescript
constructor(
    private readonly dockerService: DockerService,
    private readonly deploymentRepository: DeploymentRepository,  // ✅ ADD
    private readonly serviceService: ServiceService,              // ✅ ADD
    private readonly providerRegistry: ProviderRegistryService,
    private readonly builderRegistry: BuilderRegistryService,
) {}
```

### Phase 5: Refactor Methods Systematically

**Order of Refactoring** (least risky to most risky):

1. **Simple read operations** (lines 969, 1281, 1378, 1460, 1814):
   ```typescript
   // BEFORE
   const [deployment] = await this.databaseService.db
       .select()
       .from(deployments)
       .where(eq(deployments.id, id))
       .limit(1);
   
   // AFTER
   const deployment = await this.deploymentRepository.findById(id);
   ```

2. **Simple write operations** (lines 995, 1009, 1030, 934):
   ```typescript
   // BEFORE
   await this.databaseService.db
       .update(deployments)
       .set({ status, updatedAt: new Date() })
       .where(eq(deployments.id, id));
   
   // AFTER
   await this.deploymentRepository.updateStatus(id, status);
   ```

3. **Log operations** (lines 1063, 1418, 1514, 1535):
   ```typescript
   // BEFORE
   await this.databaseService.db.insert(deploymentLogs).values(insertData);
   
   // AFTER
   await this.deploymentRepository.addLog(deploymentId, logData);
   ```

4. **Complex queries** (lines 1100-1150, 1595-1610):
   ```typescript
   // BEFORE
   const query = this.databaseService.db
       .select()
       .from(deployments)
       .where(and(...filters));
   
   // AFTER
   const { deployments, total } = await this.deploymentRepository.findMany(filters);
   ```

5. **Cross-domain queries** (lines 145-151, 390-395, 1825-1831):
   ```typescript
   // BEFORE (Line 145)
   const db = this.databaseService.db;
   const [service] = await db
       .select()
       .from(services)
       .where(eq(services.name, serviceName))
       .limit(1);
   
   // AFTER
   const service = await this.serviceService.findByName(serviceName);
   if (!service) {
       throw new NotFoundException(`Service ${serviceName} not found`);
   }
   
   // BEFORE (Line 390)
   const row = await this.databaseService.db
       .select({ svc: services, proj: projects })
       .from(services)
       .innerJoin(projects, eq(services.projectId, projects.id))
       .where(eq(services.name, serviceName))
       .limit(1);
   
   // AFTER
   const result = await this.serviceService.findByNameWithProject(serviceName);
   if (result) {
       const projectName = result.project?.name || '';
       finalSubdomain = `${DeploymentService.sanitizeForSubdomain(serviceName)}-${DeploymentService.sanitizeForSubdomain(projectName || 'project')}`;
   }
   ```

6. **Rollback operations** (lines 1779, 2135, 2163):
   ```typescript
   // BEFORE
   const rollbacks = await this.databaseService.db
       .select()
       .from(deploymentRollbacks)
       .where(eq(deploymentRollbacks.targetDeploymentId, deploymentId));
   
   // AFTER
   const rollbacks = await this.deploymentRepository.findRollbacksByDeployment(deploymentId);
   ```

### Phase 6: Update Module Providers

**File**: `apps/api/src/core/modules/deployment/deployment.module.ts`

Ensure all dependencies are provided:

```typescript
@Module({
  imports: [
    CoreModule,  // Provides DatabaseService, DockerService, etc.
    ServiceModule,  // ✅ ADD if not present - provides ServiceService
  ],
  controllers: [DeploymentController],
  providers: [
    DeploymentService,          // The service we're refactoring
    DeploymentRepository,       // ✅ Verify present
    DeploymentHealthMonitorService,
    DeploymentCleanupService,
    ZombieCleanupService,
    DeploymentOrchestratorService,
    // ... other providers
  ],
  exports: [
    DeploymentService,
    DeploymentRepository,
    // ... other exports
  ],
})
export class DeploymentModule {}
```

### Phase 7: Testing & Verification

1. **Compilation Check**:
   ```bash
   bun run build:api
   ```

2. **Test Deployment Flow**:
   - Create deployment
   - Monitor deployment status
   - Check deployment logs
   - Verify rollback functionality

3. **Verify No DatabaseService Usage**:
   ```bash
   grep -n "databaseService" apps/api/src/core/modules/deployment/services/deployment.service.ts
   ```
   Should only show imports, no usage.

## Expected Outcomes

### Before Refactoring

```typescript
// ❌ DeploymentService violates Repository Ownership Rule
@Injectable()
export class DeploymentService {
  constructor(
    private readonly dockerService: DockerService,
    private readonly databaseService: DatabaseService,  // ❌ WRONG
    private readonly providerRegistry: ProviderRegistryService,
    private readonly builderRegistry: BuilderRegistryService,
  ) {}
  
  async deployService(config) {
    const db = this.databaseService.db;  // ❌ Direct access
    const [service] = await db.select().from(services)...  // ❌ Cross-domain
    // ... 38 more database operations
  }
}
```

### After Refactoring

```typescript
// ✅ DeploymentService follows Repository Ownership Rule
@Injectable()
export class DeploymentService {
  constructor(
    private readonly dockerService: DockerService,
    private readonly deploymentRepository: DeploymentRepository,  // ✅ Use repository
    private readonly serviceService: ServiceService,              // ✅ Use other domain services
    private readonly providerRegistry: ProviderRegistryService,
    private readonly builderRegistry: BuilderRegistryService,
  ) {}
  
  async deployService(config) {
    const service = await this.serviceService.findByName(serviceName);  // ✅ Via service
    // Business logic here
    const deployment = await this.deploymentRepository.create({...});  // ✅ Via repository
    // ... all 38 operations converted
  }
}
```

## Impact on Dependent Services

Once DeploymentService is refactored, we can fix the 3 services that currently violate the rule:

1. **deployment-orchestrator.service.ts**:
   - Can now use `DeploymentService` instead of `DeploymentRepository`
   
2. **zombie-cleanup.service.ts**:
   - Can now use `DeploymentService` instead of `DeploymentRepository`
   
3. **deployment-cleanup.service.ts**:
   - Already uses `DeploymentRepository` correctly (owns deployment domain)
   - Just needs to replace `ServiceRepository` with `ServiceService`

## Risk Assessment

### High Risk Areas

1. **Complex deployment logic** (lines 140-340): Core deployment orchestration
2. **Phase tracking** (lines 1370-1570): Crash recovery mechanism
3. **Rollback system** (lines 1750-2200): Deployment rollback functionality

### Mitigation Strategies

1. **Incremental Refactoring**: Do one category at a time, test after each
2. **Keep Business Logic**: Only move data access, preserve all business logic
3. **Add Logging**: Log before/after each refactored operation during testing
4. **Rollback Plan**: Keep git history clean with atomic commits per phase

## Success Criteria

- [ ] Zero `DatabaseService` usage in DeploymentService
- [ ] All 38 database operations converted to repository/service calls
- [ ] Compilation succeeds with no errors
- [ ] All deployment flows work (create, monitor, rollback)
- [ ] Dependent services can be refactored
- [ ] Code follows Repository Ownership Rule

## Timeline Estimate

- **Phase 1**: 30 minutes (verify dependencies)
- **Phase 2**: 1 hour (add missing repository methods)
- **Phase 3**: 1 hour (add ServiceService methods)
- **Phase 4**: 15 minutes (update constructor)
- **Phase 5**: 4 hours (refactor 38 operations)
- **Phase 6**: 30 minutes (update module)
- **Phase 7**: 2 hours (testing & verification)

**Total**: ~9 hours of focused work

## Next Steps

1. ✅ Read this plan thoroughly
2. ⏳ Verify ServiceService has `findByName()` and `findById()` methods
3. ⏳ Add missing repository methods (Phase 2)
4. ⏳ Add missing ServiceService methods (Phase 3)
5. ⏳ Begin systematic refactoring (Phase 5)
6. ⏳ Test thoroughly (Phase 7)
7. ⏳ Fix dependent service violations

---

**Document Status**: READY FOR EXECUTION
**Last Updated**: 2024
**Next Action**: Verify ServiceService methods exist before starting refactoring
