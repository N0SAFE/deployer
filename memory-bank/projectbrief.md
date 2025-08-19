# Project Brief: Universal Deployment Platform

## Core Vision
Transform the existing Next.js + NestJS monorepo template into a comprehensive web application that consolidates multiple deployment strategies on any Virtual Private Server (VPS). This application will serve as a self-hosted alternative to platforms like Vercel, Netlify, and Render, with advanced features for preview deployments and multi-service project management.

## Project Objectives

### Primary Goals
1. **Multi-Source Deployment Support**: Handle deployments from GitHub, GitLab, Git repositories, zip uploads, and custom methods (Dokku-style)
2. **Preview Deployment System**: Automated subdomain generation with configurable base domains and webhook triggers  
3. **Multi-Service Project Management**: Support dependent services with automatic redeployment chains
4. **Role-Based Dashboard**: Comprehensive user interface with access controls and deployment tracking

### Technical Foundation
- **Current Base**: Next.js 15.4 + NestJS 10.x monorepo with TypeScript, ORPC, Better Auth, Drizzle ORM
- **Infrastructure**: Docker-first approach with PostgreSQL, Redis, and container orchestration
- **Architecture**: Turborepo workspace with shared packages and type-safe API contracts

## Key Features to Implement

### 1. Deployment Input Sources
- **GitHub Integration**: Repository webhooks, branch-based deployments, PR previews
- **GitLab Integration**: CI/CD integration, merge request previews
- **Generic Git**: Support for any Git repository URL with authentication
- **File Upload**: Zip file deployments with build configuration
- **Custom Methods**: Extensible deployment plugin system (like Dokku's teapot)

### 2. Preview Deployment Engine
- **Base Domain Configuration**: User-configurable domain for subdomain generation
- **Automatic Subdomain Assignment**: Intelligent naming conventions for preview environments
- **Environment Variable Management**: Shared and isolated environment configurations
- **Webhook Triggers**: Automated deployment on code changes

### 3. Multi-Service Projects
- **Service Dependency Mapping**: Define relationships between services (API → Web → Cache)
- **Cascade Deployment**: Automatic redeployment of dependent services
- **Resource Orchestration**: Container management across related services
- **Health Monitoring**: Service status tracking and dependency validation

### 4. User Dashboard & Access Control
- **Project Overview**: Visual representation of services and their relationships
- **Deployment History**: Comprehensive logs and rollback capabilities
- **Role-Based Access**: Owner, Developer, Viewer permissions per project
- **Resource Monitoring**: Usage statistics, performance metrics, cost tracking

## Success Criteria
- ✅ Support all major Git platforms (GitHub, GitLab, generic Git)
- ✅ One-click preview deployments with automatic subdomain assignment
- ✅ Dependency-aware service orchestration
- ✅ Production-ready user interface with role-based access
- ✅ Self-contained VPS deployment with minimal external dependencies
- ✅ Comprehensive documentation and setup guides

## Timeline Estimate
- **Phase 1**: Core deployment infrastructure (4-6 weeks)
- **Phase 2**: Git platform integrations (3-4 weeks) 
- **Phase 3**: Preview deployment system (3-4 weeks)
- **Phase 4**: Multi-service orchestration (4-5 weeks)
- **Phase 5**: User dashboard and access controls (3-4 weeks)
- **Phase 6**: Documentation and optimization (2-3 weeks)

**Total Estimated Duration**: 19-26 weeks (5-6 months)

## Technical Constraints
- Must work on any VPS with Docker support
- Self-contained deployment (no external SaaS dependencies)
- Extensible plugin architecture for custom deployment methods
- Resource-efficient operation for cost-effective hosting