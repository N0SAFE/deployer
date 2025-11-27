# Documentation Home

Welcome to the documentation for this Next.js + NestJS deployment platform. This hub provides organized, accessible documentation across concepts, architecture, guides, and references.

> **Use case optimized for:** Docker-first deployment platform with multi-tenant support, GitHub integration, and automated deployment workflows.
>
> **Audience:** Full-stack developers building or maintaining the deployment platform.
>
> **Out of scope:** Platform-specific deployment details are in provider-specific guides.

## ⚠️ CRITICAL: Start Here - Core Concepts

**BEFORE ANY DEVELOPMENT WORK**, read all files in the core concepts directory:

### 🎯 [`core-concepts/`](./core-concepts/) - Non-Negotiable Foundational Rules

**You MUST read EVERY file in this directory.** These are mandatory patterns and processes that define how this project operates. They cannot be bypassed except with explicit user override.

**Why Core Concepts Matter:**
- 🔴 **Source of Truth**: These rules override all other documentation when conflicts arise
- 🔴 **Always Load**: AI assistants MUST load ALL core concepts at conversation start
- 🔴 **Conflict Detection**: If user request violates core concept, request approval before proceeding
- 🔴 **Check Before Creating**: When adding patterns, check if core concept already exists

**[→ Start with Core Concepts Index](./core-concepts/README.md)**

### 📚 How to Navigate This Documentation

**README-First Pattern** (See [core-concepts/06-README-FIRST-DOCUMENTATION-DISCOVERY.md](./core-concepts/06-README-FIRST-DOCUMENTATION-DISCOVERY.md)):

1. **Start here** (`docs/README.md`) - Main documentation hub and structure overview
2. **Navigate via structure** - Find the relevant subdirectory (concepts/, architecture/, guides/, etc.)
3. **Check subdirectory READMEs** - Many subdirectories have their own README with detailed navigation
4. **Read individual files** - Dive into specific documentation only after understanding the structure
5. **Use tooling** - Run `docs/bin/generate-doc-diagram.sh` to visualize all documentation relationships

**Never jump directly to individual files**. Always follow the README hierarchy for complete context and efficient knowledge acquisition.

---

## 📁 Documentation Structure

Our documentation is organized into focused directories. Each directory has a README.md index:

- **🎯 [Core Concepts](./core-concepts/)** - **MANDATORY** foundational rules and patterns ([→ Index](./core-concepts/README.md))
- **📚 [Concepts](./concepts/)** - Core system concepts and patterns ([→ Index](./concepts/README.md))
- **🏗️ [Architecture](./architecture/)** - System design and architectural decisions ([→ Index](./architecture/README.md))
- **📖 [Guides](./guides/)** - Step-by-step how-to documentation ([→ Index](./guides/README.md))
- **🎯 [Features](./features/)** - Feature-specific implementation details ([→ Index](./features/README.md))
- **📋 [Planning](./planning/)** - Roadmaps, TODOs, and implementation guides ([→ Index](./planning/README.md))
- **📑 [Reference](./reference/)** - API references, specs, and lookup documentation ([→ Index](./reference/README.md))
- **📐 [Specifications](./specifications/)** - Detailed technical specifications ([→ Index](./specifications/README.md))
- **📦 [Archive](./archive/)** - Historical and completed documentation ([→ Index](./archive/README.md))

## 🧭 Quick Start Journey (Recommended Order)

**⚠️ IMPORTANT: Start with Core Concepts first!**

0. **Foundation**: [`core-concepts/README.md`](./core-concepts/README.md) - **Read ALL core concepts** before any development
1. **Bootstrap**: [`guides/GETTING-STARTED.md`](./guides/GETTING-STARTED.md) - Set up your development environment
2. **Understand**: [`architecture/ARCHITECTURE.md`](./architecture/ARCHITECTURE.md) + [`reference/TECH-STACK.md`](./reference/TECH-STACK.md) - System overview
3. **Configure**: [`reference/ENVIRONMENT-TEMPLATE-SYSTEM.md`](./reference/ENVIRONMENT-TEMPLATE-SYSTEM.md) - Environment setup
4. **Develop**: [`guides/DEVELOPMENT-WORKFLOW.md`](./guides/DEVELOPMENT-WORKFLOW.md) - Daily development tasks
5. **Test**: [`guides/TESTING.md`](./guides/TESTING.md) - Testing strategies and execution
6. **Deploy**: [`guides/PRODUCTION-DEPLOYMENT.md`](./guides/PRODUCTION-DEPLOYMENT.md) or [`guides/RENDER-DEPLOYMENT.md`](./guides/RENDER-DEPLOYMENT.md)

## 📚 Concepts (Understanding Core Systems)

Learn how the fundamental systems work. For a complete index, see [**concepts/README.md**](./concepts/README.md).

### 📖 Key Concepts
*Core patterns and design principles*

- [`SERVICE-ADAPTER-PATTERN.md`](./concepts/SERVICE-ADAPTER-PATTERN.md) - Service-adapter-controller orchestration pattern
- [`FRONTEND-DEVELOPMENT-PATTERNS.md`](./concepts/FRONTEND-DEVELOPMENT-PATTERNS.md) - ORPC, Better Auth, and Declarative Routing patterns
- **ORPC Type Safety**: [`concepts/orpc.md`](./concepts/orpc.md) - End-to-end type-safe API contracts
- **Declarative Routing**: [`concepts/declarative-routing.md`](./concepts/declarative-routing.md) - Type-safe Next.js routing
- **Authentication**: [`concepts/authentication.md`](./concepts/authentication.md) - Better Auth integration
- **Database**: [`concepts/database.md`](./concepts/database.md) - Drizzle ORM patterns
- **Monorepo**: [`concepts/monorepo.md`](./concepts/monorepo.md) - Turborepo structure

## �️ Architecture (System Design)

Understand the system architecture and design decisions. For a complete index, see [**architecture/README.md**](./architecture/README.md).

### Key Architecture Documents

- **System Architecture**: [`architecture/ARCHITECTURE.md`](./architecture/ARCHITECTURE.md) - Overall system design
- **Service Context Architecture**: [`architecture/SERVICE-CONTEXT-ARCHITECTURE.md`](./architecture/SERVICE-CONTEXT-ARCHITECTURE.md) - Service context system diagrams and data flows
- **Core vs Feature**: [`architecture/CORE-VS-FEATURE-ARCHITECTURE.md`](./architecture/CORE-VS-FEATURE-ARCHITECTURE.md) - Module organization
- **Core Modules**: [`architecture/CORE-MODULE-ARCHITECTURE.md`](./architecture/CORE-MODULE-ARCHITECTURE.md) - Core module design
- **Reconciliation**: [`architecture/RECONCILIATION-ARCHITECTURE.md`](./architecture/RECONCILIATION-ARCHITECTURE.md) - State reconciliation
- **Traefik Database**: [`architecture/TRAEFIK-DATABASE-ARCHITECTURE.md`](./architecture/TRAEFIK-DATABASE-ARCHITECTURE.md) - Traefik integration

## 📖 Guides (Step-by-Step How-To)

Practical guides for development and deployment. For a complete index, see [**guides/README.md**](./guides/README.md).

### Available Guides

- **Getting Started**: [`guides/GETTING-STARTED.md`](./guides/GETTING-STARTED.md)
- **Development Workflow**: [`guides/DEVELOPMENT-WORKFLOW.md`](./guides/DEVELOPMENT-WORKFLOW.md)
- **Static Deployment**: [`guides/STATIC-DEPLOYMENT.md`](./guides/STATIC-DEPLOYMENT.md) - Comprehensive guide for deploying static websites
- **Testing**: [`guides/TESTING.md`](./guides/TESTING.md)
- **Production Deployment**: [`guides/PRODUCTION-DEPLOYMENT.md`](./guides/PRODUCTION-DEPLOYMENT.md)
- **Render Deployment**: [`guides/RENDER-DEPLOYMENT.md`](./guides/RENDER-DEPLOYMENT.md)
- **Project Isolation**: [`guides/PROJECT-ISOLATION.md`](./guides/PROJECT-ISOLATION.md)

## 🎯 Features (Feature-Specific Documentation)

Detailed documentation organized by feature. For a complete index, see [**features/README.md**](./features/README.md).

### Key Features

#### Context System
- [`features/SERVICE-CONTEXT-SYSTEM.md`](./features/SERVICE-CONTEXT-SYSTEM.md) - Comprehensive service and project context system with domain management
- [`features/DEPLOYMENT-CONTEXT-INTEGRATION.md`](./features/DEPLOYMENT-CONTEXT-INTEGRATION.md) - How deployment services use the context system

#### Deployment
- [`features/deployment/`](./features/deployment/) - Deployment health rules, status semantics, configuration, retention policies, and rollback filtering
- **See also:** [`guides/STATIC-DEPLOYMENT.md`](./guides/STATIC-DEPLOYMENT.md) for comprehensive static deployment guide

#### Docker
- [`features/docker/`](./features/docker/) - Build strategies, storage management, and file ownership

#### GitHub Provider
- [`features/github-provider/`](./features/github-provider/) - GitHub App integration, multi-tenant support, and implementation

#### Database
- [`features/database/`](./features/database/) - Database encryption implementation

#### Testing
- [`features/testing/`](./features/testing/) - Phase tracking and testing implementation

## 📋 Planning (Roadmaps & TODOs)

Current work and future plans. For a complete index, see [**planning/README.md**](./planning/README.md).

### High-Level Roadmap
- [`planning/ROADMAP.md`](./planning/ROADMAP.md) - Platform roadmap and release planning

### Feature-Specific Planning
- [`planning/GITHUB-PROVIDER-ROADMAP.md`](./planning/GITHUB-PROVIDER-ROADMAP.md) - GitHub integration progress and tasks
- [`planning/FEATURE-TODOS.md`](./planning/FEATURE-TODOS.md) - Actionable implementation tasks across all features
- [`planning/RECONCILIATION-TODO.md`](./planning/RECONCILIATION-TODO.md) - Reconciliation feature detailed tasks

### Implementation Guides
- [`planning/RECONCILIATION-IMPLEMENTATION-GUIDE.md`](./planning/RECONCILIATION-IMPLEMENTATION-GUIDE.md) - Reconciliation implementation roadmap
- [`planning/MULTI-DEPLOYMENT-ORCHESTRATION-IMPLEMENTATION-GUIDE.md`](./planning/MULTI-DEPLOYMENT-ORCHESTRATION-IMPLEMENTATION-GUIDE.md) - Multi-deployment orchestration guide
- [`planning/API-STANDARDIZATION-PLAN.md`](./planning/API-STANDARDIZATION-PLAN.md) - **API module standardization plan** - Comprehensive plan to standardize all API modules to follow the Service-Adapter pattern
- [`planning/USER-MODULE-STANDARDIZATION-COMPLETE.md`](./planning/USER-MODULE-STANDARDIZATION-COMPLETE.md) - **✅ COMPLETE** - User module standardization implementation details and lessons learned

## 📑 Reference (Lookup Documentation)

Quick reference and technical specifications. For a complete index, see [**reference/README.md**](./reference/README.md).

### Key References

- **Tech Stack**: [`reference/TECH-STACK.md`](./reference/TECH-STACK.md)
- **ORPC Contracts**: [`core-concepts/09-ORPC-IMPLEMENTATION-PATTERN.md`](./core-concepts/09-ORPC-IMPLEMENTATION-PATTERN.md)
- **Environment System**: [`reference/ENVIRONMENT-TEMPLATE-SYSTEM.md`](./reference/ENVIRONMENT-TEMPLATE-SYSTEM.md)
- **Database Encryption**: [`reference/DATABASE-ENCRYPTION.md`](./reference/DATABASE-ENCRYPTION.md)
- **Module Structure Checklist**: [`reference/MODULE-STRUCTURE-CHECKLIST.md`](./reference/MODULE-STRUCTURE-CHECKLIST.md) - **Quick reference for API module structure**
- **Glossary**: [`reference/GLOSSARY.md`](./reference/GLOSSARY.md)
- **Style Guide**: [`reference/STYLEGUIDE.md`](./reference/STYLEGUIDE.md)
- **Directus Types**: [`reference/DIRECTUS-TYPE-GENERATION.md`](./reference/DIRECTUS-TYPE-GENERATION.md)

## 📐 Specifications (Detailed Technical Specs)

In-depth technical specifications. For a complete index, see [**specifications/README.md**](./specifications/README.md).

### Available Specifications

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
