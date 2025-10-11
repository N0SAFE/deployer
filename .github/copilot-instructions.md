# AI Coding Agent Instructions

This Next.js + NestJS turborepo uses modern patterns and conventions that require specific knowledge for effective development.

## 📚 CRITICAL: Documentation-First Development Workflow

**⚠️ BEFORE YOU DO ANYTHING - READ THE DOCUMENTATION**

This is the **MOST IMPORTANT** rule for this project. You MUST follow this workflow for EVERY task:

### Step 1: Always Read Documentation First

**Before writing ANY code, making ANY changes, or answering ANY questions:**

1. **Read `docs/README.md`** - Overview of all available documentation
2. **Read relevant concept documentation** from `docs/concepts/`
3. **Read relevant architecture documentation** from `docs/architecture/`
4. **Read relevant feature documentation** from `docs/features/`
5. **Read relevant specification** from `docs/specifications/`

**NEVER skip this step**. Even if you think you know the answer, **VERIFY IT IN THE DOCS FIRST**.

### Step 2: Keep Core Documentation in Memory

**You MUST have these documents loaded in your context at ALL times:**

#### Required Core Documents (Always Load)

1. **`docs/README.md`** - Documentation hub and navigation
   - Purpose: Understand what documentation exists and where to find it
   - When: At the start of EVERY conversation

2. **`docs/concepts/SERVICE-ADAPTER-PATTERN.md`** - Core architectural pattern
   - Purpose: Understand how to structure services, adapters, and controllers
   - When: Before creating/modifying any API endpoint or service
   - Key Rules:
     * Services return entities (not contracts)
     * Adapters in `adapters/` folder with fixed contract types
     * Types/interfaces in `interfaces/` folder
     * Controllers orchestrate and mix service methods

3. **`docs/concepts/FRONTEND-DEVELOPMENT-PATTERNS.md`** - Frontend development patterns
   - Purpose: Understand ORPC, Better Auth, and Declarative Routing patterns
   - When: Before creating/modifying any frontend component, hook, or page
   - Key Rules:
     * Use `useQuery(orpc.contract.queryOptions())` for API calls
     * Use Better Auth hooks for authentication (`useSession`, `signIn`, `signOut`)
     * Use Declarative Routing for navigation (`<Route.Link>`, `Route.fetch()`)
     * Extract logic to custom hooks in `hooks/` folder

4. **`docs/architecture/CORE-VS-FEATURE-ARCHITECTURE.md`** - Module organization
   - Purpose: Understand core vs feature module separation
   - When: Before creating any new module or service
   - Key Rules:
     * Core modules (`core/modules/`) = shared infrastructure
     * Feature modules (`modules/`) = HTTP endpoints and domain logic
     * Core modules NEVER import feature modules

5. **`docs/architecture/CORE-MODULE-ARCHITECTURE.md`** - Core module dependencies
   - Purpose: Avoid circular dependencies
   - When: Before importing modules or creating dependencies
   - Key Rules:
     * Never import `CoreModule` from core modules
     * Import only specific modules needed
     * Use `forwardRef()` only for proven circular dependencies

#### Specifications (Load When Relevant)

5. **`docs/specifications/ENVIRONMENT-SPECIFICATION.md`** - Environment variables
   - When: Working with configuration or environment variables

6. **`docs/specifications/FRONTEND-SPECIFICATION.md`** - Frontend architecture
   - When: Working on Next.js frontend code

7. **`docs/specifications/MULTI-DEPLOYMENT-ORCHESTRATION-SPECIFICATION.md`** - Deployment orchestration
   - When: Working on deployment-related features

### Step 3: Workflow for Every Task

```
┌─────────────────────────────────────────────┐
│ 1. User Request Received                    │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│ 2. READ docs/README.md                      │
│    - Identify relevant documentation        │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│ 3. READ Core Concepts                       │
│    - SERVICE-ADAPTER-PATTERN.md (backend)   │
│    - FRONTEND-DEVELOPMENT-PATTERNS.md (web) │
│    - CORE-VS-FEATURE-ARCHITECTURE.md        │
│    - CORE-MODULE-ARCHITECTURE.md            │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│ 4. READ Relevant Feature/Spec Docs          │
│    - Check docs/features/                   │
│    - Check docs/specifications/             │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│ 5. VERIFY Understanding                     │
│    - Do I know the correct pattern?         │
│    - Do I know the folder structure?        │
│    - Do I know the dependencies?            │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│ 6. IMPLEMENT Following Documentation        │
│    - Use exact patterns from docs           │
│    - Follow folder structures from docs     │
│    - Apply rules from docs                  │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│ 7. UPDATE Documentation (if needed)         │
│    - Document new concepts                  │
│    - Update affected docs                   │
└─────────────────────────────────────────────┘
```

### Examples: Documentation-First in Action

#### ❌ WRONG: Code Without Reading Docs

```typescript
// User: "Create a new user service"

// ❌ BAD - Writing code immediately without reading docs
@Injectable()
export class UserService {
  async getUserById(id: string): Promise<UserContract> {
    // This violates SERVICE-ADAPTER-PATTERN.md!
    // Services should return entities, not contracts
  }
}
```

#### ✅ CORRECT: Documentation-First Approach

```
1. READ docs/README.md
   → Found: SERVICE-ADAPTER-PATTERN.md in concepts/
   → Found: CORE-VS-FEATURE-ARCHITECTURE.md in architecture/

2. READ docs/concepts/SERVICE-ADAPTER-PATTERN.md
   → Learn: Services return entities (not contracts)
   → Learn: Adapters in adapters/ folder with fixed types
   → Learn: Types in interfaces/ folder
   → Learn: Controllers orchestrate multiple service methods

3. READ docs/architecture/CORE-VS-FEATURE-ARCHITECTURE.md
   → Learn: Should this be core or feature?
   → Decision: Feature module (HTTP endpoints for users)

4. IMPLEMENT with correct pattern:
```

```typescript
// ✅ GOOD - Following documentation patterns

// 1. Core service (if shared infrastructure)
apps/api/src/core/modules/user/services/user.service.ts
@Injectable()
export class UserService {
  async findById(id: string): Promise<User | null> { ... }
  async findByEmail(email: string): Promise<User | null> { ... }
}

// 2. Feature module structure
apps/api/src/modules/user/
├── adapters/
│   └── user-adapter.service.ts
├── controllers/
│   └── user.controller.ts
├── interfaces/
│   └── user.types.ts
└── user.module.ts

// 3. Types in interfaces/
apps/api/src/modules/user/interfaces/user.types.ts
export type UserContract = typeof userContract.getById.output;

// 4. Adapter in adapters/
apps/api/src/modules/user/adapters/user-adapter.service.ts
adaptUserToContract(user: User): UserContract { ... }

// 5. Controller orchestrates
apps/api/src/modules/user/controllers/user.controller.ts
async getById(input: { id: string }) {
  const user = await this.userService.findById(input.id);
  return this.adapter.adaptUserToContract(user);
}
```

### When Documentation is Missing or Unclear

If you cannot find documentation for a specific pattern or feature:

1. **Search existing docs** - Use grep/search to find similar patterns
2. **Ask the user** - Request clarification before implementing
3. **Document your decision** - Create new documentation following the template
4. **Update this file** - Add to Documentation References if it's a new concept

**NEVER** implement based on assumptions when documentation could exist.

### Documentation Loading Checklist

Before starting ANY task, verify:

- [ ] ✅ I have read `docs/README.md`
- [ ] ✅ I have loaded `SERVICE-ADAPTER-PATTERN.md` in my context
- [ ] ✅ I have loaded `FRONTEND-DEVELOPMENT-PATTERNS.md` in my context (for frontend work)
- [ ] ✅ I have loaded `CORE-VS-FEATURE-ARCHITECTURE.md` in my context
- [ ] ✅ I have loaded `CORE-MODULE-ARCHITECTURE.md` in my context
- [ ] ✅ I have identified and read all relevant feature/spec docs
- [ ] ✅ I understand the patterns required for this task
- [ ] ✅ I can implement following documented patterns

**If you cannot check all boxes, READ MORE DOCUMENTATION before proceeding.**

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
**⚠️ NEVER delete or remove files without explicit user permission:**
- Always ask before deleting any files, even if they appear redundant or outdated
- When reorganizing code, preserve existing functionality by migrating content properly
- If files need to be removed, explicitly request permission and explain why
- **NEVER** use `rm`, `git rm`, or file deletion commands without user approval

### 1. Docker-First Development
**Always use Docker commands for development:**
```bash
bun run dev              # Full stack (API + Web + DB + Redis)
bun run dev:api          # API only with database
bun run dev:web          # Web only (requires running API)
```
Never run `next dev` or `nest start` directly - services are containerized with proper networking.

### 2. Declarative Routing System
**Routes are type-safe and generated**, not manually written:
- Route definitions: `apps/web/src/app/**/page.info.ts`
- Generate routes: `bun run web -- dr:build` (required after route changes)
- Usage: `import { Home, ApiAuth } from '@/routes'` then `<Home.Link>` or `ApiAuth.fetch()`
- **Never** use raw `href` strings or manual `fetch()` calls

### 3. API Contracts with ORPC
**Shared type-safe contracts between frontend/backend:**
- Contracts: `packages/api-contracts/index.ts`
- API implementation: `apps/api/src/` using ORPC decorators
- Client usage: Generated hooks via `@orpc/tanstack-query`
- Changes require rebuilding web app: `bun run web -- generate`

### 4. Better Auth Development Workflow
**Plugin addition and auth generation:**
```bash
# When adding new Better Auth plugins
bun run --cwd apps/api auth:generate    # Generate auth configuration
```

### 5. API Development Workflow
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

### 6. Shared Package System
**Internal packages use workspace references:**
```json
"@repo/ui": "*"           // Not published packages
"@repo/api-contracts": "*" // Shared between apps
```
Import like: `import { Button } from '@repo/ui'`

### 7. Environment Configuration
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
- **Initial Setup**: [`docs/GETTING-STARTED.md`](../docs/GETTING-STARTED.md) - Complete setup guide with prerequisites and environment configuration
- **Project Architecture**: [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) - System design, component relationships, and data flows
- **Technology Stack**: [`docs/TECH-STACK.md`](../docs/TECH-STACK.md) - Detailed technology choices and version information

### 🛠️ **Development Workflows**
- **Daily Development**: [`docs/DEVELOPMENT-WORKFLOW.md`](../docs/DEVELOPMENT-WORKFLOW.md) - Day-to-day development tasks and best practices
- **API Contracts**: [`docs/ORPC-TYPE-CONTRACTS.md`](../docs/ORPC-TYPE-CONTRACTS.md) - ORPC type-safe API development and usage patterns
- **Declarative Routing**: [`apps/web/src/routes/README.md`](../apps/web/src/routes/README.md) - Type-safe routing system usage and examples

### 🐳 **Docker & Deployment**
- **Docker Strategies**: [`docs/DOCKER-BUILD-STRATEGIES.md`](../docs/DOCKER-BUILD-STRATEGIES.md) - Development vs production Docker configurations
- **Production Deployment**: [`docs/PRODUCTION-DEPLOYMENT.md`](../docs/PRODUCTION-DEPLOYMENT.md) - Production environment setup and deployment strategies
- **Render Deployment**: [`docs/RENDER-DEPLOYMENT.md`](../docs/RENDER-DEPLOYMENT.md) - Platform-specific deployment guide for Render
- **Project Isolation**: [`docs/PROJECT-ISOLATION.md`](../docs/PROJECT-ISOLATION.md) - Running multiple project instances without conflicts

### ⚙️ **Configuration & Environment**
- **Environment Variables**: [`docs/ENVIRONMENT-TEMPLATE-SYSTEM.md`](../docs/ENVIRONMENT-TEMPLATE-SYSTEM.md) - Environment configuration and template system
- **Database Encryption**: [`docs/DATABASE-ENCRYPTION.md`](../docs/DATABASE-ENCRYPTION.md) - Automatic encryption/decryption for sensitive database fields
- **GitHub Copilot Setup**: [`docs/COPILOT-SETUP.md`](../docs/COPILOT-SETUP.md) - AI development environment configuration

### 🧪 **Testing & Quality**
- **Testing Guide**: [`docs/TESTING.md`](../docs/TESTING.md) - Testing strategies and test execution
- **Testing Implementation**: [`docs/TESTING-IMPLEMENTATION-SUMMARY.md`](../docs/TESTING-IMPLEMENTATION-SUMMARY.md) - Comprehensive testing setup details

### 📂 **Quick Reference for Common Tasks**

| Task | Documentation File | Key Section |
|------|-------------------|-------------|
| Setting up development environment | `docs/GETTING-STARTED.md` | Quick Start |
| Creating API endpoints | `docs/ORPC-TYPE-CONTRACTS.md` | API Implementation |
| Adding new pages | `apps/web/src/routes/README.md` | Using the routes |
| Database operations | `docs/DEVELOPMENT-WORKFLOW.md` | Working with Database |
| Encrypting sensitive database fields | `docs/DATABASE-ENCRYPTION.md` | Custom Column Type |
| Docker issues | `docs/DOCKER-BUILD-STRATEGIES.md` | Troubleshooting |
| Production deployment | `docs/PRODUCTION-DEPLOYMENT.md` | Production Environment Variables |
| Environment configuration | `docs/ENVIRONMENT-TEMPLATE-SYSTEM.md` | Template System |
| Testing setup | `docs/TESTING.md` | Running Tests |
| **Service health & rollback policy** | **`docs/DEPLOYMENT-HEALTH-RULES.md`** | **Health Calculation Rules** |
| **Static deployment status bug** | **`docs/STATIC-DEPLOYMENT-STATUS-BUG-FIX.md`** | **Health Monitor Fix** |

**Note**: Always check these documentation files for the most up-to-date and detailed information before implementing features or resolving issues.

## Documentation Maintenance

**IMPORTANT**: As an AI coding agent, you have a responsibility to keep documentation accurate and up-to-date. 

### When to Update Documentation

Update relevant documentation whenever you:

1. **Add/Modify API Endpoints**: Update `docs/ORPC-TYPE-CONTRACTS.md` and `docs/DEVELOPMENT-WORKFLOW.md`
2. **Change Environment Variables**: Update `docs/GETTING-STARTED.md`, `docs/ENVIRONMENT-TEMPLATE-SYSTEM.md`, and relevant deployment docs
3. **Modify Docker Configuration**: Update `docs/DOCKER-BUILD-STRATEGIES.md` and deployment guides
4. **Update Dependencies**: Update `docs/TECH-STACK.md` with new versions and rationale
5. **Change Database Schema**: Update `docs/DEVELOPMENT-WORKFLOW.md` database sections
6. **Add/Remove Routes**: Update `apps/web/src/routes/README.md` and routing documentation
7. **Modify Authentication Flow**: Update `docs/ARCHITECTURE.md` and setup guides
8. **Change Testing Setup**: Update `docs/TESTING.md` and testing documentation
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

3. **Architecture Documentation** (`docs/ARCHITECTURE.md`)
   - Update if it affects system architecture

4. **Tech Stack Documentation** (`docs/TECH-STACK.md`)
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