# Module Structure Checklist

> **Quick Reference**: Checklist for creating or standardizing API modules

---

## Required Folder Structure

```
apps/api/src/modules/[feature]/
├── adapters/              ✅ REQUIRED
├── controllers/           ✅ REQUIRED
├── interfaces/            ✅ REQUIRED
├── repositories/          ✅ REQUIRED (if DB access)
├── services/              ✅ REQUIRED
├── processors/            ⚠️ OPTIONAL (if async work)
├── guards/                ⚠️ OPTIONAL (if special auth)
├── decorators/            ⚠️ OPTIONAL (if custom decorators)
├── [feature].module.ts    ✅ REQUIRED
└── index.ts               ✅ REQUIRED
```

---

## File Naming Conventions

| Layer | File Pattern | Example |
|-------|-------------|---------|
| **Repository** | `[feature].repository.ts` | `user.repository.ts` |
| **Service** | `[feature].service.ts` | `user.service.ts` |
| **Adapter** | `[feature]-adapter.service.ts` | `user-adapter.service.ts` |
| **Controller** | `[feature].controller.ts` | `user.controller.ts` |
| **Types** | `[feature].types.ts` | `user.types.ts` |
| **Interfaces** | `[feature].interfaces.ts` | `user.interfaces.ts` |
| **Module** | `[feature].module.ts` | `user.module.ts` |
| **Processor** | `[feature].processor.ts` | `deployment.processor.ts` |
| **Guard** | `[feature].guard.ts` | `admin.guard.ts` |
| **Decorator** | `[feature].decorator.ts` | `roles.decorator.ts` |

---

## Layer Responsibilities Quick Reference

### 🗄️ Repository Layer

**Purpose**: Database access

```typescript
@Injectable()
export class UserRepository {
  constructor(private db: DatabaseService) {}
  
  // ✅ DO: Return entities
  async findById(id: string): Promise<User | null> { ... }
  
  // ❌ DON'T: Business logic or contract types
}
```

**Rules**:
- ✅ Execute DB queries
- ✅ Return entities
- ❌ NO business logic
- ❌ NO contract types

---

### 🔧 Service Layer

**Purpose**: Business logic

```typescript
@Injectable()
export class UserService {
  constructor(private repository: UserRepository) {}
  
  // ✅ DO: Generic, composable methods
  async findById(id: string): Promise<User | null> { ... }
  async getStats(id: string): Promise<UserStats> { ... }
  
  // ❌ DON'T: Endpoint-specific names
  // ❌ async getUserById(id: string): Promise<UserContract> { ... }
}
```

**Rules**:
- ✅ Business logic & validations
- ✅ Call repositories
- ✅ Return entities
- ✅ Generic method names (`findById`, not `getUserById`)
- ❌ NO contract types
- ❌ NO HTTP exceptions
- ❌ NO direct DB access

---

### 🔄 Adapter Layer

**Purpose**: Contract transformation

```typescript
import { UserContract } from '../interfaces/user.types';

@Injectable()
export class UserAdapter {
  // ✅ DO: Fixed return types, data as parameters
  adaptUserToContract(user: User): UserContract {
    return { id: user.id, name: user.name, ... };
  }
  
  // ❌ DON'T: Service dependencies or async calls
}
```

**Rules**:
- ✅ Return EXACT contract types
- ✅ Receive data as parameters
- ✅ Pure transformations
- ❌ NO service dependencies
- ❌ NO async operations
- ❌ NO service calls

---

### 📝 Interfaces Layer

**Purpose**: Type definitions

```typescript
// interfaces/user.types.ts
import { userContract } from '@repo/api-contracts';

// ✅ DO: Extract contract types
export type UserContract = typeof userContract.getById.output;

// ✅ DO: Define DTOs
export interface CreateUserInput {
  name: string;
  email: string;
}
```

**Rules**:
- ✅ Extract contract types
- ✅ Define DTOs
- ✅ Define custom interfaces
- ❌ NO implementation code

---

### 🎮 Controller Layer

**Purpose**: HTTP endpoints

```typescript
@Controller()
export class UserController {
  constructor(
    private service: UserService,
    private adapter: UserAdapter,
  ) {}
  
  @Implement(contract.getById)
  async getById(input: { id: string }) {
    // ✅ DO: Orchestrate multiple service methods
    const user = await this.service.findById(input.id);
    if (!user) throw new NotFoundException('User not found');
    
    // ✅ DO: Pass data to adapter
    return this.adapter.adaptUserToContract(user);
  }
}
```

**Rules**:
- ✅ Orchestrate service calls
- ✅ Aggregate data
- ✅ Pass data to adapters
- ✅ Return contract types
- ❌ NO business logic
- ❌ NO direct repository access

---

## Module Configuration Template

```typescript
// [feature].module.ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/core/modules/database/database.module';

// Controllers
import { UserController } from './controllers/user.controller';

// Services
import { UserService } from './services/user.service';

// Repositories
import { UserRepository } from './repositories/user.repository';

// Adapters
import { UserAdapter } from './adapters/user-adapter.service';

@Module({
  imports: [DatabaseModule], // Import dependencies
  controllers: [UserController],
  providers: [
    UserRepository,  // ← Repository
    UserService,     // ← Service
    UserAdapter,     // ← Adapter
  ],
  exports: [
    UserService,     // Export if used by other modules
    UserRepository,  // Export if needed externally
  ],
})
export class UserModule {}
```

---

## Barrel Exports Template

```typescript
// index.ts
// Export public interfaces
export * from './interfaces/user.types';
export * from './interfaces/user.interfaces';

// Export services (if needed externally)
export * from './services/user.service';

// Export repositories (if needed externally)
export * from './repositories/user.repository';

// DO NOT export adapters (internal to module)
// DO NOT export controllers (NestJS handles this)
```

---

## Testing Checklist

### Per-Layer Testing

- [ ] **Repository Tests** (Mock DB)
  ```typescript
  it('should find user by id', async () => {
    db.query.users.findFirst.mockResolvedValue(mockUser);
    const result = await repository.findById('123');
    expect(result).toEqual(mockUser);
  });
  ```

- [ ] **Service Tests** (Mock Repository)
  ```typescript
  it('should find user by id', async () => {
    repository.findById.mockResolvedValue(mockUser);
    const result = await service.findById('123');
    expect(result).toEqual(mockUser);
  });
  ```

- [ ] **Adapter Tests** (Pure Transformation)
  ```typescript
  it('should adapt user to contract', () => {
    const result = adapter.adaptUserToContract(mockUser);
    expect(result).toEqual(mockContract);
  });
  ```

- [ ] **Controller Tests** (Mock Service + Adapter)
  ```typescript
  it('should orchestrate service and adapter', async () => {
    service.findById.mockResolvedValue(mockUser);
    adapter.adaptUserToContract.mockReturnValue(mockContract);
    const result = await controller.getById({ id: '123' });
    expect(result).toEqual(mockContract);
  });
  ```

---

## Common Anti-Patterns to Avoid

### ❌ Adapter Calling Services
```typescript
// ❌ DON'T
class UserAdapter {
  constructor(private service: UserService) {}
  async adaptUserToContract(id: string) {
    const user = await this.service.findById(id);
    return { ... };
  }
}

// ✅ DO
class UserAdapter {
  adaptUserToContract(user: User): UserContract {
    return { ... };
  }
}
```

### ❌ Service Returning Contract Types
```typescript
// ❌ DON'T
async getUserById(id: string): Promise<UserContract> {
  const user = await this.repository.findById(id);
  return { id: user.id, name: user.name };
}

// ✅ DO
async findById(id: string): Promise<User | null> {
  return this.repository.findById(id);
}
```

### ❌ Controller Just Delegating
```typescript
// ❌ DON'T
async getById(input: { id: string }) {
  return this.service.getUserById(input.id);
}

// ✅ DO
async getById(input: { id: string }) {
  const user = await this.service.findById(input.id);
  if (!user) throw new NotFoundException();
  return this.adapter.adaptUserToContract(user);
}
```

### ❌ Types Scattered Everywhere
```typescript
// ❌ DON'T: Types in controller, service, adapter

// ✅ DO: All types in interfaces/
// interfaces/user.types.ts
export type UserContract = typeof contract.getById.output;
export interface CreateUserInput { ... }
```

---

## Quick Validation Checklist

Before considering a module complete:

- [ ] All required folders exist (`adapters/`, `controllers/`, `interfaces/`, `repositories/`, `services/`)
- [ ] Contract types extracted to `interfaces/[feature].types.ts`
- [ ] Repository handles all DB access
- [ ] Service returns entities (NOT contract types)
- [ ] Service methods are generic/composable (NOT endpoint-specific)
- [ ] Adapter has fixed return types from contracts
- [ ] Adapter receives data as parameters (NO service calls)
- [ ] Controller orchestrates multiple service methods
- [ ] Controller uses adapter for transformations
- [ ] Module providers include repository, service, adapter
- [ ] All layers have tests
- [ ] TypeScript compiles without errors
- [ ] No circular dependencies

---

## References

- [Service-Adapter Pattern](../concepts/SERVICE-ADAPTER-PATTERN.md)
- [API Standardization Plan](../planning/API-STANDARDIZATION-PLAN.md)
- [Core vs Feature Architecture](../architecture/CORE-VS-FEATURE-ARCHITECTURE.md)
