# API Module Standardization Plan

> **Date**: January 13, 2025  
> **Status**: � In Progress (User Module Complete ✅)  
> **Purpose**: Standardize all API modules to follow the Service-Adapter pattern

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State Analysis](#current-state-analysis)
3. [Target Architecture](#target-architecture)
4. [Module-by-Module Plan](#module-by-module-plan)
5. [Implementation Checklist](#implementation-checklist)
6. [Testing Strategy](#testing-strategy)
7. [Migration Guidelines](#migration-guidelines)

---

## Executive Summary

### Problem Statement

The API modules currently have **inconsistent structure** and do **not follow the documented Service-Adapter pattern**:

- ❌ Missing `adapters/` folders for contract transformation
- ❌ Missing `interfaces/` folders for type definitions
- ❌ Missing `repositories/` folders for data access
- ❌ Services mixing concerns (business logic + data access + contract transformation)
- ❌ Controllers directly delegating to services (no orchestration)
- ❌ Inline types scattered across files

### Target State

All feature modules will follow the **standard folder structure**:

```
apps/api/src/modules/[feature]/
├── adapters/              # Contract transformation (✅ Required)
│   └── [feature]-adapter.service.ts
├── controllers/           # HTTP endpoints (✅ Required)
│   └── [feature].controller.ts
├── interfaces/            # Type definitions (✅ Required)
│   ├── [feature].types.ts
│   └── [feature].interfaces.ts
├── repositories/          # Data access (✅ Required for DB modules)
│   └── [feature].repository.ts
├── services/              # Business logic (✅ Required)
│   └── [feature].service.ts
├── processors/            # Bull processors (Optional - if async work)
│   └── [feature].processor.ts
├── guards/                # Auth guards (Optional - if special auth)
│   └── [feature].guard.ts
├── decorators/            # Custom decorators (Optional)
│   └── [feature].decorator.ts
├── [feature].module.ts    # Module definition
└── index.ts               # Barrel exports
```

### Benefits

1. ✅ **Consistency** - All modules follow the same structure
2. ✅ **Separation of Concerns** - Clear boundaries between layers
3. ✅ **Type Safety** - Contract types enforced at compile-time
4. ✅ **Reusability** - Services can be composed across endpoints
5. ✅ **Maintainability** - Easy to locate and update code
6. ✅ **Testability** - Each layer can be tested independently

---

## Current State Analysis

### Module Inventory

| Module | Current Structure | Compliance | Priority |
|--------|------------------|------------|----------|
| **user** | ✅ controllers/, services/, repositories/, adapters/, interfaces/ | ✅ **COMPLIANT** | HIGH (COMPLETE ✅) |
| **project** | controllers/, services/ | ❌ Non-compliant (missing 4 folders) | HIGH |
| **service** | controllers/, services/ | ❌ Non-compliant (missing 4 folders) | HIGH |
| **deployment** | controllers/ | ❌ Non-compliant (missing 5 folders) | HIGH |
| **traefik** | controllers/ | ❌ Non-compliant (missing 5 folders) | MEDIUM |
| **storage** | controllers/ | ⚠️ Special case (core services exist) | MEDIUM |
| **static-file** | controllers/ | ❌ Non-compliant (missing 5 folders) | MEDIUM |
| **domain** | decorators/, guards/, interfaces/, processors/, services/ (empty) | ⚠️ Partial (empty services/) | LOW |
| **analytics** | *(needs analysis)* | ❌ Unknown | LOW |
| **health** | *(needs analysis)* | ❌ Unknown | LOW |
| **websocket** | *(needs analysis)* | ❌ Unknown | LOW |

### Key Anti-Patterns Observed

#### 1. Services Doing Too Much

**Example from `user.service.ts`**:
```typescript
// ❌ Service method returns data directly (likely adapted)
async getUserById(id: string) {
  const user = await this.userRepository.findById(id);
  if (!user) {
    throw new NotFoundException(`User with ID ${id} not found`);
  }
  return user; // Returns entity, but method name is endpoint-specific
}
```

**Problems**:
- ❌ Method name `getUserById` is endpoint-specific (not composable)
- ❌ Throws HTTP exceptions (business logic mixed with HTTP concerns)
- ✅ Returns entity (GOOD), but method needs better naming

**Should be**:
```typescript
// ✅ Composable method returning entity
async findById(id: string): Promise<User | null> {
  return this.userRepository.findById(id);
}
```

#### 2. Missing Contract Transformation

**Example from `project.service.ts`**:
```typescript
// ❌ Service directly accesses database, no repository
async createProject(data: { name: string; ... }) {
  const db = this.databaseService.db;
  const [newProject] = await db.insert(projects).values(...).returning();
  return newProject;
}
```

**Problems**:
- ❌ No repository layer (data access in service)
- ❌ No adapter layer (contract transformation missing)
- ❌ Controller likely receives raw entity

**Should be**:
```typescript
// ✅ Repository layer
class ProjectRepository {
  async create(data: CreateProjectInput): Promise<Project> {
    return this.db.insert(projects).values(...).returning()[0];
  }
}

// ✅ Service layer (business logic)
class ProjectService {
  async createProject(data: CreateProjectInput): Promise<Project> {
    // Business logic, validations
    return this.projectRepository.create(data);
  }
}

// ✅ Adapter layer (contract transformation)
class ProjectAdapter {
  adaptProjectToContract(project: Project): ProjectContract {
    return { id: project.id, name: project.name, ... };
  }
}

// ✅ Controller (orchestration)
class ProjectController {
  @Implement(contract.createProject)
  async createProject(input: CreateProjectInput) {
    const project = await this.projectService.createProject(input);
    return this.projectAdapter.adaptProjectToContract(project);
  }
}
```

#### 3. Missing Type Definitions

**Problem**:
- Types defined inline in services/controllers
- Contract types not extracted to `interfaces/`
- No centralized type definitions

**Should be**:
```typescript
// interfaces/project.types.ts
import { projectContract } from '@repo/api-contracts';

export type ProjectContract = typeof projectContract.createProject.output;
export type ProjectListContract = typeof projectContract.list.output;

export interface CreateProjectInput {
  name: string;
  description?: string;
  ownerId: string;
}
```

---

## Target Architecture

### Standard Module Structure

Every feature module MUST follow this structure:

```
apps/api/src/modules/[feature]/
├── adapters/              # ✅ REQUIRED
│   ├── [feature]-adapter.service.ts
│   └── [feature]-adapter.service.spec.ts
├── controllers/           # ✅ REQUIRED
│   ├── [feature].controller.ts
│   └── [feature].controller.spec.ts
├── interfaces/            # ✅ REQUIRED
│   ├── [feature].types.ts          # Contract types
│   └── [feature].interfaces.ts     # Custom interfaces
├── repositories/          # ✅ REQUIRED (if DB access)
│   ├── [feature].repository.ts
│   └── [feature].repository.spec.ts
├── services/              # ✅ REQUIRED
│   ├── [feature].service.ts
│   └── [feature].service.spec.ts
├── processors/            # ⚠️ OPTIONAL (if Bull queues)
│   ├── [feature].processor.ts
│   └── [feature].processor.spec.ts
├── guards/                # ⚠️ OPTIONAL (if special auth)
│   ├── [feature].guard.ts
│   └── [feature].guard.spec.ts
├── decorators/            # ⚠️ OPTIONAL (if custom decorators)
│   └── [feature].decorator.ts
├── [feature].module.ts    # ✅ REQUIRED
└── index.ts               # ✅ REQUIRED (barrel exports)
```

### Layer Responsibilities

#### 1. Repositories (`repositories/`)

**Purpose**: Database access layer

**Responsibilities**:
- Execute database queries
- Return entities from schema
- Handle database-specific logic (transactions, etc.)

**Rules**:
- ✅ Use `DatabaseService` or ORM
- ✅ Return entities (from schema)
- ❌ NO business logic
- ❌ NO contract types

**Example**:
```typescript
@Injectable()
export class UserRepository {
  constructor(private db: DatabaseService) {}

  async findById(id: string): Promise<User | null> {
    return this.db.query.users.findFirst({ where: eq(users.id, id) });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.db.query.users.findFirst({ where: eq(users.email, email) });
  }

  async create(data: CreateUserInput): Promise<User> {
    const [user] = await this.db.insert(users).values(data).returning();
    return user;
  }
}
```

---

#### 2. Services (`services/`)

**Purpose**: Business logic layer

**Responsibilities**:
- Business logic and validations
- Orchestrate repository calls
- Compose data from multiple sources
- Return entities (NOT contract types)

**Rules**:
- ✅ Call repositories for data
- ✅ Return entities
- ✅ Generic, composable method names (`findById`, not `getUserById`)
- ❌ NO contract types
- ❌ NO HTTP exceptions (use domain exceptions)
- ❌ NO direct database access

**Example**:
```typescript
@Injectable()
export class UserService {
  constructor(private userRepository: UserRepository) {}

  // ✅ Generic, composable methods
  async findById(id: string): Promise<User | null> {
    return this.userRepository.findById(id);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findByEmail(email);
  }

  async createUser(data: CreateUserInput): Promise<User> {
    // Business validation
    const existingUser = await this.findByEmail(data.email);
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }
    
    return this.userRepository.create(data);
  }

  // ✅ Partial entity methods (composable)
  async getStats(userId: string): Promise<UserStats> {
    const user = await this.findById(userId);
    if (!user) return null;
    
    return {
      projectCount: await this.countUserProjects(userId),
      deploymentCount: await this.countUserDeployments(userId),
    };
  }
}
```

---

#### 3. Adapters (`adapters/`)

**Purpose**: Contract transformation layer

**Responsibilities**:
- Transform entities to contract types
- Fixed return types from `@repo/api-contracts`
- Pure transformations only

**Rules**:
- ✅ Return EXACT contract types (imported from contracts)
- ✅ Receive ALL data as parameters
- ✅ NO service dependencies
- ✅ Pure, synchronous transformations
- ❌ NO async operations
- ❌ NO service calls

**Example**:
```typescript
import { Injectable } from '@nestjs/common';
import { UserContract, UserWithStatsContract } from '../interfaces/user.types';

@Injectable()
export class UserAdapter {
  // ✅ Fixed return type from contract
  adaptUserToContract(user: User): UserContract {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  // ✅ Different contract shape, still fixed type
  adaptUserWithStatsToContract(
    user: User,
    stats: UserStats
  ): UserWithStatsContract {
    return {
      ...this.adaptUserToContract(user),
      projectCount: stats.projectCount,
      deploymentCount: stats.deploymentCount,
    };
  }
}
```

---

#### 4. Interfaces (`interfaces/`)

**Purpose**: Type definitions

**Responsibilities**:
- Extract contract types from `@repo/api-contracts`
- Define DTOs
- Define custom types/interfaces

**Rules**:
- ✅ Extract exact contract types
- ✅ Centralize all types
- ❌ NO implementation code

**Example**:
```typescript
// interfaces/user.types.ts
import { userContract } from '@repo/api-contracts';

// Extract contract types
export type UserContract = typeof userContract.getById.output;
export type UserListContract = typeof userContract.list.output;
export type UserWithStatsContract = typeof userContract.getWithStats.output;

// Custom types
export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
}

export interface UserStats {
  projectCount: number;
  deploymentCount: number;
}
```

---

#### 5. Controllers (`controllers/`)

**Purpose**: HTTP endpoint layer

**Responsibilities**:
- Orchestrate service calls
- Aggregate data from multiple service methods
- Pass aggregated data to adapters
- Return contract types

**Rules**:
- ✅ Mix multiple service methods
- ✅ Pass data to adapters
- ✅ Return contract types
- ❌ NO business logic
- ❌ NO direct repository access

**Example**:
```typescript
@Controller()
export class UserController {
  constructor(
    private userService: UserService,
    private userAdapter: UserAdapter,
  ) {}

  @Implement(userContract.getById)
  async getById(input: { id: string }) {
    const user = await this.userService.findById(input.id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.userAdapter.adaptUserToContract(user);
  }

  @Implement(userContract.getWithStats)
  async getWithStats(input: { id: string }) {
    // Orchestrate multiple service methods
    const user = await this.userService.findById(input.id);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const stats = await this.userService.getStats(input.id);
    
    // Pass aggregated data to adapter
    return this.userAdapter.adaptUserWithStatsToContract(user, stats);
  }
}
```

---

## Module-by-Module Plan

### Phase 1: HIGH PRIORITY (Core Features)

#### 1.1 User Module

**Current State**:
- ✅ Has: `controllers/`, `services/`, `repositories/`
- ❌ Missing: `adapters/`, `interfaces/`

**Tasks**:
1. ✅ Create `interfaces/user.types.ts` - Extract contract types
2. ✅ Create `adapters/user-adapter.service.ts` - Contract transformation
3. ⚠️ Refactor `services/user.service.ts`:
   - Rename `getUserById` → `findById`
   - Rename `createUser` → `create` or keep `createUser` (acceptable)
   - Remove HTTP exceptions, use domain exceptions
4. ⚠️ Update `controllers/user.controller.ts`:
   - Add `UserAdapter` injection
   - Orchestrate service calls
   - Use adapter for transformations
5. ✅ Update `user.module.ts` - Add adapter to providers

**Estimated Effort**: 2-3 hours

---

#### 1.2 Project Module

**Current State**:
- ✅ Has: `controllers/`, `services/`
- ❌ Missing: `adapters/`, `interfaces/`, `repositories/`

**Tasks**:
1. ✅ Create `interfaces/project.types.ts` - Extract contract types
2. ✅ Create `repositories/project.repository.ts` - Extract DB access
3. ✅ Create `adapters/project-adapter.service.ts` - Contract transformation
4. ⚠️ Refactor `services/project.service.ts`:
   - Move DB queries to repository
   - Rename methods (generic names)
   - Return entities only
5. ⚠️ Update `controllers/project.controller.ts`:
   - Add adapter injection
   - Orchestrate service calls
   - Use adapter for transformations
6. ✅ Update `project.module.ts` - Add new providers

**Estimated Effort**: 4-6 hours

---

#### 1.3 Service Module

**Current State**:
- ✅ Has: `controllers/`, `services/`
- ❌ Missing: `adapters/`, `interfaces/`, `repositories/`

**Tasks**:
1. ✅ Create `interfaces/service.types.ts` - Extract contract types
2. ✅ Create `repositories/service.repository.ts` - Extract DB access
3. ✅ Create `adapters/service-adapter.service.ts` - Contract transformation
4. ⚠️ Refactor `services/service-traefik-integration.service.ts`:
   - Split into service + repository
   - Generic method names
   - Return entities only
5. ⚠️ Update `controllers/service.controller.ts`:
   - Add adapter injection
   - Orchestrate service calls
   - Use adapter for transformations
6. ✅ Update `service.module.ts` - Add new providers

**Estimated Effort**: 4-6 hours

---

#### 1.4 Deployment Module

**Current State**:
- ✅ Has: `controllers/`
- ❌ Missing: `adapters/`, `interfaces/`, `repositories/`, `services/`

**Tasks**:
1. ✅ Create `interfaces/deployment.types.ts` - Extract contract types
2. ✅ Create `repositories/deployment.repository.ts` - DB access
3. ✅ Create `services/deployment.service.ts` - Business logic
4. ✅ Create `adapters/deployment-adapter.service.ts` - Contract transformation
5. ⚠️ Update `controllers/deployment.controller.ts`:
   - Inject services and adapter
   - Orchestrate service calls
   - Use adapter for transformations
6. ✅ Update `deployment.module.ts` - Add all providers

**Estimated Effort**: 6-8 hours

---

### Phase 2: MEDIUM PRIORITY

#### 2.1 Traefik Module

**Tasks**: Similar to deployment module

**Estimated Effort**: 4-6 hours

---

#### 2.2 Storage Module

**Note**: Core storage services exist, feature module only has HTTP endpoints

**Tasks**:
1. Create `adapters/storage-adapter.service.ts` if needed
2. Create `interfaces/storage.types.ts` if needed
3. Controllers use core storage services

**Estimated Effort**: 2-3 hours

---

#### 2.3 Static File Module

**Tasks**: Similar to storage module

**Estimated Effort**: 2-3 hours

---

### Phase 3: LOW PRIORITY

#### 3.1 Other Modules

- analytics
- health
- websocket
- github-webhook
- github-oauth
- environment
- setup
- bootstrap
- ci-cd
- health-monitor
- orchestration

**Estimated Effort**: Variable (1-4 hours each)

---

## Implementation Checklist

### Per-Module Checklist

For each module being standardized:

- [ ] **1. Create `interfaces/` folder**
  - [ ] Create `[feature].types.ts` - Extract contract types
  - [ ] Create `[feature].interfaces.ts` - Custom interfaces

- [ ] **2. Create `repositories/` folder** (if DB access)
  - [ ] Create `[feature].repository.ts`
  - [ ] Create `[feature].repository.spec.ts`
  - [ ] Move DB queries from services

- [ ] **3. Create `adapters/` folder**
  - [ ] Create `[feature]-adapter.service.ts`
  - [ ] Create `[feature]-adapter.service.spec.ts`
  - [ ] Implement contract transformations

- [ ] **4. Refactor `services/`**
  - [ ] Move DB access to repositories
  - [ ] Rename methods (generic, composable)
  - [ ] Return entities only (NOT contract types)
  - [ ] Remove HTTP exceptions

- [ ] **5. Update `controllers/`**
  - [ ] Inject adapter service
  - [ ] Orchestrate multiple service methods
  - [ ] Pass data to adapter
  - [ ] Return contract types via adapter

- [ ] **6. Update `[feature].module.ts`**
  - [ ] Add repository to providers
  - [ ] Add adapter to providers
  - [ ] Export services if needed

- [ ] **7. Create `index.ts`** (barrel exports)
  - [ ] Export public interfaces
  - [ ] Export public services

- [ ] **8. Write tests**
  - [ ] Repository tests (DB mocking)
  - [ ] Service tests (repository mocking)
  - [ ] Adapter tests (pure transformation)
  - [ ] Controller tests (orchestration)

- [ ] **9. Update documentation**
  - [ ] Add module to architecture docs
  - [ ] Document any special patterns

- [ ] **10. Verify**
  - [ ] TypeScript compiles
  - [ ] All tests pass
  - [ ] No circular dependencies
  - [ ] API endpoints work correctly

---

## Testing Strategy

### Layer-Specific Testing

#### Repository Tests
```typescript
describe('UserRepository', () => {
  let repository: UserRepository;
  let db: MockDatabaseService;

  beforeEach(() => {
    db = mockDatabaseService();
    repository = new UserRepository(db);
  });

  it('should find user by id', async () => {
    const mockUser = createMockUser();
    db.query.users.findFirst.mockResolvedValue(mockUser);

    const result = await repository.findById('123');

    expect(result).toEqual(mockUser);
    expect(db.query.users.findFirst).toHaveBeenCalledWith({
      where: expect.any(Function),
    });
  });
});
```

#### Service Tests
```typescript
describe('UserService', () => {
  let service: UserService;
  let repository: MockUserRepository;

  beforeEach(() => {
    repository = mockUserRepository();
    service = new UserService(repository);
  });

  it('should find user by id', async () => {
    const mockUser = createMockUser();
    repository.findById.mockResolvedValue(mockUser);

    const result = await service.findById('123');

    expect(result).toEqual(mockUser);
    expect(repository.findById).toHaveBeenCalledWith('123');
  });

  it('should throw if creating user with existing email', async () => {
    const existingUser = createMockUser();
    repository.findByEmail.mockResolvedValue(existingUser);

    await expect(
      service.createUser({ email: 'test@example.com', ... })
    ).rejects.toThrow(ConflictException);
  });
});
```

#### Adapter Tests
```typescript
describe('UserAdapter', () => {
  let adapter: UserAdapter;

  beforeEach(() => {
    adapter = new UserAdapter();
  });

  it('should adapt user to contract', () => {
    const user = createMockUser();
    const result = adapter.adaptUserToContract(user);

    expect(result).toEqual({
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  });

  it('should adapt user with stats', () => {
    const user = createMockUser();
    const stats = { projectCount: 5, deploymentCount: 10 };
    
    const result = adapter.adaptUserWithStatsToContract(user, stats);

    expect(result).toEqual({
      id: user.id,
      name: user.name,
      email: user.email,
      projectCount: 5,
      deploymentCount: 10,
    });
  });
});
```

#### Controller Tests
```typescript
describe('UserController', () => {
  let controller: UserController;
  let service: MockUserService;
  let adapter: MockUserAdapter;

  beforeEach(() => {
    service = mockUserService();
    adapter = mockUserAdapter();
    controller = new UserController(service, adapter);
  });

  it('should get user by id', async () => {
    const mockUser = createMockUser();
    const mockContract = createMockUserContract();
    
    service.findById.mockResolvedValue(mockUser);
    adapter.adaptUserToContract.mockReturnValue(mockContract);

    const result = await controller.getById({ id: '123' });

    expect(service.findById).toHaveBeenCalledWith('123');
    expect(adapter.adaptUserToContract).toHaveBeenCalledWith(mockUser);
    expect(result).toEqual(mockContract);
  });

  it('should orchestrate multiple service methods', async () => {
    const mockUser = createMockUser();
    const mockStats = { projectCount: 5, deploymentCount: 10 };
    const mockContract = createMockUserWithStatsContract();
    
    service.findById.mockResolvedValue(mockUser);
    service.getStats.mockResolvedValue(mockStats);
    adapter.adaptUserWithStatsToContract.mockReturnValue(mockContract);

    const result = await controller.getWithStats({ id: '123' });

    expect(service.findById).toHaveBeenCalledWith('123');
    expect(service.getStats).toHaveBeenCalledWith('123');
    expect(adapter.adaptUserWithStatsToContract).toHaveBeenCalledWith(
      mockUser,
      mockStats
    );
    expect(result).toEqual(mockContract);
  });
});
```

---

## Migration Guidelines

### Step-by-Step Migration Process

#### Step 1: Analyze Current Module

1. List all existing files and folders
2. Identify data access code (DB queries)
3. Identify business logic
4. Identify contract transformations
5. List all types/interfaces used

#### Step 2: Create New Structure

1. Create missing folders:
   ```bash
   mkdir -p interfaces adapters repositories services controllers
   ```

2. Create placeholder files:
   ```bash
   touch interfaces/[feature].types.ts
   touch interfaces/[feature].interfaces.ts
   touch repositories/[feature].repository.ts
   touch adapters/[feature]-adapter.service.ts
   ```

#### Step 3: Extract Types

1. Open contract file in `packages/api-contracts`
2. Extract output types to `interfaces/[feature].types.ts`
3. Define DTOs in `interfaces/[feature].interfaces.ts`

**Example**:
```typescript
// interfaces/user.types.ts
import { userContract } from '@repo/api-contracts';

export type UserContract = typeof userContract.getById.output;
export type UserListContract = typeof userContract.list.output;

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
}
```

#### Step 4: Create Repository

1. Identify all DB queries in service
2. Move to repository
3. Ensure methods return entities

**Example**:
```typescript
// repositories/user.repository.ts
@Injectable()
export class UserRepository {
  constructor(private db: DatabaseService) {}

  async findById(id: string): Promise<User | null> {
    return this.db.query.users.findFirst({ where: eq(users.id, id) });
  }
}
```

#### Step 5: Refactor Service

1. Inject repository
2. Remove DB access code
3. Rename methods (generic names)
4. Return entities only

**Before**:
```typescript
async getUserById(id: string) {
  const user = await this.db.query.users.findFirst(...);
  return { id: user.id, name: user.name }; // Contract type
}
```

**After**:
```typescript
async findById(id: string): Promise<User | null> {
  return this.userRepository.findById(id);
}
```

#### Step 6: Create Adapter

1. Import contract types from interfaces
2. Create transformation methods
3. Ensure fixed return types

**Example**:
```typescript
// adapters/user-adapter.service.ts
import { UserContract } from '../interfaces/user.types';

@Injectable()
export class UserAdapter {
  adaptUserToContract(user: User): UserContract {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
    };
  }
}
```

#### Step 7: Update Controller

1. Inject adapter
2. Call service methods
3. Pass data to adapter
4. Return contract types

**Before**:
```typescript
async getById(input: { id: string }) {
  return this.userService.getUserById(input.id);
}
```

**After**:
```typescript
async getById(input: { id: string }) {
  const user = await this.userService.findById(input.id);
  if (!user) throw new NotFoundException('User not found');
  return this.userAdapter.adaptUserToContract(user);
}
```

#### Step 8: Update Module

1. Add repository to providers
2. Add adapter to providers
3. Export services if needed

**Example**:
```typescript
@Module({
  imports: [DatabaseModule],
  controllers: [UserController],
  providers: [
    UserRepository,  // ← ADD
    UserService,
    UserAdapter,     // ← ADD
  ],
  exports: [UserService, UserRepository],
})
export class UserModule {}
```

#### Step 9: Write Tests

1. Write repository tests (mock DB)
2. Write service tests (mock repository)
3. Write adapter tests (pure transformations)
4. Write controller tests (mock service + adapter)

#### Step 10: Verify

1. Run TypeScript compilation: `bun run build`
2. Run tests: `bun run test`
3. Test API endpoints manually
4. Check for circular dependencies

---

## Common Pitfalls to Avoid

### 1. Adapter Calling Services

❌ **DON'T**:
```typescript
@Injectable()
export class UserAdapter {
  constructor(private userService: UserService) {} // ❌ Service dependency

  async adaptUserToContract(id: string): Promise<UserContract> {
    const user = await this.userService.findById(id); // ❌ Service call
    return { id: user.id, ... };
  }
}
```

✅ **DO**:
```typescript
@Injectable()
export class UserAdapter {
  // NO dependencies

  adaptUserToContract(user: User): UserContract {
    return { id: user.id, ... };
  }
}
```

### 2. Service Returning Contract Types

❌ **DON'T**:
```typescript
async getUserById(id: string): Promise<UserContract> {
  const user = await this.repository.findById(id);
  return { id: user.id, name: user.name }; // Contract type
}
```

✅ **DO**:
```typescript
async findById(id: string): Promise<User | null> {
  return this.repository.findById(id); // Entity
}
```

### 3. Controller Just Delegating

❌ **DON'T**:
```typescript
async getById(input: { id: string }) {
  return this.userService.getUserById(input.id); // Just delegates
}
```

✅ **DO**:
```typescript
async getById(input: { id: string }) {
  const user = await this.userService.findById(input.id); // Orchestrate
  if (!user) throw new NotFoundException('User not found');
  return this.userAdapter.adaptUserToContract(user); // Transform
}
```

### 4. Types Scattered Everywhere

❌ **DON'T**:
```typescript
// In controller
type UserResponse = { id: string; name: string };

// In service
interface CreateInput { name: string }

// In adapter
type UserContract = { id: string; ... }
```

✅ **DO**:
```typescript
// All in interfaces/user.types.ts
export type UserContract = typeof userContract.getById.output;
export interface CreateUserInput { name: string }
```

---

## Next Steps

1. **Review this plan** with the team
2. **Prioritize modules** based on business impact
3. **Assign tasks** to developers
4. **Track progress** in a project board
5. **Update documentation** as modules are standardized

---

## References

- [Service-Adapter Pattern Documentation](../concepts/SERVICE-ADAPTER-PATTERN.md)
- [Core vs Feature Architecture](../architecture/CORE-VS-FEATURE-ARCHITECTURE.md)
- [Core Module Architecture](../architecture/CORE-MODULE-ARCHITECTURE.md)
- [Development Workflow](../guides/DEVELOPMENT-WORKFLOW.md)

---

**Status**: 📋 Ready for implementation
**Estimated Total Effort**: 30-50 hours (for high + medium priority modules)
**Recommended Timeline**: 1-2 weeks with 2-3 developers
