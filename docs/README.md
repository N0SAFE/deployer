# Documentation Home

Welcome to the documentation for this Next.js + NestJS deployment platform. This hub provides organized, accessible documentation across concepts, architecture, guides, and references.

> **Use case optimized for:** Docker-first deployment platform with multi-tenant support, GitHub integration, and automated deployment workflows.
>
> **Audience:** Full-stack developers building or maintaining the deployment platform.
>
> **Out of scope:** Platform-specific deployment details are in provider-specific guides.

## 📁 Documentation Structure

Our documentation is organized into focused directories:

- **📚 Concepts** - Core system concepts and patterns
- **🏗️ Architecture** - System design and architectural decisions
- **📖 Guides** - Step-by-step how-to documentation
- **🎯 Features** - Feature-specific implementation details
- **📋 Planning** - Roadmaps, TODOs, and implementation guides
- **📑 Reference** - API references, specs, and lookup documentation
- **📐 Specifications** - Detailed technical specifications
- **📦 Archive** - Historical and completed documentation

## 🧭 Quick Start Journey (Recommended Order)

1. **Bootstrap**: [`guides/GETTING-STARTED.md`](./guides/GETTING-STARTED.md) - Set up your development environment
2. **Understand**: [`architecture/ARCHITECTURE.md`](./architecture/ARCHITECTURE.md) + [`reference/TECH-STACK.md`](./reference/TECH-STACK.md) - System overview
3. **Configure**: [`reference/ENVIRONMENT-TEMPLATE-SYSTEM.md`](./reference/ENVIRONMENT-TEMPLATE-SYSTEM.md) - Environment setup
4. **Develop**: [`guides/DEVELOPMENT-WORKFLOW.md`](./guides/DEVELOPMENT-WORKFLOW.md) - Daily development tasks
5. **Test**: [`guides/TESTING.md`](./guides/TESTING.md) - Testing strategies and execution
6. **Deploy**: [`guides/PRODUCTION-DEPLOYMENT.md`](./guides/PRODUCTION-DEPLOYMENT.md) or [`guides/RENDER-DEPLOYMENT.md`](./guides/RENDER-DEPLOYMENT.md)

## 📚 Concepts (Understanding Core Systems)

Learn how the fundamental systems work:

### 📖 Concepts
*Core patterns and design principles*

- [`SERVICE-ADAPTER-PATTERN.md`](./concepts/SERVICE-ADAPTER-PATTERN.md) - Service-adapter-controller orchestration pattern
- [`FRONTEND-DEVELOPMENT-PATTERNS.md`](./concepts/FRONTEND-DEVELOPMENT-PATTERNS.md) - ORPC, Better Auth, and Declarative Routing patterns
- **ORPC Type Safety**: [`concepts/orpc.md`](./concepts/orpc.md) - End-to-end type-safe API contracts
- **Declarative Routing**: [`concepts/declarative-routing.md`](./concepts/declarative-routing.md) - Type-safe Next.js routing
- **Authentication**: [`concepts/authentication.md`](./concepts/authentication.md) - Better Auth integration
- **Database**: [`concepts/database.md`](./concepts/database.md) - Drizzle ORM patterns
- **Monorepo**: [`concepts/monorepo.md`](./concepts/monorepo.md) - Turborepo structure

## 🏗️ Architecture (System Design)

Understand the system architecture and design decisions:

- **System Architecture**: [`architecture/ARCHITECTURE.md`](./architecture/ARCHITECTURE.md) - Overall system design
- **Core vs Feature**: [`architecture/CORE-VS-FEATURE-ARCHITECTURE.md`](./architecture/CORE-VS-FEATURE-ARCHITECTURE.md) - Module organization
- **Core Modules**: [`architecture/CORE-MODULE-ARCHITECTURE.md`](./architecture/CORE-MODULE-ARCHITECTURE.md) - Core module design
- **Reconciliation**: [`architecture/RECONCILIATION-ARCHITECTURE.md`](./architecture/RECONCILIATION-ARCHITECTURE.md) - State reconciliation
- **Traefik Database**: [`architecture/TRAEFIK-DATABASE-ARCHITECTURE.md`](./architecture/TRAEFIK-DATABASE-ARCHITECTURE.md) - Traefik integration

## 📖 Guides (Step-by-Step How-To)

Practical guides for development and deployment:

- **Getting Started**: [`guides/GETTING-STARTED.md`](./guides/GETTING-STARTED.md)
- **Development Workflow**: [`guides/DEVELOPMENT-WORKFLOW.md`](./guides/DEVELOPMENT-WORKFLOW.md)
- **Static Deployment**: [`guides/STATIC-DEPLOYMENT.md`](./guides/STATIC-DEPLOYMENT.md) - Comprehensive guide for deploying static websites
- **Testing**: [`guides/TESTING.md`](./guides/TESTING.md)
- **Production Deployment**: [`guides/PRODUCTION-DEPLOYMENT.md`](./guides/PRODUCTION-DEPLOYMENT.md)
- **Render Deployment**: [`guides/RENDER-DEPLOYMENT.md`](./guides/RENDER-DEPLOYMENT.md)
- **Project Isolation**: [`guides/PROJECT-ISOLATION.md`](./guides/PROJECT-ISOLATION.md)

## 🎯 Features (Feature-Specific Documentation)

Detailed documentation organized by feature:

### Deployment
- [`features/deployment/`](./features/deployment/) - Deployment health rules, status semantics, configuration, retention policies, and rollback filtering
- **See also:** [`guides/STATIC-DEPLOYMENT.md`](./guides/STATIC-DEPLOYMENT.md) for comprehensive static deployment guide

### Docker
- [`features/docker/`](./features/docker/) - Build strategies, storage management, and file ownership

### GitHub Provider
- [`features/github-provider/`](./features/github-provider/) - GitHub App integration, multi-tenant support, and implementation

### Database
- [`features/database/`](./features/database/) - Database encryption implementation

### Testing
- [`features/testing/`](./features/testing/) - Phase tracking and testing implementation

## 📋 Planning (Roadmaps & TODOs)

Current work and future plans:

### High-Level Roadmap
- [`planning/ROADMAP.md`](./planning/ROADMAP.md) - Platform roadmap and release planning

### Feature-Specific Planning
- [`planning/GITHUB-PROVIDER-ROADMAP.md`](./planning/GITHUB-PROVIDER-ROADMAP.md) - GitHub integration progress and tasks
- [`planning/FEATURE-TODOS.md`](./planning/FEATURE-TODOS.md) - Actionable implementation tasks across all features
- [`planning/RECONCILIATION-TODO.md`](./planning/RECONCILIATION-TODO.md) - Reconciliation feature detailed tasks

### Implementation Guides
- [`planning/RECONCILIATION-IMPLEMENTATION-GUIDE.md`](./planning/RECONCILIATION-IMPLEMENTATION-GUIDE.md) - Reconciliation implementation roadmap
- [`planning/MULTI-DEPLOYMENT-ORCHESTRATION-IMPLEMENTATION-GUIDE.md`](./planning/MULTI-DEPLOYMENT-ORCHESTRATION-IMPLEMENTATION-GUIDE.md) - Multi-deployment orchestration guide

## 📑 Reference (Lookup Documentation)

Quick reference and technical specifications:

- **Tech Stack**: [`reference/TECH-STACK.md`](./reference/TECH-STACK.md)
- **ORPC Contracts**: [`reference/ORPC-TYPE-CONTRACTS.md`](./reference/ORPC-TYPE-CONTRACTS.md)
- **Environment System**: [`reference/ENVIRONMENT-TEMPLATE-SYSTEM.md`](./reference/ENVIRONMENT-TEMPLATE-SYSTEM.md)
- **Database Encryption**: [`reference/DATABASE-ENCRYPTION.md`](./reference/DATABASE-ENCRYPTION.md)
- **Glossary**: [`reference/GLOSSARY.md`](./reference/GLOSSARY.md)
- **Style Guide**: [`reference/STYLEGUIDE.md`](./reference/STYLEGUIDE.md)
- **Directus Types**: [`reference/DIRECTUS-TYPE-GENERATION.md`](./reference/DIRECTUS-TYPE-GENERATION.md)

## 📐 Specifications (Detailed Technical Specs)

In-depth technical specifications:

- **Multi-Deployment Orchestration**: [`specifications/MULTI-DEPLOYMENT-ORCHESTRATION-SPECIFICATION.md`](./specifications/MULTI-DEPLOYMENT-ORCHESTRATION-SPECIFICATION.md)
- **Environment**: [`specifications/ENVIRONMENT-SPECIFICATION.md`](./specifications/ENVIRONMENT-SPECIFICATION.md)
- **Frontend**: [`specifications/FRONTEND-SPECIFICATION.md`](./specifications/FRONTEND-SPECIFICATION.md)

## 📦 Archive (Historical Documentation)

Completed implementations and historical documentation:

- [`archive/README.md`](./archive/README.md) - Archive index and purpose
- See archive directory for completion summaries and obsolete documentation

## 🤝 Contributing to Documentation

When contributing to documentation:

1. Follow the [`reference/STYLEGUIDE.md`](./reference/STYLEGUIDE.md) conventions
2. Place documents in the appropriate directory based on their purpose
3. Link to existing documentation rather than duplicating content
4. Update this README when adding new major documentation sections
