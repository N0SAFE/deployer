<!--
SYNC IMPACT REPORT
==================
Version Change: 1.2.1 → 1.2.2
Action: Enhanced Migration & Seed Execution Policy (Automatic Execution)
Date: 2025-01-12

Changes Made:
-------------
- Added CRITICAL rules for db:migrate automatic execution on container start
- Added CRITICAL rules for db:seed automatic execution on fresh volumes
- Documented when manual runs are acceptable (rarely needed)
- Added recommended workflows for common scenarios
- Added rationale for automatic execution (prevents drift, zero manual steps)
- Updated command documentation to indicate RARELY NEEDED status
- Added container restart as preferred method over manual migration runs
- Added docker compose down -v workflow for re-seeding

Previous Version (1.2.1):
-------------------------
Version Change: 1.2.0 → 1.2.1
Action: Enhanced Database Operations with Migration Generation Workflow
Date: 2025-01-12

Changes Made:
-------------
- Replaced basic Database Operations section with comprehensive migration workflow
- Added CRITICAL RULES for migration generation (never create manually)
- Documented 4-step workflow: schema change → generate → review → apply
- Added migration removal process (3 steps: delete SQL, delete snapshot, update journal)
- Added Better Auth plugin change workflow with auth:generate command
- Added production migration workflow and rationale
- Documented all database commands with container requirements
- Added enforcement rules (FORBIDDEN vs MANDATORY actions)

Previous Version (1.2.0):
-------------------------
Version Change: 1.1.0 → 1.2.0
Action: Added Principle IX - Legacy Code Replacement (MANDATORY)
Date: 2025-01-12

Changes Made:
-------------
- Added mandatory Principle IX for complete legacy code replacement
- Defined 6 replacement rules with code examples
- Documented when explanatory comments are required vs optional
- Provided migration workflow for clean code transitions
- Established enforcement rules (PR rejection criteria)
- Added comment structure template for architectural changes

Previous Version (1.1.0):
-------------------------
Version Change: 1.0.0 → 1.1.0
Action: Added Principle VIII - NestJS Service Architecture
Date: 2025-01-11

Changes Made:
-------------
- Added comprehensive Principle VIII for NestJS service file organization
- Documented 10 file types: services, repositories, controllers, adapters, processors, bootstrap, hooks, guards, middlewares, interfaces
- Defined standardized folder structure for all NestJS modules
- Established clear separation of concerns and responsibilities
- Added enforcement rules and anti-patterns

Previous Version (1.0.0):
-------------------------
Version Change: Initial → 1.0.0
Action: Initial Constitution Creation
Date: 2025-10-11

Changes Made:
-------------
- Created comprehensive constitution from project documentation
- Defined 7 core architectural principles
- Established development workflow requirements
- Documented technology stack constraints
- Set up governance and amendment procedures

Principles Defined (v1.0.0):
----------------------------
1. Documentation-First Development (NON-NEGOTIABLE)
2. Type Safety Everywhere
3. Docker-First Development
4. Service-Adapter Architectural Pattern
5. Core vs Feature Module Separation
6. Multi-Tenant Isolation & Resource Management
7. Reconciliation & Self-Healing Systems

Principles Defined (v1.1.0):
----------------------------
1-7. [All previous principles unchanged]
8. NestJS Service Architecture & File Organization (NEW)

Principles Defined (v1.2.0):
----------------------------
1-8. [All previous principles unchanged]
9. Legacy Code Replacement (MANDATORY) (NEW)

Templates Requiring Updates:
----------------------------
✅ plan-template.md - Updated (includes documentation check)
✅ spec-template.md - Updated (includes architecture alignment)
✅ tasks-template.md - Updated (includes principle-driven categorization)

Follow-up TODOs:
---------------
- [ ] Review and verify all principle implementations in existing codebase
- [ ] Create compliance checklist for PR reviews
- [ ] Set up automated constitution compliance checks
- [ ] Document provider and builder plugin architecture
- [ ] Audit existing modules against Principle VIII file structure
- [ ] Create migration guide for modules not following standardized structure
-->

# Deployer Platform Constitution

**A Multi-Tenant Deployment Orchestration Platform for Universal Application Deployment**

## Core Principles

### I. Documentation-First Development (NON-NEGOTIABLE)

**BEFORE writing ANY code, making ANY changes, or answering ANY questions:**

1. **Read `docs/README.md`** - Overview of all available documentation
2. **Read relevant concept documentation** from `docs/concepts/`
3. **Read relevant architecture documentation** from `docs/architecture/`
4. **Read relevant feature documentation** from `docs/features/`
5. **Read relevant specification** from `docs/specifications/`

**NEVER skip this step**. Even if you think you know the answer, **VERIFY IT IN THE DOCS FIRST**.

**Core Documents (Always Load in Context):**
- `docs/README.md` - Documentation hub and navigation
- `docs/concepts/SERVICE-ADAPTER-PATTERN.md` - Core architectural pattern
- `docs/concepts/FRONTEND-DEVELOPMENT-PATTERNS.md` - Frontend patterns (ORPC, Better Auth, Declarative Routing)
- `docs/architecture/CORE-VS-FEATURE-ARCHITECTURE.md` - Module organization
- `docs/architecture/CORE-MODULE-ARCHITECTURE.md` - Core module dependencies

**If documentation is missing or unclear:**
- Search existing docs for similar patterns
- Ask the user for clarification before implementing
- Document your decision following the established template
- Update this constitution if it's a new fundamental concept

**Rationale**: This project has specific, non-standard patterns that cannot be inferred. Documentation is the single source of truth that prevents implementation errors and maintains architectural consistency.

---

### II. Type Safety Everywhere

**All code must be type-safe with compile-time guarantees:**

**Backend (NestJS + ORPC):**
- All API contracts defined in `packages/api-contracts/` using ORPC
- Services return pure entities (never contract types)
- Adapters return exact contract types (`type ServiceContract = typeof serviceContract.getById.output`)
- TypeScript strict mode enabled
- No `any` types except in justified edge cases (must be documented)

**Frontend (Next.js):**
- Use `orpc.contract.method.queryOptions()` pattern for all API calls
- Use Better Auth hooks (`useSession`, `signIn`, `signOut`) for authentication
- Use Declarative Routing (`<Route.Link>`, `Route.fetch()`) for navigation
- All components strictly typed with interfaces
- React Query for server state, Zustand for UI state

**Database (Drizzle ORM):**
- All schemas in `apps/api/src/db/schema/` with TypeScript types
- Use Drizzle's type inference for queries
- Custom column types for encrypted fields and JSON with variables

**Shared Types:**
- Common types in `packages/types/`
- Contract types extracted in feature module `interfaces/` folders
- Never duplicate type definitions across modules

**Rationale**: End-to-end type safety catches errors at compile-time, enables confident refactoring, and provides excellent developer experience through autocomplete and inline documentation.

---

### III. Docker-First Development

**Always use Docker commands for development and deployment:**

**Development:**
```bash
bun run dev              # Full stack (API + Web + DB + Redis)
bun run dev:api          # API only with database
bun run dev:web          # Web only (requires running API)
```

**Database Operations (Container-Based):**
```bash
bun run api -- db:generate    # Generate migrations (can run on host)
bun run api -- db:push        # Push schema changes (CONTAINER ONLY)
bun run api -- db:migrate     # Run migrations (CONTAINER ONLY)
bun run api -- db:seed        # Seed data (CONTAINER ONLY)
bun run api -- db:studio      # Database admin UI (CONTAINER ONLY)
```

**NEVER:**
- ❌ Run `next dev` or `nest start` directly on host
- ❌ Run database modification commands directly on host during development
- ❌ Bypass Docker networking and environment setup

**Container Execution Ensures:**
- Proper database connections with correct environment variables
- Consistent networking (container names vs localhost)
- Reproducible environments across team members
- Production parity

**Rationale**: Services are containerized with proper networking. Docker-first development ensures consistency, prevents environment-specific bugs, and maintains production parity.

---

### IV. Service-Adapter Architectural Pattern

**Clear separation between business logic, orchestration, and contract transformation:**

**Services (Core Business Logic):**
- **Location**: `apps/api/src/core/modules/[module]/services/`
- **Return Types**: Pure domain entities or partial entities (NEVER contract types)
- **Method Naming**: Generic, reusable (`findById`, `getStats`) NOT endpoint-specific (`getServiceById`)
- **Responsibilities**: Business logic, domain rules, data access coordination
- **Examples**: `Service`, `TraefikConfig`, `HealthCheckConfig`

**Adapters (Contract Transformation):**
- **Location**: `apps/api/src/modules/[feature]/adapters/`
- **Return Types**: Exact contract types (`type ServiceContract = typeof serviceContract.getById.output`)
- **Input**: Receives ALL data as parameters (NO service calls inside adapters)
- **Responsibilities**: Pure transformation from entities to contract formats
- **Zero Dependencies**: No service dependencies (or minimal, justified)

**Types (Centralized Definitions):**
- **Location**: `apps/api/src/modules/[feature]/interfaces/`
- **Contents**: Type aliases extracted from contracts, DTOs, interfaces
- **Purpose**: Single source of truth for feature types

**Controllers (Orchestration):**
- **Location**: `apps/api/src/modules/[feature]/controllers/`
- **Responsibilities**: Orchestrate service calls, aggregate data, pass to adapters
- **Pattern**: Mix multiple service methods → Pass aggregated data to adapter → Return contract
- **NEVER**: Just delegate to single service method (1:1 mapping is anti-pattern)

**The Three Golden Rules:**
1. 🎯 **Services**: Composable methods returning entities
2. 🔧 **Adapters**: Fixed contract output types
3. 🎭 **Controllers**: Orchestrate and mix service methods

**Rationale**: Separation of concerns enables code reuse, type safety, testability, and maintainability. Business logic changes don't affect API contracts, and contract changes only affect adapters.

---

### V. Core vs Feature Module Separation

**Strict boundaries between infrastructure (core) and domain logic (features):**

**Core Modules (`apps/api/src/core/modules/`):**
- **Purpose**: Shared infrastructure services
- **Can Import**: Only other core modules
- **Cannot Import**: Feature modules (NEVER)
- **Examples**: DatabaseModule, DockerModule, OrchestrationModule, ProvidersModule, BuildersModule
- **Rule**: Core modules MUST NOT import `CoreModule` (only specific modules needed)

**Feature Modules (`apps/api/src/modules/`):**
- **Purpose**: HTTP endpoints and domain-specific business logic
- **Can Import**: Core modules (via `CoreModule` or specific imports)
- **Can Import**: Other feature modules (when justified: aggregate roots, event notifications, configuration management)
- **Examples**: ProjectModule, ServiceModule, DeploymentModule, TraefikModule
- **Structure**:
  ```
  modules/[feature]/
  ├── adapters/         # Contract transformations
  ├── controllers/      # HTTP endpoints
  ├── interfaces/       # Type definitions
  ├── services/         # Feature-specific logic (optional)
  └── [feature].module.ts
  ```

**Dependency Rules:**
- ✅ Feature → Core (allowed)
- ✅ Core → Core (specific modules only, NOT CoreModule)
- ❌ Core → Feature (FORBIDDEN)
- ⚠️ Feature → Feature (allowed only for justified cases: aggregate roots, notifications, configuration)

**Use `forwardRef()` ONLY when:**
- Proven direct circular dependency exists
- Documented with clear justification
- Both sides of cycle use `forwardRef()`

**Rationale**: Clear boundaries prevent circular dependencies, improve testability, enable independent module development, and make the system easier to understand and maintain.

---

### VI. Multi-Tenant Isolation & Resource Management

**Each deployed project must be completely isolated with proper resource controls:**

**Network Isolation:**
- Each project gets dedicated Docker overlay network
- No inter-project communication unless explicitly configured
- Traefik provides routing with domain-based isolation
- SSL/TLS termination with automatic Let's Encrypt certificates

**Storage Isolation:**
- Dedicated Docker volumes per project
- Atomic deployment pattern with symlinks:
  ```
  /srv/static/[service]/
  ├── deployment-{id-1}/    # Immutable
  ├── deployment-{id-2}/    # Immutable  
  ├── deployment-{id-3}/    # Immutable
  └── current → deployment-{id-3}  # Atomic switch
  ```
- Volume labeling with project metadata
- Automatic cleanup of old deployments (retention policy)

**Resource Quotas:**
```typescript
interface ResourceQuotas {
  cpu: { limit: string; reservation: string }
  memory: { limit: string; reservation: string }
  storage: { limit: string }
  replicas: { max: number }
}
```

**Environment Configurations:**
- Production: `projectname.domain.com`
- Staging: `projectname-staging.domain.com`
- Preview: `projectname-pr-123.domain.com`
- Service-specific: `api-projectname.domain.com`

**Provider Types Supported:**
- GitHub (OAuth + Webhooks)
- GitLab
- Git (raw repository)
- Static (manual file upload)
- Docker Registry
- S3
- Custom (extensible)

**Builder Types Supported:**
- Static (HTML/CSS/JS)
- Dockerfile (custom images)
- Docker Compose (multi-container)
- Nixpack (auto-detection)
- Buildpack (Cloud Native)

**Rationale**: Multi-tenant isolation ensures security, prevents resource exhaustion attacks, enables independent scaling, and supports diverse deployment patterns through provider-builder decoupling.

---

### VII. Reconciliation & Self-Healing Systems

**System must automatically recover from crashes and maintain desired state:**

**Desired State (Database as Source of Truth):**
- All deployment state lives in PostgreSQL
- Projects, deployments, services configuration
- What SHOULD be running: Active projects with latest successful deployments

**Actual State (Runtime Reality):**
- Docker containers (running, stopped, crashed)
- Traefik routes (active routing configurations)
- Volume data (deployed files and symlinks)

**Reconciliation Loop (Kubernetes-Style):**
```typescript
while true:
  desired = getFromDatabase()
  actual = getFromDocker()
  
  if actual != desired:
    reconcile(desired, actual)
  
  sleep(interval)
```

**Crash Recovery Mechanisms:**
1. **Resumable Deployments**: Checkpoint-based deployment phases
2. **Container Restart Policies**: Automatic restart with exponential backoff
3. **Symlink Reconciliation**: Self-healing broken symlinks
4. **Health Monitoring**: Automatic detection and recovery of unhealthy services
5. **Leader Election**: Multi-server coordination using PostgreSQL advisory locks or Redis

**Deployment Phases (Resumable):**
- QUEUED → PULLING_SOURCE → BUILDING → COPYING_FILES → CREATING_SYMLINKS → UPDATING_ROUTES → HEALTH_CHECK → ACTIVE

**On Startup:**
- Resurrect active projects from database
- Restart stopped containers for active projects
- Clean up zombie containers for deleted projects
- Fix broken symlinks
- Verify deployment files exist

**Multi-Server Coordination:**
- PostgreSQL advisory locks for leader election
- Only one server reconciles at a time
- Automatic failover when leader crashes
- Heartbeat mechanism for liveness detection

**Rationale**: Production-grade reliability requires automatic recovery from failures, multi-server support for high availability, and self-healing to minimize manual intervention.

---

### VIII. NestJS Service Architecture & File Organization

**Every NestJS module must follow a standardized file structure with clear separation of concerns:**

**Module Folder Structure:**
```
apps/api/src/[core|modules]/[feature]/
├── adapters/              # Contract transformations (Feature modules only)
│   └── [feature]-adapter.service.ts
├── bootstrap/             # Application lifecycle initialization
│   └── [feature].bootstrap.ts
├── controllers/           # HTTP endpoints (Feature modules only)
│   └── [feature].controller.ts
├── guards/                # Route guards (authentication, authorization)
│   └── [feature].guard.ts
├── hooks/                 # Lifecycle hooks and event listeners
│   └── [feature].hooks.ts
├── interfaces/            # Type definitions and interfaces
│   ├── [feature].types.ts
│   └── [feature].interfaces.ts
├── middlewares/           # Request/response middleware
│   └── [feature].middleware.ts
├── processors/            # Background job processors (BullMQ)
│   └── [feature].processor.ts
├── repositories/          # Database access layer (Drizzle ORM)
│   └── [feature].repository.ts
├── services/              # Business logic layer
│   └── [feature].service.ts
├── [feature].module.ts    # Module definition
└── index.ts               # Barrel exports
```

**File Type Responsibilities:**

**1. Services (`services/[feature].service.ts`)**
- **Purpose**: Core business logic and domain rules
- **Return Types**: Pure domain entities or partial entities (NEVER contract types)
- **Method Naming**: Generic, reusable (`findById`, `getStats`) NOT endpoint-specific
- **Dependencies**: Repositories, other services, external APIs
- **Example**:
  ```typescript
  @Injectable()
  export class UserService {
    constructor(private userRepository: UserRepository) {}
    
    async findById(id: string): Promise<User | null> {
      return this.userRepository.findById(id)
    }
    
    async getStats(userId: string): Promise<UserStats> {
      return this.userRepository.getUserStats(userId)
    }
  }
  ```

**2. Repositories (`repositories/[feature].repository.ts`)**
- **Purpose**: Database access layer (Drizzle ORM operations)
- **Responsibilities**: CRUD operations, complex queries, transactions
- **Return Types**: Database entities, query results
- **No Business Logic**: Pure data access only
- **Example**:
  ```typescript
  @Injectable()
  export class UserRepository {
    constructor(@Inject('DATABASE') private db: Database) {}
    
    async findById(id: string): Promise<User | null> {
      return this.db.select().from(users).where(eq(users.id, id)).limit(1)
    }
    
    async create(data: NewUser): Promise<User> {
      return this.db.insert(users).values(data).returning()
    }
  }
  ```

**3. Controllers (`controllers/[feature].controller.ts`)** (Feature Modules Only)
- **Purpose**: HTTP endpoint orchestration
- **Responsibilities**: Orchestrate service calls, aggregate data, pass to adapters
- **Pattern**: Mix multiple service methods → Aggregate data → Pass to adapter → Return contract
- **No Business Logic**: Only orchestration and HTTP concerns
- **Example**:
  ```typescript
  @Controller()
  export class UserController {
    constructor(
      private userService: UserService,
      private userAdapter: UserAdapterService
    ) {}
    
    @Implement(userContract.getById)
    async getById(input: { id: string }) {
      const user = await this.userService.findById(input.id)
      const stats = await this.userService.getStats(input.id)
      return this.userAdapter.adaptWithStats(user, stats)
    }
  }
  ```

**4. Adapters (`adapters/[feature]-adapter.service.ts`)** (Feature Modules Only)
- **Purpose**: Transform entities to API contracts
- **Return Types**: Exact contract types (`type UserContract = typeof userContract.getById.output`)
- **Input**: Receives ALL data as parameters (NO service calls)
- **Pure Functions**: Stateless, deterministic transformations
- **Example**:
  ```typescript
  @Injectable()
  export class UserAdapterService {
    adaptWithStats(user: User, stats: UserStats): UserContract {
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        stats: {
          deploymentCount: stats.deploymentCount,
          projectCount: stats.projectCount
        }
      }
    }
  }
  ```

**5. Processors (`processors/[feature].processor.ts`)**
- **Purpose**: Background job processing with BullMQ
- **Decorator**: `@Processor('queue-name')`
- **Methods**: `@Process()` decorated methods for job handlers
- **Responsibilities**: Asynchronous task execution, long-running operations
- **Example**:
  ```typescript
  @Processor('deployment')
  export class DeploymentProcessor {
    constructor(private deploymentService: DeploymentService) {}
    
    @Process('build')
    async handleBuild(job: Job<BuildJobData>) {
      await this.deploymentService.executeDeployment(job.data)
    }
  }
  ```

**6. Bootstrap (`bootstrap/[feature].bootstrap.ts`)**
- **Purpose**: Application lifecycle initialization and cleanup
- **Lifecycle Hooks**: `OnApplicationBootstrap`, `OnApplicationShutdown`, `OnModuleInit`, `OnModuleDestroy`
- **Responsibilities**: Setup resources, initialize services, cleanup on shutdown
- **Global Scope**: Can be `@Global()` for app-wide initialization
- **Example**:
  ```typescript
  @Injectable()
  export class FileUploadBootstrap implements OnApplicationBootstrap {
    async onApplicationBootstrap() {
      await fs.ensureDir(UPLOAD_DIR)
      await fs.ensureDir(EXTRACT_DIR)
      this.logger.log('File upload service initialized')
    }
  }
  ```

**7. Hooks (`hooks/[feature].hooks.ts`)**
- **Purpose**: Event listeners and lifecycle hooks
- **Types**:
  - Database hooks (entity lifecycle events)
  - Authentication hooks (Better Auth hooks via `@Hook()` decorator)
  - Custom event hooks (NestJS event emitters)
- **Responsibilities**: React to system events, trigger side effects
- **Example**:
  ```typescript
  @Injectable()
  export class UserHooks {
    @Hook()
    async beforeUserCreate(event: BeforeCreateEvent) {
      event.data.password = await bcrypt.hash(event.data.password, 10)
    }
  }
  ```

**8. Guards (`guards/[feature].guard.ts`)**
- **Purpose**: Route protection (authentication, authorization, validation)
- **Interface**: `CanActivate`
- **Return**: `boolean` or `Promise<boolean>`
- **Responsibilities**: Check permissions, validate tokens, enforce access control
- **Example**:
  ```typescript
  @Injectable()
  export class RoleGuard implements CanActivate {
    async canActivate(context: ExecutionContext): Promise<boolean> {
      const requiredRoles = this.reflector.get('roles', context.getHandler())
      const user = context.switchToHttp().getRequest().user
      return requiredRoles.some(role => user.roles?.includes(role))
    }
  }
  ```

**9. Middlewares (`middlewares/[feature].middleware.ts`)**
- **Purpose**: Request/response preprocessing
- **Interface**: `NestMiddleware`
- **Responsibilities**: Logging, request transformation, custom parsing
- **Applied**: Via module configuration (`configure()` method)
- **Example**:
  ```typescript
  @Injectable()
  export class LoggerMiddleware implements NestMiddleware {
    use(req: Request, res: Response, next: NextFunction) {
      this.logger.log(`${req.method} ${req.url}`)
      next()
    }
  }
  ```

**10. Interfaces (`interfaces/[feature].types.ts` and `[feature].interfaces.ts`)**
- **Purpose**: Centralized type definitions
- **Contents**:
  - Type aliases extracted from API contracts
  - DTOs (Data Transfer Objects)
  - Interface definitions
  - Utility types
- **Single Source of Truth**: All types referenced from here
- **Example**:
  ```typescript
  // interfaces/user.types.ts
  import { userContract } from '@repo/api-contracts'
  
  export type UserContract = typeof userContract.getById.output
  export type UserListContract = typeof userContract.list.output
  
  export interface CreateUserDto {
    email: string
    password: string
    name: string
  }
  ```

**File Organization Rules:**

1. **✅ REQUIRED Folders**: `services/`, `repositories/` (for database modules)
2. **✅ REQUIRED for Feature Modules**: `controllers/`, `adapters/`, `interfaces/`
3. **⚠️ CONDITIONAL**: 
   - `processors/` - Only if module has background jobs
   - `bootstrap/` - Only if module needs lifecycle initialization
   - `hooks/` - Only if module has event listeners or database hooks
   - `guards/` - Only if module has custom authentication/authorization
   - `middlewares/` - Only if module has request preprocessing
4. **❌ NO Mixing**: Never put adapters in `services/`, never put types inline

**Module Registration Pattern:**

```typescript
// [feature].module.ts
@Module({
  imports: [
    CoreModule,
    BullModule.registerQueue({ name: 'deployment' }) // If processors exist
  ],
  controllers: [FeatureController], // Feature modules only
  providers: [
    // Core services
    FeatureService,
    FeatureRepository,
    
    // Adapters (feature modules only)
    FeatureAdapterService,
    
    // Background processing
    FeatureProcessor,
    
    // Lifecycle
    FeatureBootstrap,
    
    // Hooks and guards
    FeatureHooks,
    FeatureGuard,
    
    // Middleware (registered via configure())
  ],
  exports: [
    FeatureService,
    FeatureRepository,
    FeatureAdapterService // If needed by other modules
  ]
})
export class FeatureModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(FeatureMiddleware)
      .forRoutes(FeatureController)
  }
}
```

**Why This Matters:**

1. **Clear Separation of Concerns**: Each file type has a single, well-defined responsibility
2. **Predictable Structure**: Developers know exactly where to find code
3. **Easy Navigation**: Folder structure indicates purpose
4. **Scalability**: Modules grow without becoming cluttered
5. **Testability**: Each layer can be tested independently
6. **Maintainability**: Changes isolated to appropriate layers
7. **Onboarding**: New developers understand the pattern immediately

**Enforcement:**

- ❌ **NEVER** put business logic in controllers
- ❌ **NEVER** put contract transformations in services
- ❌ **NEVER** put database queries in controllers
- ❌ **NEVER** mix file types (adapters in services/, types inline, etc.)
- ✅ **ALWAYS** follow the folder structure
- ✅ **ALWAYS** use appropriate lifecycle hooks
- ✅ **ALWAYS** separate concerns by file type

**Rationale**: Standardized NestJS architecture ensures consistency across the entire codebase, makes code review straightforward, enables parallel development, reduces cognitive load, and maintains the separation of concerns required for a maintainable, scalable application.

---

### IX. Legacy Code Replacement (MANDATORY)

**All new implementations MUST completely replace legacy code - leaving both old and new code is FORBIDDEN:**

**Replacement Rules:**

1. **Complete Removal Required**:
   - ❌ **NEVER** leave old implementations alongside new ones
   - ❌ **NEVER** comment out old code "just in case"
   - ❌ **NEVER** rename old code with `_old`, `_legacy`, `_deprecated` suffixes
   - ✅ **ALWAYS** delete old code completely when new implementation is ready
   - ✅ **ALWAYS** update all references to use new implementation

2. **Explanatory Comments Required**:
   - When replacement involves significant architectural changes, add comments explaining:
     * **WHY** the change was made (business/technical rationale)
     * **WHAT** changed at a high level (not line-by-line diff)
     * **HOW** to use the new implementation (if not obvious)
   - Comments should be concise (2-5 lines) and focused on context, not implementation details
   - Place comments at the top of the new implementation, not scattered throughout

3. **Migration Pattern**:
   ```typescript
   // ❌ WRONG: Leaving both implementations
   function calculatePriceOld(item: Item): number { ... }  // Legacy
   function calculatePrice(item: Item): number { ... }     // New
   
   // ❌ WRONG: Commented out code
   function calculatePrice(item: Item): number {
     // Old implementation:
     // return item.basePrice * item.quantity
     
     // New implementation with tax calculation
     return (item.basePrice * item.quantity) * (1 + item.taxRate)
   }
   
   // ✅ CORRECT: Clean replacement with explanatory comment
   /**
    * Calculate item price including tax.
    * Changed from simple multiplication to include tax calculation
    * as per new tax compliance requirements (FR-042).
    */
   function calculatePrice(item: Item): number {
     return (item.basePrice * item.quantity) * (1 + item.taxRate)
   }
   ```

4. **Service-Adapter Pattern Replacement**:
   ```typescript
   // ❌ WRONG: Keeping old service method
   class UserService {
     // Legacy method - DO NOT USE
     async getUserDataOld(id: string) { ... }
     
     // New method
     async findById(id: string) { ... }
   }
   
   // ✅ CORRECT: Only new implementation exists
   /**
    * User service following service-adapter pattern.
    * Migrated from mixed-concern service to pure business logic.
    * All contract transformations moved to UserAdapterService.
    */
   class UserService {
     async findById(id: string): Promise<User | null> { ... }
     async getStats(userId: string): Promise<UserStats> { ... }
   }
   ```

5. **Database Schema Migration**:
   ```typescript
   // ❌ WRONG: Keeping old columns
   export const users = pgTable('users', {
     id: text('id').primaryKey(),
     full_name: text('full_name'),        // Old column
     firstName: text('first_name'),        // New column
     lastName: text('last_name'),          // New column
   })
   
   // ✅ CORRECT: Only new schema (old columns removed in migration)
   /**
    * Users table schema.
    * Migration 2025-01-12: Replaced full_name with firstName/lastName
    * to support better internationalization and display names.
    */
   export const users = pgTable('users', {
     id: text('id').primaryKey(),
     firstName: text('first_name').notNull(),
     lastName: text('last_name').notNull(),
   })
   ```

6. **Frontend Component Replacement**:
   ```typescript
   // ❌ WRONG: Multiple versions of same component
   export function UserCardOld({ user }: Props) { ... }
   export function UserCard({ user }: Props) { ... }
   
   // ✅ CORRECT: Single implementation
   /**
    * User card component with avatar and status badge.
    * Replaced inline styles with Tailwind classes for consistency.
    * Now uses Shadcn Card component instead of custom div structure.
    */
   export function UserCard({ user }: Props) { ... }
   ```

**When Comments Are Required:**

- ✅ **Architectural pattern changes** (e.g., moving from services to service-adapter pattern)
- ✅ **Database schema changes** (e.g., column renames, table splits)
- ✅ **Breaking API changes** (e.g., contract signature changes)
- ✅ **Algorithm replacements** (e.g., switching from A* to Dijkstra)
- ✅ **Security improvements** (e.g., replacing plain text with encryption)
- ❌ **Simple refactoring** (e.g., renaming variables, extracting functions)
- ❌ **Code formatting** (e.g., Prettier changes)
- ❌ **Dependency updates** (e.g., library version bumps)

**Comment Structure (when needed):**

```typescript
/**
 * [Brief description of what the code does]
 * 
 * REPLACED: [What was replaced and why]
 * - Previous: [Brief description of old approach]
 * - Current: [Brief description of new approach]
 * - Rationale: [Why the change was made - reference FR/spec if applicable]
 * 
 * @example
 * // Usage example if not obvious
 */
```

**Example with Complete Replacement:**

```typescript
// ❌ BEFORE (what to avoid):
class DeploymentService {
  // Old method - uses direct Docker calls
  async deployOld(config: any) {
    await docker.createContainer(config)
  }
  
  // New method - uses orchestration service
  async deploy(config: DeploymentConfig) {
    await this.orchestrationService.deploy(config)
  }
}

// ✅ AFTER (correct approach):
/**
 * Deployment service using orchestration layer.
 * 
 * REPLACED: Direct Docker SDK calls with OrchestrationService
 * - Previous: Called Docker SDK directly, no error recovery
 * - Current: Uses OrchestrationService for reconciliation support
 * - Rationale: Enables self-healing and multi-server coordination (Principle VII)
 */
class DeploymentService {
  constructor(
    private orchestrationService: OrchestrationService
  ) {}
  
  async deploy(config: DeploymentConfig): Promise<Deployment> {
    return this.orchestrationService.deploy(config)
  }
}
```

**Enforcement:**

- ❌ **Pull requests with legacy code alongside new code will be REJECTED**
- ❌ **Commented-out code blocks will be REJECTED** (except temporary debugging)
- ❌ **Functions/methods with `_old`, `_legacy`, `_deprecated` suffixes will be REJECTED**
- ✅ **Clean replacements with appropriate comments will be APPROVED**
- ✅ **Git history preserves old implementations** (no need to keep in code)

**Migration Workflow:**

1. **Implement new code** following current architectural patterns
2. **Add explanatory comments** if replacement is non-trivial
3. **Update all references** to use new implementation
4. **Remove old code completely** (no renaming, no commenting out)
5. **Run tests** to verify nothing broke
6. **Commit with clear message**: `refactor(scope): replace legacy X with Y`
7. **Document in PR**: Explain what was replaced and why

**Rationale**: 
- **Code Clarity**: One way to do things, not multiple deprecated paths
- **Maintainability**: No confusion about which implementation to use
- **Performance**: No dead code in production bundles
- **Onboarding**: New developers don't waste time on deprecated code
- **Git History**: Old implementations preserved in version control, not in codebase
- **Context Preservation**: Comments explain architectural decisions without code duplication

---

## Technology Stack Requirements

### Monorepo Structure (Turborepo)

**Apps:**
- `web/` - Next.js 15.4 frontend (App Router, React 19, TypeScript, Shadcn UI, Tailwind CSS)
- `api/` - NestJS backend (ORPC, Better Auth, Drizzle ORM, PostgreSQL, BullMQ)
- `doc/` - Documentation site (optional)

**Packages (Shared):**
- `api-contracts/` - ORPC type-safe API contracts
- `ui/` - Shadcn UI component library
- `types/` - Shared TypeScript types
- `eslint-config/`, `prettier-config/`, `tailwind-config/`, `tsconfig/` - Shared configurations

**Remote Caching:**
- Turborepo with Vercel remote caching enabled
- `TURBO_TOKEN` and `TURBO_TEAM` configured for CI/CD
- Dramatically faster builds and test execution

### Backend Requirements

**Framework**: NestJS with TypeScript strict mode  
**API Layer**: ORPC for end-to-end type-safe API contracts  
**Authentication**: Better Auth with JWT sessions  
**Database**: PostgreSQL 14+ with Drizzle ORM  
**Job Queue**: BullMQ with Redis  
**Orchestration**: Docker SDK for container management  
**Reverse Proxy**: Traefik integration for routing  
**Encryption**: Custom Drizzle column types for sensitive data

**Testing**: Vitest (NOT `bun test`, `deno test`, or other runners)
- Commands: `bun run test`, `npm run test`, `npx vitest`, `bun x vitest`
- NEVER use `bun test` (different test runner)

### Frontend Requirements

**Framework**: Next.js 15.4+ (App Router)  
**UI Library**: Shadcn UI with Tailwind CSS  
**State Management**: React Query (server state) + Zustand (UI state)  
**Routing**: Declarative Routing system (type-safe)  
**API Client**: ORPC with React Query integration  
**Authentication**: Better Auth client hooks

### Infrastructure Requirements

**Development**: Docker Compose with service isolation  
**Production**: Docker Swarm Mode OR Kubernetes (configurable)  
**Networking**: Overlay networks per project  
**Storage**: Named volumes with atomic deployment patterns  
**Monitoring**: Health checks, structured logging, metrics collection  
**CI/CD**: Automated testing, linting, type-checking, deployment

---

## Development Workflow Standards

### File Management Policy

**⚠️ NEVER delete or remove files without explicit user permission:**
- Always ask before deleting any files
- When reorganizing code, preserve existing functionality by migrating content properly
- If files need to be removed, explicitly request permission and explain why
- NEVER use `rm`, `git rm`, or file deletion commands without user approval

### API Development Workflow (Required Order)

**When creating new API endpoints:**

1. **Generate Contract** (First Step):
   ```bash
   # Edit packages/api-contracts/index.ts
   # Add new ORPC procedure definitions
   ```

2. **Create NestJS Implementation** (Required Order):
   - **Repository**: Database access layer
   - **Service**: Business logic layer
   - **Adapter**: Contract transformation layer (in `adapters/` folder)
   - **Controller**: HTTP endpoint layer

3. **Type Definitions**:
   - Extract contract types in `interfaces/[feature].types.ts`
   - Import types in adapters and controllers

**Standard API Development Process**:
```typescript
// 1. Define contract in packages/api-contracts/index.ts
export const userRouter = {
  getUsers: procedure.query(),
  createUser: procedure.input(z.object({...})).mutation()
}

// 2. Create types in interfaces/user.types.ts
export type UserContract = typeof userContract.getById.output

// 3. Create Repository (database access)
@Injectable()
export class UserRepository {
  // Database operations
}

// 4. Create Service (business logic)
@Injectable()
export class UserService {
  constructor(private userRepository: UserRepository) {}
  // Returns entities, not contracts
  async findById(id: string): Promise<User | null> { ... }
}

// 5. Create Adapter (in adapters/ folder)
@Injectable()
export class UserAdapterService {
  adaptToContract(user: User): UserContract { ... }
}

// 6. Create Controller (orchestration)
@Controller()
export class UserController {
  constructor(
    private userService: UserService,
    private userAdapter: UserAdapterService
  ) {}
  
  @Implement(userContract.getById)
  async getById(input: { id: string }) {
    const user = await this.userService.findById(input.id)
    return this.userAdapter.adaptToContract(user)
  }
}
```

### Frontend Development Workflow

**Before implementing any frontend feature:**

1. Read `docs/concepts/FRONTEND-DEVELOPMENT-PATTERNS.md`
2. Use ORPC with `queryOptions` pattern for API calls
3. Use Better Auth hooks for authentication
4. Use Declarative Routing for navigation
5. Extract logic to custom hooks in `apps/web/src/hooks/`
6. Handle all component states (loading, error, empty, success)
7. Invalidate queries after mutations

**Custom Hook Structure:**
```typescript
// hooks/useProjects.ts
export function useProjects() {
  return useQuery(orpc.project.list.queryOptions({ input: {} }))
}

export function useCreateProject() {
  const queryClient = useQueryClient()
  return useMutation(orpc.project.create.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: orpc.project.list.getQueryKey({}) 
      })
    },
  }))
}
```

### Testing Strategy

**Unit Tests** (Vitest):
- Core services tested with pure entities
- Adapters tested with mock entities (no service mocking)
- Controllers tested with mocked services and adapters
- Coverage threshold: 75%

**Integration Tests** (Vitest):
- ORPC contracts ensure API compatibility
- Database operations with test database
- Provider and builder workflows

**E2E Tests** (Playwright):
- Critical user flows
- Authentication and authorization
- Deployment workflows

**Commands**:
```bash
bun run test              # All tests
bun run test:coverage     # Coverage across monorepo
npx vitest run            # Direct vitest execution
```

### Route Generation

**When to regenerate routes:**
- Route file/folder renamed or moved
- Route parameters added/removed/renamed
- New routes added
- Route metadata changed in `page.info.ts`

**Commands**:
```bash
bun run web -- dr:build         # Generate routes
bun run web -- dr:build:watch   # Watch mode
```

### Database Operations

**CRITICAL RULES - Migration Generation:**

1. **NEVER Create Migration Files Directly**:
   - ❌ FORBIDDEN: Manually creating files in `apps/api/src/config/drizzle/migrations/`
   - ❌ FORBIDDEN: Manually editing migration SQL files
   - ❌ FORBIDDEN: Manually editing snapshot files in `migrations/meta/`
   - ✅ MANDATORY: Always use `bun run api -- db:generate` to create migrations
   - ✅ MANDATORY: Let Drizzle Kit generate migration files automatically

2. **Migration Generation Workflow**:
   ```bash
   # 1. Modify schema in apps/api/src/config/drizzle/schema/
   # Example: Add new column, create new table, modify constraints
   
   # 2. Generate migration (MANDATORY - never skip this)
   bun run api -- db:generate
   # This creates:
   # - apps/api/src/config/drizzle/migrations/0001_migration_name.sql
   # - apps/api/src/config/drizzle/migrations/meta/0001_snapshot.json
   # - Updates apps/api/src/config/drizzle/migrations/meta/_journal.json
   
   # 3. Review generated migration SQL (verify correctness)
   # Check the generated SQL matches your intended schema changes
   
   # 4. Apply migration to development database (container-based)
   bun run api -- db:push
   # OR for production-like testing:
   bun run api -- db:migrate
   ```

3. **Removing Migrations (When Needed)**:
   ```bash
   # If you need to remove a migration that hasn't been applied to production:
   
   # Step 1: Delete the migration SQL file
   rm apps/api/src/config/drizzle/migrations/0001_migration_name.sql
   
   # Step 2: Delete the corresponding snapshot
   rm apps/api/src/config/drizzle/migrations/meta/0001_snapshot.json
   
   # Step 3: Remove entry from journal
   # Edit apps/api/src/config/drizzle/migrations/meta/_journal.json
   # Remove the entry for this migration from the "entries" array
   
   # Step 4: Regenerate migration with corrected schema
   bun run api -- db:generate
   ```

   **⚠️ WARNING**: Only remove migrations that have NOT been applied to production.
   For production migrations, create a new migration to revert changes.

4. **Better Auth Plugin Changes**:
   ```bash
   # When adding or removing Better Auth plugins:
   
   # 1. Modify apps/api/src/auth.ts
   # Add or remove plugins from betterAuth() configuration
   
   # 2. Generate auth types and migrations (MANDATORY)
   bun run api -- auth:generate
   # This updates:
   # - Type definitions for auth
   # - Database schema if plugins require new tables/columns
   
   # 3. If schema changed, generate database migration
   bun run api -- db:generate
   
   # 4. Apply changes to database
   bun run api -- db:push
   ```

**Development Commands**:
```bash
bun run api -- db:generate    # Generate migration from schema changes
bun run api -- db:push        # Push schema to dev database (CONTAINER ONLY)
bun run api -- db:migrate     # Run migrations (RARELY NEEDED - see below)
bun run api -- db:seed        # Seed test data (RARELY NEEDED - see below)
bun run api -- db:studio      # Database admin UI (CONTAINER ONLY)
bun run api -- auth:generate  # Generate auth types/migrations after plugin changes
```

**CRITICAL - Migration & Seed Execution Rules**:

**`db:migrate` - Automatic Execution**:
- ❌ **DO NOT RUN** on local machine (outside container)
- ⚠️ **RARELY NEEDED** - Migrations run automatically on container start
- ✅ **Container handles it**: When dev container starts, migrations run automatically
- 🔧 **Manual run only if**: 
  * Container is already running AND new migrations were generated
  * Run inside container: `docker exec -it deployer-api-1 bun run db:migrate`
  * OR restart container: `bun run dev:api` (migrations run on startup)

**`db:seed` - Automatic Execution**:
- ❌ **NEVER RUN** on local machine (outside container)
- ❌ **NEVER RUN** in running dev container (data already seeded)
- ✅ **Automatic seeding**: Runs when container starts with fresh/unmounted volumes
- 🔄 **To re-seed data**:
  ```bash
  # Stop containers and remove volumes
  docker compose down -v
  
  # Start fresh (migrations + seed run automatically)
  bun run dev:api
  ```
- 🔧 **Manual run only if**:
  * Seed data changed significantly AND you need it immediately
  * Container is running AND you want to re-seed without restart
  * Run inside container: `docker exec -it deployer-api-1 bun run db:seed`
  * **WARNING**: This may duplicate data or cause conflicts

**Recommended Workflows**:

```bash
# Scenario 1: Generated new migration
# Option A (recommended): Restart container
bun run dev:api  # Migrations run automatically on startup

# Option B: Manual run in running container (if you don't want to restart)
docker exec -it deployer-api-1 bun run db:migrate

# Scenario 2: Need fresh seed data
# Only option: Recreate volumes
docker compose down -v
bun run dev:api  # Migrations + seed run automatically

# Scenario 3: Iterating on migrations (development)
# Use db:push instead of db:migrate for faster iteration
bun run api -- db:generate
bun run api -- db:push  # Directly updates schema without migration files
```

**Why Automatic Execution?**:
- **Prevents drift**: Database always in sync with code on container start
- **Zero manual steps**: Developers don't forget to run migrations
- **Fresh environments**: New team members get seeded data automatically
- **Production parity**: Same auto-migration pattern used in production deployments
- **Idempotent**: Migrations track what's applied, safe to run multiple times

**Production Migration Workflow**:
```bash
# 1. Develop and test migration locally
bun run api -- db:generate
bun run api -- db:migrate

# 2. Commit migration files to git
git add apps/api/src/config/drizzle/migrations/
git commit -m "feat(db): add user_preferences table"

# 3. Deploy to production
# Migration runs automatically via deployment pipeline
# OR manually: bun run api -- db:migrate
```

**Rationale**:
- **Generated Migrations**: Drizzle Kit ensures SQL correctness and snapshot consistency
- **No Manual Editing**: Prevents SQL errors, missing constraints, snapshot mismatches
- **Journal Integrity**: _journal.json tracks migration order and dependencies
- **Reproducibility**: Same schema changes always generate same migrations
- **Type Safety**: Generated snapshots keep schema and TypeScript types in sync

### Commit Standards

**Follow Conventional Commits:**
- `feat(scope):` - New features
- `fix(scope):` - Bug fixes
- `chore(scope):` - Maintenance tasks
- `refactor(scope):` - Code refactoring
- `docs(scope):` - Documentation
- `test(scope):` - Testing

**Examples**:
- `feat(deployment): Add GitHub provider integration`
- `fix(traefik): Resolve SSL certificate generation issue`
- `refactor(service-adapter): Implement service-adapter pattern for projects`

---

## Documentation Maintenance

**CRITICAL**: Keep documentation accurate and up-to-date.

**When to Update Documentation:**

1. Add/Modify API Endpoints → Update `docs/ORPC-TYPE-CONTRACTS.md`
2. Change Environment Variables → Update `docs/GETTING-STARTED.md`, `docs/ENVIRONMENT-TEMPLATE-SYSTEM.md`
3. Modify Docker Configuration → Update `docs/DOCKER-BUILD-STRATEGIES.md`
4. Update Dependencies → Update `docs/TECH-STACK.md` with versions and rationale
5. Change Database Schema → Update `docs/DEVELOPMENT-WORKFLOW.md`
6. Add/Remove Routes → Update `apps/web/src/routes/README.md`
7. Modify Authentication Flow → Update `docs/ARCHITECTURE.md`
8. Change Testing Setup → Update `docs/TESTING.md`
9. Alter Deployment Procedures → Update deployment guides
10. Add New Features → Create or update relevant documentation sections

**New Concept Documentation Protocol:**

When introducing ANY new concept, pattern, technology, or approach:

1. **Determine Documentation Scope**:
   - Minor Enhancement: Update existing documentation section
   - Major Feature: Create dedicated documentation file in `docs/`
   - Cross-cutting Concern: Update multiple related documentation files

2. **Create/Update Documentation** using established templates

3. **Update Reference Systems**:
   - Add to `docs/README.md` under appropriate category
   - Update Quick Reference table if applicable
   - Update `.github/copilot-instructions.md` Development Patterns section

**Documentation Quality Standards:**
- Be specific with exact commands, file paths, code examples
- Stay current (remove deprecated information)
- Cross-reference related documentation
- Include context (explain not just what, but why and when)
- Test examples to ensure they work

---

## Governance

### Amendment Procedure

**Constitution amendments require:**

1. **Proposal**: Document proposed change with rationale
2. **Impact Analysis**: Assess effect on existing codebase and workflows
3. **Review**: Team review and discussion
4. **Approval**: Consensus or designated authority approval
5. **Migration Plan**: Document migration strategy for existing code
6. **Version Bump**: 
   - MAJOR: Backward incompatible principle removals/redefinitions
   - MINOR: New principle/section added or materially expanded
   - PATCH: Clarifications, wording, typo fixes

**Amendment Process:**
1. Create proposal document explaining change
2. Update this constitution with proposed changes
3. Update version number according to semver rules
4. Update `LAST_AMENDED_DATE`
5. Add Sync Impact Report as HTML comment at top
6. Update dependent templates and documentation
7. Commit with message: `docs: amend constitution to vX.Y.Z (summary of changes)`

### Compliance & Enforcement

**All development work must:**
- ✅ Verify compliance with this constitution before implementation
- ✅ Read relevant documentation first (Principle I)
- ✅ Follow architectural patterns (Principles IV, V, VI)
- ✅ Maintain type safety (Principle II)
- ✅ Use Docker-first approach (Principle III)
- ✅ Document new concepts (Documentation Maintenance)
- ✅ Pass automated checks (tests, linting, type-checking)

**Code Review Checklist:**
- [ ] Documentation read before implementation?
- [ ] Type safety maintained throughout?
- [ ] Service-Adapter pattern followed correctly?
- [ ] Core vs Feature boundaries respected?
- [ ] Multi-tenant isolation considerations addressed?
- [ ] Error handling and reconciliation implemented?
- [ ] Tests written with appropriate coverage?
- [ ] Documentation updated for new concepts?

**Complexity Justification:**
- Any deviation from established patterns requires explicit justification
- Architectural decisions must be documented
- Trade-offs must be explained and approved

**Runtime Guidance:**
- Refer to `.github/copilot-instructions.md` for AI development guidance
- Use `docs/README.md` as primary documentation navigation
- Follow `docs/guides/DEVELOPMENT-WORKFLOW.md` for daily tasks

---

**Version**: 1.2.2 | **Ratified**: 2025-10-11 | **Last Amended**: 2025-01-12