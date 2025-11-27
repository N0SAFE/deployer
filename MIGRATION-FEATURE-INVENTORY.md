# Universal Deployment Platform - Migration Feature Inventory

## Overview
This document provides a comprehensive inventory of all features in the current Universal Deployment Platform that need to be migrated to the clean nextjs-nestjs-turborepo-template base.

**Migration Goal**: Preserve ALL features and UI while improving architecture with Service-Adapter-Repository pattern.

---

## 1. API Modules (NestJS Backend)

### Core Foundation (3 modules)
- ✅ **User Module** - STANDARDIZED (Service-Adapter pattern complete)
  - Controllers: 1 (user.controller.ts)
  - Endpoints: User CRUD, profile management, email verification
  - Status: Production-ready with Service-Adapter-Repository pattern

- 🚧 **Health Module** - NEEDS STANDARDIZATION
  - Controllers: 2 (health.controller.ts, health-monitor.controller.ts)
  - Endpoints: System health checks, component health monitoring
  - Status: Functional but needs pattern standardization

- 📦 **Setup Module** - NEEDS MIGRATION
  - Controllers: 1 (setup.controller.ts)
  - Endpoints: Initial platform configuration
  - Status: Needs full migration

### Project Management (5 modules)
- 🚧 **Project Module** - IN PROGRESS (35+ endpoints)
  - Controllers: 1 (project.controller.ts)
  - Endpoints: Project CRUD, settings, team management
  - Status: Standardization in progress (6-8 hours estimated)

- 📦 **Service Module** - NEEDS MIGRATION
  - Controllers: 1 (service.controller.ts)
  - Endpoints: Service definitions, configurations within projects
  - Status: High priority for standardization

- 📦 **Environment Module** - NEEDS MIGRATION
  - Controllers: 1 (environment.controller.ts)
  - Endpoints: Environment variables, secrets management
  - Status: Needs Service-Adapter pattern

- 📦 **Domain Module** - NEEDS MIGRATION
  - Controllers: (implicit in other modules)
  - Endpoints: Multi-level domain management (org, project, service)
  - Status: Needs dedicated module and standardization

- 📦 **Deployment Module** - CRITICAL PRIORITY
  - Controllers: 2 (deployment.controller.ts, deployment-rules.controller.ts)
  - Endpoints: Primary deployment operations, triggers, monitoring, logs, rollback
  - Features: Health monitoring, detailed status, unhealthy restart
  - Status: High complexity, needs careful migration

### CI/CD Operations (3 modules)
- 📦 **CI/CD Module** - NEEDS MIGRATION
  - Controllers: 1 (ci-cd.controller.ts)
  - Endpoints: Pipeline automation, builds, webhooks
  - Status: Medium priority for standardization

- 📦 **GitHub OAuth Module** - NEEDS MIGRATION
  - Controllers: 1 (github-oauth.controller.ts)
  - Endpoints: GitHub authentication, repository access
  - Status: Needs migration with Better Auth integration

- 📦 **GitHub Webhook Module** - NEEDS MIGRATION
  - Controllers: 1 (github-webhook.controller.ts)
  - Endpoints: GitHub webhook handling for auto-deployments
  - Status: Needs migration with event handling

### Infrastructure Management (4 modules)
- 📦 **Traefik Module** - NEEDS MIGRATION
  - Controllers: 1 (traefik.controller.ts)
  - Endpoints: Load balancer, domain management, SSL configuration
  - Status: Critical for deployment functionality

- ✅ **Orchestration Module** - COMPLETE INFRASTRUCTURE
  - Controllers: 2 (orchestration.controller.ts, orchestration-orpc.controller.ts)
  - Endpoints: Docker Swarm orchestration, resource management
  - Features: Container orchestration, service instances, network assignments, resource allocations
  - Status: Infrastructure complete, may need pattern standardization

- 📦 **Storage Module** - NEEDS MIGRATION
  - Controllers: 2 (storage.controller.ts, upload.controller.ts)
  - Endpoints: File storage, artifacts, backup management
  - Features: Backup creation, listing, restoration, deletion, download
  - Status: Complex, needs full migration

- 📦 **Static File Module** - NEEDS MIGRATION
  - Controllers: 1 (static-file.controller.ts)
  - Endpoints: Static file deployment with nginx containers
  - Status: Needs migration with orchestration integration

### Monitoring & Configuration (3 modules)
- 📦 **Analytics Module** - NEEDS MIGRATION
  - Controllers: 1 (analytics.controller.ts)
  - Endpoints: Platform usage analytics, performance metrics
  - Status: Lower priority, can be migrated later

- 📦 **WebSocket Module** - NEEDS MIGRATION
  - Controllers: 1 (deployment.controller.ts in websocket/)
  - Endpoints: Real-time deployment updates
  - Status: Critical for live UI updates

- 📦 **Provider Schema Module** - NEEDS MIGRATION
  - Controllers: 1 (provider-schema.controller.ts)
  - Endpoints: Dynamic form generation for providers/builders
  - Status: Needed for flexible configuration UI

### Job Processing (1 module)
- 📦 **Jobs Module** - NEEDS MIGRATION
  - Controllers: None (background processing)
  - Features: Bull Queue integration for deployment workflows
  - Status: Needs migration with Bull setup

### Support Modules (2 modules)
- 📦 **Bootstrap Module** - NEEDS MIGRATION
  - Purpose: Application initialization and setup
  - Status: Needs migration

- 📦 **Providers Module** - NEEDS MIGRATION
  - Purpose: Shared provider services
  - Status: Needs migration

---

## 2. Database Schema (Drizzle ORM)

### Existing Schema Files
1. **auth.ts** - User authentication and sessions (Better Auth)
2. **deployment.ts** - Deployment lifecycle management
3. **domain.ts** - Multi-level domain management
4. **environment.ts** - Environment variables and secrets
5. **github-provider.ts** - GitHub integration data
6. **health.ts** - Health monitoring tables
7. **orchestration.ts** - Docker Swarm orchestration (7 tables)
   - orchestration_stacks
   - service_instances
   - network_assignments
   - resource_allocations
   - ssl_certificates
8. **resource-monitoring.ts** - Resource usage metrics
9. **system.ts** - System-wide configuration
10. **traefik.ts** - Traefik load balancer configuration
11. **traefik-service.ts** - Traefik service definitions
12. **traefik-templates.ts** - Traefik configuration templates

### Additional Schema Needs
- Projects table (references in code but not in schema files found)
- Services table (references in code but not in schema files found)
- CI/CD pipelines table
- Webhooks table
- Job queue tables (Bull integration)
- Analytics/metrics tables
- Team/organization tables

---

## 3. ORPC API Contracts (Type-Safe Contracts)

### Main Contract Router (appContract)
Located in: `packages/api-contracts/index.ts`

**Core Foundation:**
- `health`: System health monitoring and status checks
- `user`: User management and authentication
- `setup`: Initial application setup and configuration

**Project Management:**
- `project`: Project lifecycle management and settings
- `service`: Service definitions and configurations within projects
- `environment`: Environment management and variable configuration
- `domain`: Multi-level domain management (org, project, service)

**Deployment Operations:**
- `deployment`: Primary deployment operations (trigger, monitor, logs, rollback)
- `ciCd`: Advanced CI/CD pipeline automation (pipelines, builds, webhooks)

**Infrastructure:**
- `traefik`: Load balancer, domain management, SSL configuration
- `orchestration`: Container orchestration and resource management
- `storage`: File storage, artifacts, and backup management
- `staticFile`: Static file deployment with nginx containers

**Monitoring & Analytics:**
- `analytics`: Platform usage analytics and performance metrics
- `variableResolver`: Dynamic configuration and variable resolution

**Configuration:**
- `providerSchema`: Provider and builder schema management for dynamic forms

### Individual Contract Files
- Deployment health monitoring contracts (health.ts)
- Deployment rollback contracts (rollback.ts)
- Storage backup contracts (backup.ts)
- User contracts (index.ts, count.ts, delete.ts, checkEmail.ts)
- Health check contracts (check.ts)
- All other module-specific contracts

---

## 4. Frontend Components (React/Next.js)

### Component Directory Structure
Located in: `apps/web/src/components/`

#### Dashboard Components (`/dashboard/`)
- **ProjectDashboard.tsx** - Main orchestrating dashboard
  - Quick actions: service creation, deployment, team management
  - Platform features overview cards
  - Integration hub for all dialogs

#### Project Management (`/project/`)
- **ProjectDetailPage.tsx** - Comprehensive project overview
  - Tabbed interface: Overview, Services, Deployments, Team, Settings
  - Service cards display
  - Recent deployments overview
  - Team member management
  - Environment variables

#### Service Management (`/services/`, `/service-management/`)
- **ServiceCard.tsx** - Individual service display
  - Status indicators (running, stopped, deploying, error)
  - Quick actions: settings, deploy, view, delete
  - Resource usage (CPU, memory)
  - Last deployment info
  - Health check status

- **ServiceForm.tsx** - Service creation/editing
  - Basic info (name, description, enabled)
  - Docker config (Dockerfile, port, health check)
  - Domain config (subdomain, custom domain)
  - Resource limits (CPU, memory)
  - Environment variables with secrets
  - Build arguments

#### Deployment Management (`/deployments/`, `/deployment-config/`)
- **DeploymentCard.tsx** - Deployment display
  - Status with progress indicators
  - Build and deployment time tracking
  - Environment and source info
  - Quick actions: retry, cancel, view logs
  - Real-time status updates

- **DeploymentSourceForm.tsx** - Multi-source deployment config
  - Multi-source support: Git repos, file uploads
  - Git providers: GitHub, GitLab, generic Git
  - Build config: Custom Dockerfile, build/start commands
  - Environment variables with runtime config
  - Preview deployments: Auto subdomains, custom domains
  - Configuration summary before deployment

#### Infrastructure Components
- **OrchestrationDashboard** (`/orchestration/`)
  - Docker Swarm orchestration view
  - Resource management
  - Service instances monitoring

- **TraefikDashboard** (`/traefik/`)
  - Load balancer management
  - Domain configuration
  - SSL certificate handling

- **StorageDashboard** (`/storage/`)
  - File storage management
  - Backup operations
  - Artifact handling

- **SystemHealthDashboard** (location TBD)
  - Overall system health
  - Component status monitoring

#### CI/CD Components (`/cicd/`)
- **CICDDashboard** - Pipeline automation interface
  - Pipeline management
  - Build history
  - Webhook configuration

#### Environment Management (`/environment/`)
- **EnvironmentDashboard** - Environment variable management
  - Variable creation/editing
  - Secret management
  - Multi-environment support

#### Activity Tracking (`/activity/`)
- **ActivityFeed.tsx** - Real-time activity monitoring
  - Activity types: deployments, commits, team changes, uploads
  - Status indicators with icons/colors
  - Timeline view with timestamps
  - User attribution
  - Activity filtering

#### Team Management (`/team-management/`)
- **TeamManagement.tsx** - Collaboration and access control
  - Role-based access: Owner, Admin, Developer, Viewer
  - Team statistics by role
  - Member invitation with email
  - Role management
  - Member removal (with restrictions)
  - Permissions overview

#### Domain Management (`/domains/`)
- Domain components (needs inventory)

#### Analytics (`/analytics/`)
- Analytics components (needs inventory)

#### Other Components
- **JobManagementInterface** - Bull Queue job monitoring
- **NewDeploymentDialog** - Quick deployment creation
- Various form and dialog components

### Component Features Summary
- **Multi-source deployments**: GitHub, GitLab, Git URL, ZIP upload
- **Preview environments**: Configurable base domains, auto subdomains, custom domains
- **Service orchestration**: Dependency tracking, health checks, resource limits
- **Team collaboration**: RBAC, invitations, activity tracking
- **Real-time updates**: WebSocket integration
- **Responsive design**: Shadcn UI + Tailwind CSS

---

## 5. Frontend Pages (Next.js App Router)

### Page Structure
Located in: `apps/web/src/app/`

#### Main Pages
- `/` - Landing/home page
- `/dashboard` - Main dashboard
- `/projects` - Projects list
- `/projects/[projectId]` - Project detail with tabs
- `/services` - Services list
- `/services/[serviceId]` - Service detail
- `/deployments` - Global deployments view (uses real API data)

#### Auth Pages
- `/auth/*` - Authentication flows

#### Organization Pages
- `/organization/*` - Organization management

#### Profile Pages
- `/profile/*` - User profile management

#### Setup Pages
- `/setup/*` - Initial platform setup

### Page Features
- **Nested routing** - Tab-based interfaces
- **Dynamic routes** - Project/service/deployment IDs
- **Server components** - Next.js 15 App Router
- **Real API integration** - No mock data (recent migration completed)
- **Declarative routing** - Type-safe navigation

---

## 6. Custom Hooks (React Query Integration)

Located in: `apps/web/src/hooks/`

### Available Hooks
1. **useActivity.ts** - Activity feed data
2. **useAnalytics.ts** - Analytics metrics
3. **useCICD.ts** - CI/CD pipeline data
4. **useDeployments.ts** - Deployment operations
5. **useEnvironment.ts** - Environment variables
6. **useHealth.ts** - System health data
7. **useProjectServiceHealth.ts** - Project/service specific health
8. **useProjects.ts** - Project management
9. **useProviderBuilder.ts** - Provider/builder schemas
10. **useServices.ts** - Service operations
11. **useStorage.ts** - Storage management
12. **useTeams.ts** - Team collaboration
13. **useTraefik.ts** - Traefik operations
14. **useTraefikConfig.ts** - Traefik configuration
15. **useUser.ts** - User management
16. **useWebSocket.ts** - Real-time updates

### Hook Features
- **React Query integration** - Automatic caching, refetching
- **ORPC client usage** - Type-safe API calls
- **Error handling** - Built-in error states
- **Loading states** - Automatic loading indicators
- **Optimistic updates** - Better UX

---

## 7. Shared Packages

### Current Packages
Located in: `packages/`

1. **api-contracts/** - ORPC type-safe contracts (CRITICAL)
   - All module contracts
   - Zod schemas
   - Type exports

2. **ui/** - Shadcn UI component library
   - Reusable React components
   - Tailwind CSS styling
   - Radix UI primitives

3. **types/** - Shared TypeScript types
   - Utility types
   - Common interfaces

4. **bin/** - CLI tools and scripts
   - Development utilities
   - Migration scripts

5. **eslint-config/** - Shared ESLint configuration
6. **prettier-config/** - Shared Prettier configuration
7. **tailwind-config/** - Shared Tailwind configuration
8. **tsconfig/** - Shared TypeScript configuration
9. **vitest-config/** - Shared test configuration
10. **mcp-repo-manager/** - Repository management tools
11. **env-template-prompter/** - Environment setup wizard

---

## 8. Infrastructure & DevOps

### Docker Configuration
- **docker-compose.yml** - Full dev environment
- **docker-compose.api.yml** - API-only dev
- **docker-compose.web.yml** - Web-only dev
- **docker-compose.prod.yml** - Production setup
- **docker-compose.api.prod.yml** - API production
- **docker-compose.web.prod.yml** - Web production

### Dockerfiles
- **Dockerfile.api.dev** - API development
- **Dockerfile.api.prod** - API production
- **Dockerfile.web.dev** - Web development
- **Dockerfile.web.build-time.prod** - Web production (build-time)
- **Dockerfile.web.runtime.prod** - Web production (runtime)
- **Dockerfile.doc.*.prod** - Documentation builds

### Services
- **PostgreSQL** - Primary database
- **Redis** - Queue and caching
- **Docker Swarm** - Container orchestration
- **Traefik v3.0** - Reverse proxy with auto SSL
- **Bull Queue** - Job processing

### Missing Dependencies
- `@nestjs/schedule` - For scheduled tasks
- `@nestjs/bull` - For queue processing

---

## 9. Documentation

### Existing Documentation
Located in: `docs/` and `.docs/`

#### Core Documentation
- **README.md** - Main documentation hub
- **APPLICATION-OVERVIEW.md** - Platform overview
- **HOW-IT-WORKS.md** - Architecture explanation
- **USER-GUIDE.md** - User documentation

#### Architecture Documentation
- Service-Adapter-Repository pattern docs
- Module organization guides
- API standardization roadmap

#### Specifications
- Environment specification
- Frontend specification
- Multi-deployment orchestration specification

#### Guides
- Getting started
- Development workflow
- Production deployment
- Testing guide

#### Memory Bank
- **projectbrief.md** - Project goals and requirements
- **productContext.md** - Product vision
- **activeContext.md** - Current work state
- **systemPatterns.md** - Architecture patterns
- **techContext.md** - Technology stack
- **progress.md** - Development progress

---

## 10. Configuration Files

### Environment Configuration
- **.env** - Main environment variables
- **.env.template** - Environment template with wizard
- **.env.api.prod.example** - API production example
- **.env.web.prod.example** - Web production example

### Build Configuration
- **turbo.json** - Turborepo pipeline configuration
- **bunfig.toml** - Bun configuration
- **tsconfig.json** - Root TypeScript configuration
- **vitest.config.ts** - Root test configuration

### Git Configuration
- **.gitignore** - Git ignore rules
- **.husky/** - Git hooks
- **.github/** - GitHub Actions workflows

---

## 11. Migration Priority Matrix

### Critical Path (Must Migrate First)
1. ✅ **User Module** - Already standardized (template for others)
2. 🚧 **Project Module** - In progress (foundation for features)
3. 📦 **Service Module** - High priority (core functionality)
4. 📦 **Deployment Module** - High priority (primary feature)
5. 📦 **Database Schema** - All tables needed
6. 📦 **ORPC Contracts** - Type safety foundation

### High Priority (Core Features)
7. 📦 **Orchestration Module** - Infrastructure ready, needs pattern
8. 📦 **Traefik Module** - Critical for deployments
9. 📦 **Environment Module** - Needed for configuration
10. 📦 **WebSocket Module** - Real-time UI updates
11. 📦 **Storage Module** - File/artifact management

### Medium Priority (Enhanced Features)
12. 📦 **CI/CD Module** - Advanced automation
13. 📦 **GitHub OAuth/Webhook** - GitHub integration
14. 📦 **Health Module** - Monitoring improvements
15. 📦 **Domain Module** - Domain management
16. 📦 **Static File Module** - Static deployments

### Lower Priority (Supporting Features)
17. 📦 **Analytics Module** - Usage insights
18. 📦 **Provider Schema Module** - Dynamic forms
19. 📦 **Jobs Module** - Background processing
20. 📦 **Setup Module** - Initial configuration

### UI Migration (Parallel Track)
21. 📦 **Core Components** - Dashboard, cards, forms
22. 📦 **Pages** - All application pages
23. 📦 **Hooks** - React Query integration
24. 📦 **Routing** - Declarative routes

---

## 12. Template Comparison

### Current Template Has (Keep)
- Clean Next.js 15.4 + NestJS 10.x base
- ORPC integration setup
- Better Auth configuration
- Drizzle ORM setup
- Docker development environment
- Turborepo monorepo structure
- Testing infrastructure (Vitest)
- Documentation system
- Service-Adapter pattern examples

### Current Platform Has (Migrate)
- 22+ API modules with extensive features
- Comprehensive database schema (14+ tables)
- Rich UI component library (20+ major components)
- Custom hooks for all features (16 hooks)
- Multi-source deployment system
- Docker Swarm orchestration
- Traefik reverse proxy integration
- Bull Queue job processing
- WebSocket real-time updates
- Team collaboration features
- Preview environment support
- CI/CD pipeline automation
- Storage and backup system
- Health monitoring infrastructure
- Analytics and metrics

---

## 13. Risks & Considerations

### Technical Risks
1. **Database Schema Migrations** - Must preserve all data relationships
2. **ORPC Contract Compatibility** - Maintain type safety across migration
3. **WebSocket Integration** - Real-time features must remain functional
4. **Docker Swarm Orchestration** - Complex infrastructure must be preserved
5. **Bull Queue Jobs** - Background processing must continue working

### Architectural Improvements
1. **Service-Adapter Pattern** - Apply to ALL modules (User module is template)
2. **Repository Ownership** - Proper service-to-service communication
3. **Better Error Handling** - Standardize error responses
4. **Improved Testing** - Unit tests for all modules
5. **Documentation Updates** - Keep docs in sync with architecture

### UI/UX Preservation
1. **No Visual Changes** - UI must remain identical
2. **Feature Parity** - All features must work the same
3. **Performance** - Should be equal or better
4. **Real-time Updates** - WebSocket functionality preserved

---

## 14. Success Criteria

### Migration Complete When:
- ✅ All 22+ API modules migrated with Service-Adapter pattern
- ✅ All database schema migrated with proper relations
- ✅ All ORPC contracts migrated and type-safe
- ✅ All UI components migrated with identical appearance
- ✅ All pages migrated with same functionality
- ✅ All custom hooks migrated with React Query
- ✅ Docker orchestration working (Swarm + Traefik)
- ✅ Bull Queue job processing functional
- ✅ WebSocket real-time updates working
- ✅ All tests passing (unit + integration)
- ✅ Documentation updated for new structure
- ✅ Development environment runs without errors
- ✅ Production build succeeds
- ✅ Zero regression in features or UI

---

## 15. Next Steps

1. **Verify Template Base** - Run `bun install` and `bun dev` in template
2. **Create Migration Branches** - Set up git branching strategy
3. **Start with Database** - Migrate all schema files first
4. **Migrate Contracts** - Port all ORPC contracts next
5. **Follow User Module Pattern** - Standardize API modules one by one
6. **Migrate UI Incrementally** - Components, then pages, then hooks
7. **Test Continuously** - Write tests as we migrate
8. **Document Changes** - Update Memory Bank and docs

---

**Document Version**: 1.0  
**Last Updated**: 2025-01-XX  
**Status**: Initial comprehensive inventory for migration planning
