# AI Coding Agent Instructions

This Next.js + NestJS turborepo uses modern patterns and conventions that require specific knowledge for effective development.

## 🎯 CRITICAL: Core Concepts System

**⚠️ THESE ARE THE ONLY SOURCE OF TRUTH - MUST BE FOLLOWED AT ALL TIMES**

**⚠️ YOU MUST FOLLOW THE WORKFLOW DIAGRAM IN `docs/core-concepts/COPILOT-WORKFLOW-DIAGRAM.md`**

### Mandatory Workflow

**BEFORE ANY TASK, you MUST follow the exact workflow defined in:**
- **[`docs/core-concepts/COPILOT-WORKFLOW-DIAGRAM.md`](../docs/core-concepts/COPILOT-WORKFLOW-DIAGRAM.md)** ← **READ THIS CHART AND FOLLOW IT EXACTLY**

The workflow diagram contains:
1. **Complete process flow** - Mermaid diagram showing every step
2. **Verification loops** - Quality checks you MUST perform
3. **Decision points** - When to loop back vs proceed
4. **Phase explanations** - Detailed instructions for each phase
5. **Success criteria** - How to know you've completed correctly
6. **Common pitfalls** - What NOT to do

**Key Workflow Requirements:**
- ✅ **Maintain documentation awareness** - Know what docs exist before starting
- ✅ **Load task-relevant documentation** - Read applicable core concepts and guides
- ✅ **Verify implementation quality** - Check code quality immediately after changes
- ✅ **Re-verify patterns** - Ensure no violations introduced by changes
- ✅ **Run pre-completion verification** - Final checks before showing results
- ✅ **Fix in loops** - Don't proceed with known issues
- ❌ **Never skip verification steps** - They prevent errors
- ❌ **Never assume quality** - Verify it

### Documentation Awareness and Selective Loading

**Before ANY task, you MUST understand what documentation is available:**

1. **Read [`docs/README.md`](../docs/README.md)** - Understand overall documentation structure
2. **Read [`docs/core-concepts/README.md`](../docs/core-concepts/README.md)** - Inventory all core concepts
3. **Identify relevant documentation** - Based on task type, determine which docs to load
4. **Load task-specific documentation** - Read only applicable core concepts, guides, and references

These concepts are **MANDATORY and NON-NEGOTIABLE** when they apply to your task. You cannot make informed decisions without understanding what documentation exists and loading the relevant context for your specific work.

**This is not about reading everything - it's about knowing what exists and loading what you need.**

### Core Concepts Rules

1. **Maintain Documentation Inventory**: Understand what docs exist via README files
2. **Load Task-Relevant Concepts**: Read applicable core concepts based on task type
3. **Check Before Creating**: When adding new core concepts, check existing files first
4. **Never Bypass Applicable Concepts**: Core concepts cannot be bypassed unless user explicitly overrides
5. **Request Approval for Conflicts**: If user request violates loaded core concept, request approval before proceeding

### When User Request Conflicts with Core Concept

**STOP and request approval:**

```
⚠️ Core concept conflict detected:

Your request: [describe request]
Violates: docs/core-concepts/[FILENAME].md

Core concept requires: [describe requirement]

Options:
1. Implement following core concept (recommended)
2. Update core concept (requires your approval and rationale)

Show proposed changes to core concept:
[Show what would change]

How would you like to proceed?
```

### Creating New Core Concepts

When you learn or are requested to create a new core concept:

1. **Check existing files** - Does another file already handle this?
2. **Update existing** if concept fits in an existing category
3. **Create new file** only if truly fundamental and new
4. **Split logically** - Organize into clear, focused files
5. **Update README.md** - Add to core concepts index
6. **Update this file** - Add reference in relevant section

**File naming**: `##-CONCEPT-NAME.md` (next sequential number)

## 📚 Documentation-First Development Workflow

**⚠️ SILENTLY READ DOCUMENTATION BEFORE IMPLEMENTATION**

**⚠️ FOLLOW THE COMPLETE WORKFLOW DIAGRAM: [`docs/core-concepts/COPILOT-WORKFLOW-DIAGRAM.md`](../docs/core-concepts/COPILOT-WORKFLOW-DIAGRAM.md)**

This is the **MOST IMPORTANT** rule for this project. You MUST follow this workflow for EVERY task:

The workflow diagram provides:
- Complete mermaid flowchart with ALL steps
- Verification loops you MUST execute
- Quality checks before showing results
- Decision points and loop conditions
- Success criteria and common pitfalls

**Workflow Summary (see diagram for complete flow):**
1. Maintain documentation awareness (Read docs/README.md and core-concepts/README.md)
2. Load task-relevant documentation (Select applicable core concepts and guides)
3. Read documentation (silent, parallel)
4. Verify context complete
5. Check conflicts with core concepts
6. Verify patterns before implementing
7. Implement changes
8. **NEW: Verify implementation quality**
9. **NEW: Re-verify patterns after changes**
10. **NEW: Run pre-completion verification**
11. Show results (only after verification passes)
12. Update documentation if needed
13. Validate links (MANDATORY)

### Step 1: Understand Available Documentation

**Before writing ANY code or making ANY changes, understand what documentation exists:**

1. **`docs/README.md`** - Documentation hub showing all available topics
2. **`docs/core-concepts/README.md`** - Index of all core concepts
3. **Identify task-relevant documentation** - Determine which docs apply to your current work
4. **Load selectively** - Read only the applicable core concepts, guides, architecture docs, and specifications

**Task-Based Documentation Loading:**

| Task Type | Load These Core Concepts | Also Consider |
|-----------|--------------------------|---------------|
| **API endpoint creation** | ORPC Implementation, Service-Adapter, Repository Ownership | `docs/guides/DEVELOPMENT-WORKFLOW.md` |
| **Frontend routing** | README-First Discovery, Documentation-First | `apps/web/src/routes/README.md` |
| **Database changes** | Service-Adapter, Repository Ownership | `docs/reference/DATABASE-ENCRYPTION.md` |
| **Authentication work** | Better Auth Integration, Service-Adapter | Auth architecture docs |
| **Documentation updates** | Documentation Maintenance Protocol, README-First | Relevant topic docs |
| **File operations** | File Management Policy | N/A |

**Read silently in parallel** - gather ALL needed context before implementation.

### Step 2: Load Task-Specific Documentation

**Based on your task, load ONLY relevant documentation:**

#### Always Check First (Documentation Inventory)

1. **`docs/README.md`** - Documentation hub and navigation
2. **`docs/core-concepts/README.md`** - Core concepts index

#### Load When Relevant to Task

**Core Concepts** (from `docs/core-concepts/`):
- Service-Adapter Pattern - For API controllers
- Repository Ownership Rule - For database operations
- Better Auth Integration - For authentication
- ORPC Implementation Pattern - For API contracts
- Documentation Maintenance Protocol - For doc changes
- File Management Policy - Before deleting files
- Efficient Execution Protocol - For all tasks
- README-First Discovery - For doc navigation

**Architecture Docs** (from `docs/architecture/`):
- Load when understanding system design or component relationships

**Guides** (from `docs/guides/`):
- Load when implementing specific features or workflows

**Specifications** (from `docs/specifications/`):
- Load when working with specific features (environment vars, deployment, etc.)

### Step 3: Workflow for Every Task

```
┌─────────────────────────────────────────────┐
│ 1. User Request Received                    │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│ 2. Silently Read ALL Required Context       │
│    - docs/README.md                         │
│    - Core concepts                          │
│    - Relevant features/specs                │
│    (NO announcements about reading)         │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│ 3. Verify Understanding Internally          │
│    - Correct pattern?                       │
│    - Correct folder structure?              │
│    - Dependencies clear?                    │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│ 4. Implement Immediately                    │
│    - Use exact patterns from docs           │
│    - No explanations for standard work      │
│    - Only explain critical decisions        │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│ 5. Show Completed Work                      │
│    - Present results                        │
│    - Update docs if needed                  │
└─────────────────────────────────────────────┘
```

### Examples: Documentation-First in Action

#### ❌ WRONG: Verbose Announcements

```
User: "Create a new user service"

I'll first read the SERVICE-ADAPTER-PATTERN.md to understand the pattern,
then check CORE-VS-FEATURE-ARCHITECTURE.md to determine module placement,
and finally implement the service following the documented patterns.
```

#### ✅ CORRECT: Silent Action

```
User: "Create a new user service"

[Silently reads: docs/README.md, SERVICE-ADAPTER-PATTERN.md, CORE-VS-FEATURE-ARCHITECTURE.md]
[Implements service following patterns]
[Shows completed implementation]
```

### When Documentation is Missing or Unclear

If you cannot find documentation for a specific pattern or feature:

1. **Search existing docs** silently using grep/search
2. **Batch all questions** to user in single request
3. **Document your decision** after implementing
4. **Update this file** if new concept

**NEVER** announce you're searching documentation - just do it.

### Documentation Loading Checklist

Internal verification (do not announce):

- [ ] Read `docs/README.md` (main documentation hub)
- [ ] Read `docs/core-concepts/README.md` (mandatory patterns)
- [ ] Navigate to relevant subdirectories via README structure
- [ ] Check subdirectory READMEs for specific topics
- [ ] Read individual files as needed for deep understanding
- [ ] Understand patterns for task
- [ ] Ready to implement

**If not ready, read more documentation silently.**

### Why This Matters

This project has **specific, non-standard patterns** that you cannot infer:

- ❌ You cannot guess that adapters go in `adapters/` (not `services/`)
- ❌ You cannot guess that types go in `interfaces/` (not inline)
- ❌ You cannot guess the service-adapter-controller orchestration pattern
- ❌ You cannot guess the core vs feature module rules
- ❌ You cannot guess the circular dependency handling approach

**These patterns are ONLY documented in `docs/`**. If you don't read the docs, you WILL implement incorrectly.

---

## Architecture Overview

**Monorepo Structure**: Turborepo with apps (`web/`, `api/`) and shared packages (`ui/`, `api-contracts/`, etc.)
- Frontend: Next.js 15.4 with App Router, React 19, Tailwind CSS, Shadcn UI
- Backend: NestJS with ORPC, Drizzle ORM, Better Auth, PostgreSQL
- Type Safety: End-to-end with shared contracts and declarative routing

## Critical Development Patterns

### 0. File Management Policy
**⚠️ NEVER delete or remove files without explicit user permission**

> See `docs/core-concepts/README.md` for all core concepts (MANDATORY reading)

### 1. Better Auth Integration Pattern (CRITICAL)
**⚠️ ALL auth-related operations MUST use AuthService.api**

> See `docs/core-concepts/README.md` for all core concepts (MANDATORY reading)

### 2. Core Module Shared Logic Pattern
**⚠️ Reusable business logic belongs in Core Modules**

> See `docs/core-concepts/README.md` for all core concepts (MANDATORY reading)

### 3. TypeScript Type Manipulation Pattern
**⚠️ Prefer type inference over manual type definitions**

> See `docs/core-concepts/README.md` for all core concepts (MANDATORY reading)

### 4. Docker-First Development
**Always use Docker commands for development:**
```bash
bun run dev              # Full stack (API + Web + DB + Redis)
bun run dev:api          # API only with database
bun run dev:web          # Web only (requires running API)
```
Never run `next dev` or `nest start` directly - services are containerized with proper networking.

### 5. Declarative Routing System
**Routes are type-safe and generated**, not manually written:
- Route definitions: `apps/web/src/app/**/page.info.ts`
- Generate routes: `bun run web -- dr:build` (required after route changes)
- Usage: `import { Home, ApiAuth } from '@/routes'` then `<Home.Link>` or `ApiAuth.fetch()`
- **Never** use raw `href` strings or manual `fetch()` calls

### 6. API Contracts with ORPC
**Shared type-safe contracts between frontend/backend:**
- Contracts: `packages/api-contracts/index.ts`
- API implementation: `apps/api/src/` using ORPC decorators
- Client usage: Generated hooks via `@orpc/tanstack-query`
- Changes require rebuilding web app: `bun run web -- generate`

### 7. Better Auth Development Workflow
**Plugin addition and auth generation:**
```bash
# When adding new Better Auth plugins
bun run --cwd apps/api auth:generate    # Generate auth configuration
```

### 8. API Development Workflow
**Creating new API endpoints (REQUIRED ORDER):**

1. **Generate Contract** (First Step):
   ```bash
   # Edit packages/api-contracts/index.ts
   # Add new ORPC procedure definitions
   ```

2. **Create NestJS Implementation** (Required Order):
   ```bash
   # 1. Create Repository (Database access layer)
   # 2. Create Service (Business logic layer)  
   # 3. Create Controller (HTTP endpoint layer)
   ```

**Standard API Development Process**:
```typescript
// 1. Define contract in packages/api-contracts/index.ts
export const userRouter = {
  getUsers: procedure.query()
  createUser: procedure.input(z.object({...})).mutation()
}

// 2. Create Repository (apps/api/src/modules/user/repositories/)
@Injectable()
export class UserRepository {
  // Database operations
}

// 3. Create Service (apps/api/src/modules/user/services/)
@Injectable() 
export class UserService {
  constructor(private userRepository: UserRepository) {}
  // Business logic
}

// 4. Create Controller (apps/api/src/modules/user/controllers/)
@Controller()
export class UserController {
  constructor(private userService: UserService) {}
  // HTTP endpoints
}
```
**Internal packages use workspace references:**
```json
"@repo/ui": "*"           // Not published packages
"@repo/api-contracts": "*" // Shared between apps
```
Import like: `import { Button } from '@repo/ui'`

### 8.5. ORPC Controller Implementation Pattern

**⚠️ This project uses ORPC for type-safe API contracts, NOT traditional REST decorators**

#### ORPC vs Traditional REST Decorators

**❌ WRONG - Traditional NestJS REST Decorators:**
```typescript
@Controller('users')
export class UserController {
  @Get(':id')
  async getUserById(@Param('id') id: string) {
    // Traditional REST approach - NOT USED in this project
  }
  
  @Post()
  async createUser(@Body() dto: CreateUserDto) {
    // Traditional REST approach - NOT USED in this project
  }
}
```

**✅ CORRECT - ORPC Implementation:**
```typescript
import { Controller } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { userContract } from '@repo/api-contracts';
import { UserService } from '../services/user.service';
import { UserAdapter } from '../adapters/user-adapter.service';

@Controller()
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly userAdapter: UserAdapter,
  ) {}
  
  @Implement(userContract.getById)
  getById() {
    return implement(userContract.getById).handler(async ({ input }) => {
      const user = await this.userService.findById(input.id);
      if (!user) {
        throw new NotFoundException('User not found');
      }
      return this.userAdapter.adaptUserToContract(user);
    });
  }
  
  @Implement(userContract.create)
  create() {
    return implement(userContract.create).handler(async ({ input }) => {
      const user = await this.userService.create(input);
      return this.userAdapter.adaptUserToContract(user);
    });
  }
}
```

#### ORPC Implementation Components

**1. Contract Definition** (in `packages/api-contracts/index.ts`):
```typescript
import { procedure, router } from '@orpc/server';
import { z } from 'zod';

export const userContract = router({
  getById: procedure
    .input(z.object({ id: z.string() }))
    .output(z.object({ 
      id: z.string(), 
      email: z.string(), 
      name: z.string() 
    }))
    .query(),
    
  create: procedure
    .input(z.object({ 
      email: z.string().email(), 
      name: z.string() 
    }))
    .output(z.object({ 
      id: z.string(), 
      email: z.string(), 
      name: z.string() 
    }))
    .mutation(),
});
```

**2. Controller Implementation** (in `apps/api/src/modules/user/controllers/`):
```typescript
import { Controller } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { userContract } from '@repo/api-contracts';
import { UserService } from '../services/user.service';
import { UserAdapter } from '../adapters/user-adapter.service';

@Controller()
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly userAdapter: UserAdapter,
  ) {}
  
  @Implement(userContract.getById)
  getById() {
    return implement(userContract.getById).handler(async ({ input }) => {
      // 1. Call service for business logic
      const user = await this.userService.findById(input.id);
      
      // 2. Transform via adapter
      return this.userAdapter.adaptUserToContract(user);
    });
  }
}
```

#### Session Handling in ORPC

ORPC endpoints can access session data via the `@Session()` decorator:

```typescript
import { Controller } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { Session } from '@/core/modules/auth/decorators/decorators';
import type { UserSession } from '@/core/modules/auth/guards/auth.guard';
import { projectContract } from '@repo/api-contracts';

@Controller()
export class ProjectController {
  constructor(
    private readonly projectService: ProjectService,
    private readonly projectAdapter: ProjectAdapter,
  ) {}
  
  @Implement(projectContract.create)
  create(@Session() session?: UserSession) {
    return implement(projectContract.create).handler(async ({ input }) => {
      // Session contains user information if authenticated
      const userId = session?.user?.id;
      
      const project = await this.projectService.create({
        ...input,
        userId,
      });
      
      return this.projectAdapter.adaptProjectToContract(project);
    });
  }
}
```

**Session Type Definition:**
```typescript
export type UserSession = {
  user: {
    id: string;
    email: string;
    name: string;
  };
  session: {
    id: string;
    expiresAt: Date;
  };
};
```

#### ORPC Input Validation

ORPC provides automatic input validation using Zod schemas:

```typescript
// Contract with validation
export const projectContract = router({
  create: procedure
    .input(z.object({
      name: z.string().min(1).max(100),
      description: z.string().optional(),
      repositoryUrl: z.string().url(),
    }))
    .output(z.object({ 
      id: z.string(),
      name: z.string(),
      // ... output schema
    }))
    .mutation(),
});

// Controller automatically validates input
@Implement(projectContract.create)
create() {
  return implement(projectContract.create).handler(async ({ input }) => {
    // Input is already validated by ORPC
    // TypeScript knows exact shape of input
    // No manual validation needed
  });
}
```

#### Contract-First Development Workflow

1. **Define Contract** in `packages/api-contracts/index.ts`:
   - Specify input schema (Zod)
   - Specify output schema (Zod)
   - Choose `.query()` (GET-like) or `.mutation()` (POST-like)

2. **Generate Types** (automatic):
   - Frontend gets typed hooks: `useQuery(orpc.userContract.getById.queryOptions())`
   - Backend gets typed input/output

3. **Implement Controller**:
   - Use `@Implement(contract)` decorator
   - Use `implement(contract).handler()` for implementation
   - Follow Service-Adapter pattern

4. **Benefits**:
   - End-to-end type safety (frontend to backend)
   - Automatic input validation
   - Self-documenting API contracts
   - No manual API client code needed
   - Refactoring safety (contract changes break compilation)

#### ORPC Best Practices

**DO:**
- ✅ Always use `@Implement(contract)` decorator
- ✅ Always use `implement(contract).handler()` for implementation
- ✅ Follow Service-Adapter pattern (service → adapter → return)
- ✅ Define comprehensive input/output schemas in contracts
- ✅ Use `@Session()` decorator for authentication
- ✅ Return contract-typed objects (adapter handles transformation)

**DON'T:**
- ❌ Never use `@Get()`, `@Post()`, `@Put()`, `@Delete()` REST decorators
- ❌ Never bypass ORPC contracts with manual routes
- ❌ Never skip adapter transformation (always return contract type)
- ❌ Never access DatabaseService in controllers (use service layer)
- ❌ Never manually validate input (ORPC handles via Zod schemas)

#### Complete ORPC Endpoint Example

```typescript
// 1. Contract (packages/api-contracts/index.ts)
export const projectContract = router({
  update: procedure
    .input(z.object({
      id: z.string(),
      name: z.string().min(1).max(100),
      description: z.string().optional(),
    }))
    .output(z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      updatedAt: z.string(),
    }))
    .mutation(),
});

// 2. Service (apps/api/src/modules/project/services/project.service.ts)
@Injectable()
export class ProjectService {
  constructor(private projectRepository: ProjectRepository) {}
  
  async update(id: string, data: { name: string; description?: string }) {
    return this.projectRepository.update(id, data);
  }
}

// 3. Adapter (apps/api/src/modules/project/adapters/project-adapter.service.ts)
@Injectable()
export class ProjectAdapter {
  adaptProjectToContract(project: Project): ProjectContract {
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      updatedAt: project.updatedAt.toISOString(),
    };
  }
}

// 4. Controller (apps/api/src/modules/project/controllers/project.controller.ts)
import { Controller } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { projectContract } from '@repo/api-contracts';
import { Session } from '@/core/modules/auth/decorators/decorators';
import type { UserSession } from '@/core/modules/auth/guards/auth.guard';

@Controller()
export class ProjectController {
  constructor(
    private readonly projectService: ProjectService,
    private readonly projectAdapter: ProjectAdapter,
  ) {}
  
  @Implement(projectContract.update)
  update(@Session() session?: UserSession) {
    return implement(projectContract.update).handler(async ({ input }) => {
      // Input is validated by ORPC (name, description, id)
      const project = await this.projectService.update(input.id, {
        name: input.name,
        description: input.description,
      });
      
      // Adapter transforms entity → contract
      return this.projectAdapter.adaptProjectToContract(project);
    });
  }
}

// 5. Frontend Usage (automatic, type-safe)
import { orpc } from '@/lib/api';

function UpdateProjectForm({ projectId }: { projectId: string }) {
  const mutation = orpc.projectContract.update.useMutation();
  
  const handleSubmit = (data: { name: string; description?: string }) => {
    mutation.mutate({
      id: projectId,
      name: data.name,
      description: data.description,
    });
  };
  
  // mutation.data is typed as ProjectContract
  // mutation.isPending, mutation.error available
}
```

### 9. Service-Adapter Pattern Enforcement (CRITICAL)

**⚠️ Controllers MUST NEVER access DatabaseService directly**

> See `docs/core-concepts/README.md` for all core concepts (MANDATORY reading)

### 10. Shared Package System

#### The Three-Layer Architecture

```typescript
┌─────────────────────────────────────────────────────────┐
│                      Controller Layer                    │
│  • Handles HTTP requests (ORPC endpoints)               │
│  • Orchestrates service calls                           │
│  • Transforms responses via adapters                    │
│  • NEVER accesses database directly                     │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│                      Service Layer                       │
│  • Contains business logic                              │
│  • Calls repository methods                             │
│  • Returns entities (NOT contracts)                     │
│  • Validates business rules                             │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│                    Repository Layer                      │
│  • Direct database access (Drizzle ORM)                 │
│  • CRUD operations                                      │
│  • Query building                                       │
│  • Returns database entities                            │
└─────────────────────────────────────────────────────────┘
```

#### Adapter Transformation Pattern

```typescript
┌─────────────────────────────────────────────────────────┐
│                    Adapter Layer                         │
│  • Transforms entities → contracts                      │
│  • Located in adapters/ folder                          │
│  • Fixed contract type definitions                      │
│  • NO business logic here                               │
└─────────────────────────────────────────────────────────┘
```

#### WRONG Implementation (❌ NEVER DO THIS)

```typescript
import { Controller } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { projectContract } from '@repo/api-contracts';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import { projects } from '@/db/drizzle/schema';
import { eq } from 'drizzle-orm';

// ❌ BAD - Controller directly accessing DatabaseService
@Controller()
export class ProjectController {
  constructor(
    private databaseService: DatabaseService, // ❌ WRONG!
    private projectService: ProjectService,
  ) {}

  @Implement(projectContract.list)
  list() {
    return implement(projectContract.list).handler(async ({ input }) => {
      const db = this.databaseService.db;
      
      // ❌ Direct database access in controller
      const projectList = await db
        .select()
        .from(projects)
        .where(eq(projects.userId, input.userId))
        .execute();

      // ❌ Transformation logic in controller
      return projectList.map(p => ({
        id: p.id,
        name: p.name,
        // ... transformation logic
      }));
    });
  }
}
```

**Problems with this approach:**
- Business logic bypassed (service layer unused)
- Transformation duplicated across methods
- Cannot unit test without database
- Violates separation of concerns
- Makes refactoring extremely difficult

#### CORRECT Implementation (✅ ALWAYS DO THIS)

```typescript
import { Controller } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { projectContract } from '@repo/api-contracts';

// ✅ GOOD - Controller uses Service-Adapter pattern
@Controller()
export class ProjectController {
  constructor(
    private readonly projectService: ProjectService,   // ✅ Service for business logic
    private readonly projectAdapter: ProjectAdapter,   // ✅ Adapter for transformations
  ) {}

  @Implement(projectContract.list)
  list() {
    return implement(projectContract.list).handler(async ({ input }) => {
      // 1. Call service for business logic
      const result = await this.projectService.findMany({
        userId: input.userId,
        search: input.search,
        limit: input.limit,
        offset: input.offset,
      });

      // 2. Use adapter to transform to contract
      return this.projectAdapter.adaptProjectListToContract(
        result.projects,
        result.total,
        input.limit,
        input.offset,
      );
    });
  }
}
```

**Benefits of this approach:**
- Business logic centralized in service
- Transformations reusable via adapter
- Easy to unit test (mock service/adapter)
- Clear separation of concerns
- Consistent pattern across codebase

#### Repository Layer Implementation

```typescript
// apps/api/src/modules/project/repositories/project.repository.ts
@Injectable()
export class ProjectRepository {
  constructor(private databaseService: DatabaseService) {}

  async findMany(filters: {
    userId?: string;
    search?: string;
    limit: number;
    offset: number;
  }): Promise<Project[]> {
    const db = this.databaseService.db;
    
    let query = db
      .select()
      .from(projects)
      .limit(filters.limit)
      .offset(filters.offset);

    if (filters.userId) {
      query = query.where(eq(projects.userId, filters.userId));
    }

    if (filters.search) {
      query = query.where(ilike(projects.name, `%${filters.search}%`));
    }

    return query.execute();
  }

  async findById(id: string): Promise<Project | null> {
    const db = this.databaseService.db;
    const result = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1)
      .execute();
    
    return result[0] || null;
  }

  // ... more CRUD methods
}
```

**Repository Rules:**
- ONLY layer that injects `DatabaseService`
- Contains ONLY database queries (no business logic)
- Returns raw database entities
- Uses Drizzle ORM type inference (`$inferSelect`, `$inferInsert`)

#### Service Layer Implementation

```typescript
// apps/api/src/modules/project/services/project.service.ts
@Injectable()
export class ProjectService {
  constructor(private projectRepository: ProjectRepository) {}

  async findMany(filters: {
    userId?: string;
    search?: string;
    limit: number;
    offset: number;
  }) {
    // Business logic validation
    if (filters.limit > 100) {
      throw new BadRequestException('Limit cannot exceed 100');
    }

    // Call repository
    const projects = await this.projectRepository.findMany(filters);
    
    // Business logic: filter archived projects
    return projects.filter(p => !p.isArchived);
  }

  async findById(id: string): Promise<Project | null> {
    const project = await this.projectRepository.findById(id);
    
    if (!project) {
      return null;
    }

    // Business logic: check access permissions
    if (project.isDeleted) {
      throw new NotFoundException('Project not found');
    }

    return project;
  }

  // ... more business logic methods
}
```

**Service Rules:**
- Contains ALL business logic
- Calls repository methods (never DatabaseService)
- Returns entities (NOT contracts)
- Validates business rules
- Throws business exceptions

#### Repository Ownership Rule (CRITICAL)

**⚠️ REPOSITORIES ARE OWNED BY THEIR DOMAIN SERVICE**

> See `docs/core-concepts/README.md` for all core concepts (MANDATORY reading)

**The Rule:**
```
Service A → Service B → Repository B
NOT: Service A → Repository B
```

#### Adapter Layer Implementation

```typescript
// apps/api/src/modules/project/adapters/project-adapter.service.ts
@Injectable()
export class ProjectAdapter {
  adaptProjectToContract(project: Project): ProjectContract {
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      // ... more transformations
    };
  }

  adaptProjectListToContract(
    projects: Project[],
    limit: number,
    offset: number,
  ): ProjectListContract {
    return {
      items: projects.map(p => this.adaptProjectToContract(p)),
      pagination: {
        limit,
        offset,
        total: projects.length,
      },
    };
  }

  adaptEnvironmentToContract(env: Environment): EnvironmentContract {
    return {
      id: env.id,
      name: env.name,
      type: env.type,
      // ... transformation logic
    };
  }

  // ... more transformation methods
}
```

**Adapter Rules:**
- Located in `adapters/` folder
- Contains ONLY transformation logic (entities → contracts)
- NO business logic allowed
- Reusable across multiple controller methods
- Fixed contract types from `@repo/api-contracts`
- **Type-safe parameters**: NEVER use `any` type for method parameters
  - Use explicit entity types from Drizzle schema (`typeof schema.$inferSelect`)
  - Use typed arrays for collections (`Entity[]`, not `any[]`)
  - Use proper TypeScript types for all parameters
  - Exception: `any` only allowed when technically required (e.g., truly dynamic data)

#### Controller Module Location Rules

**Core vs Feature Module Architecture:**

```typescript
// ❌ WRONG - ServiceController in project module
apps/api/src/modules/project/
├── controllers/
│   ├── project.controller.ts   ✅ Correct (project domain)
│   └── service.controller.ts   ❌ WRONG (service domain)

// ✅ CORRECT - ServiceController in service module
apps/api/src/modules/project/
├── controllers/
│   └── project.controller.ts   ✅ Correct

apps/api/src/modules/service/
├── controllers/
│   └── service.controller.ts   ✅ Correct
```

**Module Location Rules:**
- Controllers belong in their DOMAIN module (not related entity modules)
- `ServiceController` handles service endpoints → goes in `modules/service/`
- `ProjectController` handles project endpoints → goes in `modules/project/`
- Follow aggregate root pattern for module organization

#### Refactoring Checklist for Controllers

When fixing a controller that violates the Service-Adapter pattern:

1. **Remove DatabaseService Injection** ✅
   ```typescript
   // Remove this from constructor
   private databaseService: DatabaseService, // ❌ DELETE
   ```

2. **Add Adapter Injection** ✅
   ```typescript
   // Add this to constructor
   private projectAdapter: ProjectAdapter, // ✅ ADD
   ```

3. **Remove Direct Schema Imports** ✅
   ```typescript
   // Remove these imports
   import { projects, environments, users } from '@/db/drizzle/schema'; // ❌ DELETE
   import { eq, desc, count, ilike, and } from 'drizzle-orm'; // ❌ DELETE
   ```

4. **Remove Duplicate Transformation Methods** ✅
   ```typescript
   // Delete private transformation methods if they exist in adapter
   private transformEnvironmentToContract() { ... } // ❌ DELETE (use adapter)
   private transformUserToContract() { ... }        // ❌ DELETE (use adapter)
   ```

5. **Check Service Has Required Methods** ✅
   ```typescript
   // Verify service has methods for all controller operations
   // If missing, add them to service first
   async findMany(filters) { ... }
   async findById(id) { ... }
   async create(data) { ... }
   // ... etc
   ```

6. **Refactor Each Endpoint** ✅
   ```typescript
   // BEFORE (❌ WRONG)
   async getProject(id: string) {
     const db = this.databaseService.db;
     const project = await db.select().from(projects).where(eq(projects.id, id));
     return { id: project.id, name: project.name };
   }

   // AFTER (✅ CORRECT)
   async getProject(id: string) {
     const project = await this.projectService.findById(id);
     return this.projectAdapter.adaptProjectToContract(project);
   }
   ```

7. **Update Module Providers** ✅
   ```typescript
   // Ensure module has all required providers
   @Module({
     imports: [CoreModule],
     controllers: [ProjectController],
     providers: [
       ProjectService,      // ✅ Service
       ProjectRepository,   // ✅ Repository
       ProjectAdapter,      // ✅ Adapter
     ],
   })
   export class ProjectModule {}
   ```

#### Common Refactoring Patterns

**Pattern 1: Simple CRUD Operation**
```typescript
// ❌ BEFORE
@Implement(projectContract.getById)
getById() {
  return implement(projectContract.getById).handler(async ({ input }) => {
    const db = this.databaseService.db;
    const result = await db.select().from(projects).where(eq(projects.id, input.id));
    return result[0];
  });
}

// ✅ AFTER
@Implement(projectContract.getById)
getById() {
  return implement(projectContract.getById).handler(async ({ input }) => {
    const entity = await this.projectService.findById(input.id);
    return this.projectAdapter.adaptToContract(entity);
  });
}
```

**Pattern 2: List with Pagination**
```typescript
// ❌ BEFORE
@Implement(projectContract.list)
list() {
  return implement(projectContract.list).handler(async ({ input }) => {
    const db = this.databaseService.db;
    const items = await db.select().from(projects).limit(input.limit);
    const total = await db.select({ count: count() }).from(projects);
    return { items, total: total[0].count };
  });
}

// ✅ AFTER
@Implement(projectContract.list)
list() {
  return implement(projectContract.list).handler(async ({ input }) => {
    const result = await this.projectService.findMany(input);
    return this.projectAdapter.adaptListToContract(result.projects, result.total, input.limit, input.offset);
  });
}
```

**Pattern 3: Complex Query with Joins**
```typescript
// ❌ BEFORE (join logic in controller)
@Implement(projectContract.getWithEnvironments)
getWithEnvironments() {
  return implement(projectContract.getWithEnvironments).handler(async ({ input }) => {
    const db = this.databaseService.db;
    const result = await db
      .select()
      .from(projects)
      .leftJoin(environments, eq(projects.id, environments.projectId))
      .where(eq(projects.id, input.id));
    // ... complex transformation
  });
}

// ✅ AFTER (join logic in repository, called by service)
@Implement(projectContract.getWithEnvironments)
getWithEnvironments() {
  return implement(projectContract.getWithEnvironments).handler(async ({ input }) => {
    const project = await this.projectService.findByIdWithRelations(input.id);
    return this.projectAdapter.adaptProjectWithRelationsToContract(project);
  });
}
```

#### Testing Benefits

**Service Layer Tests (Easy):**
```typescript
describe('ProjectService', () => {
  it('should filter archived projects', async () => {
    const mockRepo = {
      findMany: jest.fn().mockResolvedValue([
        { id: '1', isArchived: false },
        { id: '2', isArchived: true },
      ]),
    };
    
    const service = new ProjectService(mockRepo as any);
    const result = await service.findMany({ userId: 'user1' });
    
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });
});
```

**Controller Tests (Easy):**
```typescript
describe('ProjectController', () => {
  it('should return transformed project', async () => {
    const mockService = {
      findById: jest.fn().mockResolvedValue({ id: '1', name: 'Test' }),
    };
    const mockAdapter = {
      adaptToContract: jest.fn().mockReturnValue({ id: '1', name: 'Test' }),
    };
    
    const controller = new ProjectController(mockService as any, mockAdapter as any);
    const result = await controller.getById('1');
    
    expect(mockService.findById).toHaveBeenCalledWith('1');
    expect(mockAdapter.adaptToContract).toHaveBeenCalled();
  });
});
```

#### Key Takeaways

1. **NEVER inject `DatabaseService` in controllers** - Use service layer
2. **Services return entities, not contracts** - Transformation happens in adapters
3. **Adapters are pure transformation functions** - No business logic
4. **Controllers orchestrate, don't implement** - Call service → adapt → return
5. **Repository is the ONLY layer accessing database** - All queries go through it
6. **Follow domain-driven module organization** - Controllers in their domain module
7. **Check for duplicate transformation methods** - Use adapter methods, don't duplicate
8. **Extend services when needed** - Add missing methods to service layer first

### 10. Shared Package System
**Internal packages use workspace references:**
```json
"@repo/ui": "*"           // Not published packages
"@repo/api-contracts": "*" // Shared between apps
```
Import like: `import { Button } from '@repo/ui'`

### 11. Environment Configuration
**Multi-environment setup with Docker:**
- Development: `.env` file with Docker service URLs
- API URL patterns: `http://api:3001` (internal) vs `http://localhost:3001` (external)
- Use `envcli` for environment variable interpolation in scripts

## Key Commands & Workflows

### Development
```bash
bun run dev                    # Start full development stack
bun run web -- dr:build:watch # Watch mode for route generation
bun run api -- db:studio      # Database admin UI
```

### Building & Testing
```bash
bun run build                  # Build all apps and packages
bun run test                   # Run all tests (uses vitest)
npm run test                   # Alternative test command (uses vitest)
npx vitest run                 # Direct vitest execution
bun x vitest run               # Alternative direct vitest execution
bun run test:coverage          # Coverage across monorepo
```

**⚠️ CRITICAL: Testing Requirements**
- **ALWAYS use Vitest** for testing - never use `bun test`, `deno test`, or other test runners
- **Preferred commands**: `bun run test` or `npm run test` (both use vitest internally)
- **Direct execution**: Use `npx vitest` or `bun x vitest` with appropriate options
- **Never use**: `bun test` (different test runner with different behavior)

### Database Operations
```bash
# Container-based database operations (REQUIRED during development)
bun run api -- db:generate    # Generate migrations (can run on host)
bun run api -- db:push        # Push schema changes (CONTAINER ONLY)
bun run api -- db:migrate     # Run migrations (CONTAINER ONLY)
bun run api -- db:seed        # Seed development data (CONTAINER ONLY)
bun run api -- db:studio      # Database admin UI (CONTAINER ONLY)
```

**⚠️ CRITICAL: Database Command Requirements**
- **During development**: ALL database operations (push, migrate, seed, studio) MUST run inside containers
- **Code generation**: Commands like `db:generate` can run on host as they only generate files
- **Never run directly on host**: Database modification commands bypass Docker networking and env setup
- **Container execution ensures**: Proper database connections, environment variables, and network access

## File Organization Patterns

### Next.js App (apps/web/)
- **App Router**: `src/app/*/page.tsx` with co-located `page.info.ts`
- **Components**: Atomic component architecture in `src/components/`
- **State**: Zustand stores in `src/state/`
- **API Client**: Generated ORPC hooks in `src/lib/api.ts`

#### Component Architecture Structure (apps/web/src/components/)
**Atomic Design Pattern**:
```
src/components/
├── ui/                    # Basic UI atoms (buttons, inputs, cards)
├── layout/               # Layout-specific components (header, sidebar)
├── navigation/           # Navigation-related components
├── dashboard/            # Dashboard-specific components
├── project/              # Project management components
├── services/             # Service management components
├── deployments/          # Deployment-related components  
├── team-management/      # Team and collaboration components
├── activity/             # Activity and logging components
├── devtools/            # Development tools components
└── [feature]/           # Feature-specific component groups
```

**Component Organization Principles**:
- **Atoms**: Basic UI components (buttons, inputs, typography)
- **Molecules**: Component combinations (form fields, search bars)
- **Organisms**: Complex UI sections (headers, forms, data tables)
- **Templates**: Page layouts without content
- **Pages**: Complete page implementations with real content

### NestJS API (apps/api/)
- **Modules**: Feature-based modules with ORPC contracts
- **Database**: Drizzle schema in `src/db/drizzle/schema/`
- **Auth**: Better Auth configuration in `src/auth.ts`

#### API Module Structure (apps/api/src/modules/)
**Standard Module Pattern**:
```
src/modules/[feature]/
├── dto/                  # Data transfer objects
├── entities/            # Database entities (if using TypeORM)
├── repositories/        # Database access layer (1st to create)
├── services/           # Business logic layer (2nd to create)
├── controllers/        # HTTP request handlers (3rd to create)
├── [feature].module.ts  # Module definition
└── __tests__/          # Module-specific tests
```

**Module Creation Order**:
1. **Repository**: Database access and query logic
2. **Service**: Business logic and operations
3. **Controller**: HTTP endpoints and request handling

### Shared Packages
- **UI**: Shadcn components with Tailwind in `packages/ui/`
- **Contracts**: ORPC procedures in `packages/api-contracts/`
- **Config**: Shared ESLint, Prettier, Tailwind configs

## Common Gotchas

1. **Route Changes**: Always run `bun run web -- dr:build` after modifying route structure
2. **Docker Networking**: Use container names (`api:3001`) for server-side, localhost for client-side
3. **Type Generation**: API contract changes require `bun run web -- generate`
4. **Hot Reloading**: Files are mounted in Docker - changes should reflect immediately
5. **Database**: PostgreSQL runs in Docker - connection strings use container networking

## Testing Strategy

- **Unit Tests**: Vitest with coverage thresholds (75%)
- **Integration**: ORPC contracts ensure API compatibility
- **E2E**: Via declarative routes for type-safe navigation

## Debugging Tips

```bash
bun run dev:api:logs          # View API container logs
bun run dev:web:logs          # View web container logs
docker exec -it [container] sh # Shell into containers
```

When making changes, follow this order: API contracts → API implementation → route generation → frontend implementation.

## Turborepo Remote Caching Configuration

This project is configured with Turborepo remote caching to speed up builds across development environments and CI/CD pipelines.

### Setting Up Remote Caching

**1. Create Vercel Account & Token**
- Visit [Vercel.com](https://vercel.com) and create an account
- Go to [Account Settings > Tokens](https://vercel.com/account/tokens)
- Create a new token with appropriate permissions
- Copy the token for use in configuration

**2. Configure Environment Variables**

**For Local Development:**
```bash
# Add to your .env file
TURBO_TOKEN=your-vercel-token-here
TURBO_TEAM=your-team-name-or-username  # Your Vercel username or team name
```

**For CI/CD (GitHub Secrets):**
- Go to your GitHub repository Settings > Secrets and variables > Actions
- Add repository secrets:
  - `TURBO_TOKEN`: Your Vercel token
  - `TURBO_TEAM`: Your Vercel username or team name

**3. Docker Compose Integration**
Remote caching is automatically configured in Docker containers when environment variables are set:
```bash
# Docker containers will inherit TURBO_TOKEN and TURBO_TEAM from your .env file
bun run dev  # Uses remote cache in containers
```

**4. Host Development**
For direct host development (not in containers):
```bash
# Ensure environment variables are set, then run:
bun run build    # Will use remote cache
bun run test     # Will use remote cache
```

**5. Verification**
To verify remote caching is working:
```bash
# Clean local cache and build
bun run clean
bun run build    # Should show "MISS" for first build
bun run clean
bun run build    # Should show "HIT" for subsequent builds
```

### Remote Cache Benefits
- **🚀 Faster Builds**: Share build artifacts across environments
- **💾 Storage Efficient**: Avoid rebuilding unchanged packages
- **🔄 Team Collaboration**: Share cache between team members
- **⚡ CI/CD Speed**: Dramatically faster pipeline execution
- **🐳 Container Optimization**: Faster Docker builds with persistent cache

### Cache Locations
- **Local Development**: Docker containers automatically use remote cache
- **CI/CD Pipeline**: GitHub Actions configured with remote caching
- **Host Development**: Uses remote cache when `TURBO_TOKEN` is configured

### Troubleshooting Remote Cache
```bash
# View cache status
bun run build --dry-run     # Shows what would be cached

# Force bypass cache (for testing)
bun run build --force      # Ignores remote cache

# Clear local cache
bun run clean              # Clears local Turbo cache
```

## Documentation References

For detailed information on specific topics, reference these documentation files:

### 🚀 **Getting Started & Setup**
- **Initial Setup**: [`docs/guides/GETTING-STARTED.md`](../docs/guides/GETTING-STARTED.md) - Complete setup guide with prerequisites and environment configuration
- **Project Architecture**: [`docs/architecture/ARCHITECTURE.md`](../docs/architecture/ARCHITECTURE.md) - System design, component relationships, and data flows
- **Technology Stack**: [`docs/reference/TECH-STACK.md`](../docs/reference/TECH-STACK.md) - Detailed technology choices and version information

### 🛠️ **Development Workflows**
- **Daily Development**: [`docs/guides/DEVELOPMENT-WORKFLOW.md`](../docs/guides/DEVELOPMENT-WORKFLOW.md) - Day-to-day development tasks and best practices
- **API Contracts**: [`docs/core-concepts/09-ORPC-IMPLEMENTATION-PATTERN.md`](../docs/core-concepts/09-ORPC-IMPLEMENTATION-PATTERN.md) - ORPC type-safe API development and usage patterns
- **Declarative Routing**: [`apps/web/src/routes/README.md`](../apps/web/src/routes/README.md) - Type-safe routing system usage and examples

### 🐳 **Docker & Deployment**
- **Docker Strategies**: [`docs/features/docker/DOCKER-BUILD-STRATEGIES.md`](../docs/features/docker/DOCKER-BUILD-STRATEGIES.md) - Development vs production Docker configurations
- **Production Deployment**: [`docs/guides/PRODUCTION-DEPLOYMENT.md`](../docs/guides/PRODUCTION-DEPLOYMENT.md) - Production environment setup and deployment strategies
- **Render Deployment**: [`docs/guides/RENDER-DEPLOYMENT.md`](../docs/guides/RENDER-DEPLOYMENT.md) - Platform-specific deployment guide for Render
- **Project Isolation**: [`docs/guides/PROJECT-ISOLATION.md`](../docs/guides/PROJECT-ISOLATION.md) - Running multiple project instances without conflicts

### ⚙️ **Configuration & Environment**
- **Environment Variables**: [`docs/reference/ENVIRONMENT-TEMPLATE-SYSTEM.md`](../docs/reference/ENVIRONMENT-TEMPLATE-SYSTEM.md) - Environment configuration and template system
- **Database Encryption**: [`docs/reference/DATABASE-ENCRYPTION.md`](../docs/reference/DATABASE-ENCRYPTION.md) - Automatic encryption/decryption for sensitive database fields
- **GitHub Copilot Setup**: [`docs/archive/COPILOT-SETUP.md`](../docs/archive/COPILOT-SETUP.md) - AI development environment configuration

### 🧪 **Testing & Quality**
- **Testing Guide**: [`docs/guides/TESTING.md`](../docs/guides/TESTING.md) - Testing strategies and test execution
- **Testing Implementation**: [`docs/features/testing/TESTING-IMPLEMENTATION-SUMMARY.md`](../docs/features/testing/TESTING-IMPLEMENTATION-SUMMARY.md) - Comprehensive testing setup details

### 📂 **Quick Reference for Common Tasks**

| Task | Documentation File | Key Section |
|------|-------------------|-------------|
| Setting up development environment | `docs/guides/GETTING-STARTED.md` | Quick Start |
| Creating API endpoints | `docs/core-concepts/09-ORPC-IMPLEMENTATION-PATTERN.md` | API Implementation |
| Adding new pages | `apps/web/src/routes/README.md` | Using the routes |
| Database operations | `docs/guides/DEVELOPMENT-WORKFLOW.md` | Working with Database |
| Encrypting sensitive database fields | `docs/reference/DATABASE-ENCRYPTION.md` | Custom Column Type |
| Docker issues | `docs/features/docker/DOCKER-BUILD-STRATEGIES.md` | Troubleshooting |
| Production deployment | `docs/guides/PRODUCTION-DEPLOYMENT.md` | Production Environment Variables |
| Environment configuration | `docs/reference/ENVIRONMENT-TEMPLATE-SYSTEM.md` | Template System |
| Testing setup | `docs/guides/TESTING.md` | Running Tests |
| **Service health & rollback policy** | **`docs/DEPLOYMENT-HEALTH-RULES.md`** | **Health Calculation Rules** |
| **Static deployment status bug** | **`docs/STATIC-DEPLOYMENT-STATUS-BUG-FIX.md`** | **Health Monitor Fix** |

**Note**: Always check these documentation files for the most up-to-date and detailed information before implementing features or resolving issues.

## Documentation Maintenance

**IMPORTANT**: As an AI coding agent, you have a responsibility to keep documentation accurate and up-to-date. 

### When to Update Documentation

Update relevant documentation whenever you:

1. **Add/Modify API Endpoints**: Update `docs/core-concepts/09-ORPC-IMPLEMENTATION-PATTERN.md` and `docs/guides/DEVELOPMENT-WORKFLOW.md`
2. **Change Environment Variables**: Update `docs/guides/GETTING-STARTED.md`, `docs/reference/ENVIRONMENT-TEMPLATE-SYSTEM.md`, and relevant deployment docs

**2. Configure Environment Variables**

**For Local Development:**
```bash
# Add to your .env file
TURBO_TOKEN=your-vercel-token-here
TURBO_TEAM=your-team-name-or-username  # Your Vercel username or team name
```

**For CI/CD (GitHub Secrets):**
- Go to your GitHub repository Settings > Secrets and variables > Actions
- Add repository secrets:
  - `TURBO_TOKEN`: Your Vercel token
  - `TURBO_TEAM`: Your Vercel username or team name

**3. Docker Compose Integration**
Remote caching is automatically configured in Docker containers when environment variables are set:
```bash
# Docker containers will inherit TURBO_TOKEN and TURBO_TEAM from your .env file
bun run dev  # Uses remote cache in containers
```

**4. Host Development**
For direct host development (not in containers):
```bash
# Ensure environment variables are set, then run:
bun run build    # Will use remote cache
bun run test     # Will use remote cache
```

**5. Verification**
To verify remote caching is working:
```bash
# Clean local cache and build
bun run clean
bun run build    # Should show "MISS" for first build
bun run clean
bun run build    # Should show "HIT" for subsequent builds
```

### Remote Cache Benefits
- **🚀 Faster Builds**: Share build artifacts across environments
- **💾 Storage Efficient**: Avoid rebuilding unchanged packages
- **🔄 Team Collaboration**: Share cache between team members
- **⚡ CI/CD Speed**: Dramatically faster pipeline execution
- **🐳 Container Optimization**: Faster Docker builds with persistent cache

### Cache Locations
- **Local Development**: Docker containers automatically use remote cache
- **CI/CD Pipeline**: GitHub Actions configured with remote caching
- **Host Development**: Uses remote cache when `TURBO_TOKEN` is configured

### Troubleshooting Remote Cache
```bash
# View cache status
bun run build --dry-run     # Shows what would be cached

# Force bypass cache (for testing)
bun run build --force      # Ignores remote cache

# Clear local cache
bun run clean              # Clears local Turbo cache
```

## Documentation References

For detailed information on specific topics, reference these documentation files:

### 🚀 **Getting Started & Setup**
- **Initial Setup**: [`docs/guides/GETTING-STARTED.md`](../docs/guides/GETTING-STARTED.md) - Complete setup guide with prerequisites and environment configuration
- **Project Architecture**: [`docs/architecture/ARCHITECTURE.md`](../docs/architecture/ARCHITECTURE.md) - System design, component relationships, and data flows
- **Technology Stack**: [`docs/reference/TECH-STACK.md`](../docs/reference/TECH-STACK.md) - Detailed technology choices and version information

### 🛠️ **Development Workflows**
- **Daily Development**: [`docs/guides/DEVELOPMENT-WORKFLOW.md`](../docs/guides/DEVELOPMENT-WORKFLOW.md) - Day-to-day development tasks and best practices
- **API Contracts**: [`docs/core-concepts/09-ORPC-IMPLEMENTATION-PATTERN.md`](../docs/core-concepts/09-ORPC-IMPLEMENTATION-PATTERN.md) - ORPC type-safe API development and usage patterns
- **Declarative Routing**: [`apps/web/src/routes/README.md`](../apps/web/src/routes/README.md) - Type-safe routing system usage and examples

### 🐳 **Docker & Deployment**
- **Docker Strategies**: [`docs/features/docker/DOCKER-BUILD-STRATEGIES.md`](../docs/features/docker/DOCKER-BUILD-STRATEGIES.md) - Development vs production Docker configurations
- **Production Deployment**: [`docs/guides/PRODUCTION-DEPLOYMENT.md`](../docs/guides/PRODUCTION-DEPLOYMENT.md) - Production environment setup and deployment strategies
- **Render Deployment**: [`docs/guides/RENDER-DEPLOYMENT.md`](../docs/guides/RENDER-DEPLOYMENT.md) - Platform-specific deployment guide for Render
- **Project Isolation**: [`docs/guides/PROJECT-ISOLATION.md`](../docs/guides/PROJECT-ISOLATION.md) - Running multiple project instances without conflicts

### ⚙️ **Configuration & Environment**
- **Environment Variables**: [`docs/reference/ENVIRONMENT-TEMPLATE-SYSTEM.md`](../docs/reference/ENVIRONMENT-TEMPLATE-SYSTEM.md) - Environment configuration and template system
- **Database Encryption**: [`docs/reference/DATABASE-ENCRYPTION.md`](../docs/reference/DATABASE-ENCRYPTION.md) - Automatic encryption/decryption for sensitive database fields
- **GitHub Copilot Setup**: [`docs/archive/COPILOT-SETUP.md`](../docs/archive/COPILOT-SETUP.md) - AI development environment configuration

### 🧪 **Testing & Quality**
- **Testing Guide**: [`docs/guides/TESTING.md`](../docs/guides/TESTING.md) - Testing strategies and test execution
- **Testing Implementation**: [`docs/features/testing/TESTING-IMPLEMENTATION-SUMMARY.md`](../docs/features/testing/TESTING-IMPLEMENTATION-SUMMARY.md) - Comprehensive testing setup details

### 📂 **Quick Reference for Common Tasks**

| Task | Documentation File | Key Section |
|------|-------------------|-------------|
| Setting up development environment | `docs/guides/GETTING-STARTED.md` | Quick Start |
| Creating API endpoints | `docs/core-concepts/09-ORPC-IMPLEMENTATION-PATTERN.md` | API Implementation |
| Adding new pages | `apps/web/src/routes/README.md` | Using the routes |
| Database operations | `docs/guides/DEVELOPMENT-WORKFLOW.md` | Working with Database |
| Encrypting sensitive database fields | `docs/reference/DATABASE-ENCRYPTION.md` | Custom Column Type |
| Docker issues | `docs/features/docker/DOCKER-BUILD-STRATEGIES.md` | Troubleshooting |
| Production deployment | `docs/guides/PRODUCTION-DEPLOYMENT.md` | Production Environment Variables |
| Environment configuration | `docs/reference/ENVIRONMENT-TEMPLATE-SYSTEM.md` | Template System |
| Testing setup | `docs/guides/TESTING.md` | Running Tests |
| **Service health & rollback policy** | **`docs/DEPLOYMENT-HEALTH-RULES.md`** | **Health Calculation Rules** |
| **Static deployment status bug** | **`docs/STATIC-DEPLOYMENT-STATUS-BUG-FIX.md`** | **Health Monitor Fix** |

**Note**: Always check these documentation files for the most up-to-date and detailed information before implementing features or resolving issues.

## Documentation Maintenance

**IMPORTANT**: As an AI coding agent, you have a responsibility to keep documentation accurate and up-to-date. 

### When to Update Documentation

Update relevant documentation whenever you:

1. **Add/Modify API Endpoints**: Update `docs/core-concepts/09-ORPC-IMPLEMENTATION-PATTERN.md` and `docs/guides/DEVELOPMENT-WORKFLOW.md`
2. **Change Environment Variables**: Update `docs/guides/GETTING-STARTED.md`, `docs/reference/ENVIRONMENT-TEMPLATE-SYSTEM.md`, and relevant deployment docs
3. **Modify Docker Configuration**: Update `docs/features/docker/DOCKER-BUILD-STRATEGIES.md` and deployment guides
4. **Update Dependencies**: Update `docs/reference/TECH-STACK.md` with new versions and rationale
5. **Change Database Schema**: Update `docs/guides/DEVELOPMENT-WORKFLOW.md` database sections
6. **Add/Remove Routes**: Update `apps/web/src/routes/README.md` and routing documentation
7. **Modify Authentication Flow**: Update `docs/architecture/ARCHITECTURE.md` and setup guides
8. **Change Testing Setup**: Update `docs/guides/TESTING.md` and testing documentation
9. **Alter Deployment Procedures**: Update production and platform-specific deployment guides
10. **Add New Features**: Create or update relevant documentation sections

### Documentation Update Process

1. **Identify Impact**: Determine which documentation files are affected by your changes
2. **Update Content**: Modify the documentation to reflect new reality
3. **Verify Accuracy**: Ensure examples, commands, and procedures are correct
4. **Check Cross-References**: Update any links or references in other documentation files
5. **Test Instructions**: Verify that documented procedures actually work

### Documentation Quality Standards

- **Be Specific**: Include exact commands, file paths, and code examples
- **Stay Current**: Remove deprecated information and update version numbers
- **Cross-Reference**: Link related documentation sections appropriately
- **Include Context**: Explain not just what to do, but why and when
- **Test Examples**: Ensure all code examples and commands actually work

**Remember**: Documentation is code. Treat it with the same care and attention as you would application code. Outdated documentation can be worse than no documentation at all.

## New Concept Documentation Protocol

**CRITICAL**: When you introduce ANY new concept, pattern, technology, or significant implementation approach to this project, you MUST create comprehensive documentation to ensure knowledge preservation and team alignment.

### What Constitutes a "New Concept"

Document whenever you add or implement:

1. **New Technologies or Libraries**: Any new dependency, framework, or tool
2. **New Design Patterns**: Architectural patterns, coding conventions, or structural approaches
3. **New Development Workflows**: Build processes, deployment strategies, or development procedures
4. **New API Patterns**: Endpoint structures, authentication methods, or data handling approaches
5. **New UI/UX Patterns**: Component structures, styling approaches, or interaction patterns
6. **New Configuration Systems**: Environment setups, build configurations, or deployment configs
7. **New Testing Approaches**: Testing strategies, tools, or methodologies
8. **New Performance Optimizations**: Caching strategies, bundling approaches, or optimization techniques
9. **New Security Implementations**: Authentication flows, authorization patterns, or security measures
10. **New Integration Methods**: Third-party service integrations or inter-service communication patterns

### Documentation Creation Process

#### 1. **Determine Documentation Scope**
- **Minor Enhancement**: Update existing documentation section
- **Major Feature**: Create dedicated documentation file in `docs/` directory
- **Cross-cutting Concern**: Update multiple related documentation files

#### 2. **Create/Update Documentation**

**For New Documentation Files:**
- Use clear, descriptive naming: `docs/NEW-CONCEPT-NAME.md`
- Follow the established documentation structure and tone
- Include practical examples and code snippets
- Provide troubleshooting guidance
- Link to related documentation

**Documentation Template for New Concepts:**
```markdown
# [Concept Name]

## Overview
Brief description of what this concept is and why it was added.

## Implementation
How it's implemented in this project.

## Usage Examples
Practical examples with code snippets.

## Configuration
Any configuration required.

## Best Practices
Recommended approaches and patterns.

## Troubleshooting
Common issues and solutions.

## Related Documentation
Links to related concepts and documentation.
```

#### 3. **Update Reference Systems**

**ALWAYS update these files when adding new concepts:**

1. **This Copilot Instructions File** (`copilot-instructions.md`)
   - Add to Documentation References section under appropriate category
   - Update Quick Reference table if applicable
   - Add to Development Patterns section if it introduces new workflows

2. **Project README** (if user-facing)
   - Update feature lists or technology mentions

3. **Architecture Documentation** (`docs/architecture/ARCHITECTURE.md`)
   - Update if it affects system architecture

4. **Tech Stack Documentation** (`docs/reference/TECH-STACK.md`)
   - Add new technologies with version information and rationale

### Copilot Instructions File Maintenance

**⚠️ EXTREME CAUTION REQUIRED**: This file (`copilot-instructions.md`) is the **FOUNDATION** of all AI development work on this project. It must be maintained with exceptional care and precision.

#### Why This File is Critical

This file serves as:
- **Primary Knowledge Base**: The source of truth for all development patterns and practices
- **AI Decision Framework**: Guides all AI coding decisions and implementations
- **Team Alignment Tool**: Ensures consistent approaches across all contributors
- **Project Documentation Hub**: Central reference point for all documentation

#### Rules for Modifying This File

1. **Think Before You Act**: 
   - Spend significant time analyzing the impact of any change
   - Consider how the change affects existing patterns and workflows
   - Ensure changes align with the overall project philosophy

2. **Maintain Structural Integrity**:
   - Preserve the existing section hierarchy and organization
   - Keep the logical flow from basic concepts to advanced topics
   - Maintain consistency in formatting and style

3. **Comprehensive Review Process**:
   - Read the entire file before making changes
   - Verify that new content doesn't contradict existing information
   - Ensure all cross-references remain accurate
   - Test that all code examples and commands work correctly

4. **Documentation Standards**:
   - Be extremely precise with technical details
   - Include complete context, not just the change
   - Use consistent terminology throughout
   - Provide clear examples and rationale

5. **Impact Assessment**:
   - Consider how changes affect new developer onboarding
   - Evaluate impact on existing development workflows
   - Ensure changes support the project's scalability goals

#### Modification Checklist

Before modifying this file, complete this checklist:

- [ ] **Purpose Clear**: Is the reason for the change clearly defined and necessary?
- [ ] **Impact Understood**: Do I understand how this change affects the entire development ecosystem?
- [ ] **Structure Maintained**: Does the change preserve the file's logical organization?
- [ ] **Cross-References Updated**: Are all related references updated consistently?
- [ ] **Examples Tested**: Do all code examples and commands work correctly?
- [ ] **Consistency Verified**: Is the new content consistent with existing style and terminology?
- [ ] **Completeness Ensured**: Is the documentation complete and self-contained?
- [ ] **Future-Proofed**: Will this change remain relevant and accurate over time?

#### Emergency Protocol

If you realize you've made an error in this file:
1. **Stop immediately** and assess the full impact
2. **Review the entire file** to understand what was changed
3. **Test all examples** and verify all commands work
4. **Fix inconsistencies** throughout the file, not just the immediate change
5. **Document the correction** in commit messages with clear explanation

**Remember**: This file is not just documentation—it's the intelligence that guides all future development. Every change ripples through the entire project ecosystem. Treat it with the reverence it deserves.