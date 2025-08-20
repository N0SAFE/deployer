# Active Context: Universal Deployment Platform Development

## Current Focus
Expanding the foundational deployment system into a comprehensive universal deployment platform similar to Dokploy. The platform will support multiple deployment sources (GitHub, GitLab, Git, ZIP uploads), advanced preview environments, multi-service orchestration, and team collaboration.

## 🎯 **TRANSFORMATION OVERVIEW**
Converting the existing NestJS + Next.js application into a self-hosted universal deployment platform that can be installed on any VPS and handle complex deployment workflows with enterprise-grade features.

### **Core Platform Features Being Implemented**
1. **Multi-Source Deployments**: GitHub, GitLab, generic Git, file uploads, custom integrations
2. **Advanced Preview Environments**: Configurable domains, environment variables, automatic cleanup
3. **Service Orchestration**: Dependency graphs, cascade deployments, health monitoring  
4. **Team Collaboration**: Role-based access, project sharing, audit trails
5. **Self-Hosted Solution**: Easy VPS installation with minimal configuration

## Current Implementation Status

### ✅ **FOUNDATION COMPLETE** 
- **Core Architecture**: NestJS API with ORPC contracts, Next.js dashboard, PostgreSQL + Redis
- **Basic Services**: DockerService, GitService, DeploymentService, TraefikService implemented
- **Authentication System**: Better Auth with role-based access control foundation
- **Database Schema**: Initial deployment tables (projects, services, deployments, logs)
- **WebSocket Integration**: Real-time deployment updates and event broadcasting
- **Job Queue System**: Bull Queue with Redis for asynchronous deployment processing

### 🏗️ **NEXT IMMEDIATE PRIORITIES**

#### **Priority 1: Database Schema Extension** (Week 1)
- Extend Drizzle schema for universal deployment features
- Add tables: git_integrations, service_dependencies, preview_environments, project_collaborators
- Implement proper indexes and constraints for performance

#### **Priority 2: Git Integration Services** (Weeks 2-3) 
- GitHub API integration (@octokit/rest) with OAuth and webhook validation
- GitLab API integration (@gitbeaker/node) with merge request handling
- Generic Git service (simple-git) for any repository with credential management
- Secure webhook endpoints with signature validation

#### **Priority 3: Enhanced Deployment Engine** (Week 4)
- Multi-source deployment processing (GitHub, GitLab, Git, upload)
- Service dependency-aware orchestration with topological sorting
- Preview environment lifecycle management with automatic cleanup

## Technical Architecture Enhancements

### **New Service Components Required**
```typescript
// Git Integration Services
GitHubService: OAuth, webhooks, PR previews, commit status
GitLabService: API integration, MR previews, project management  
GitService: Generic Git operations, credential management
FileUploadService: ZIP handling, artifact storage, validation

// Enhanced Orchestration
ServiceDependencyService: Dependency graph resolution
PreviewEnvironmentService: Lifecycle management, domain assignment
ResourceMonitoringService: Usage tracking, limit enforcement

// Team Collaboration  
TeamService: Role management, invitations, permissions
AuditService: Activity logging, compliance reporting
```

### **Database Schema Extensions**
```sql
-- New tables needed for universal platform
git_integrations: Repository connections and credentials
service_dependencies: Service relationship graph
preview_environments: Dynamic environment management  
project_collaborators: Team access and permissions
audit_logs: Complete activity tracking
webhook_events: Event processing and validation
```

### **Enhanced API Contracts**
```typescript
// New ORPC contract extensions
gitContract: Repository management, webhook handling
teamContract: Collaboration, invitations, permissions  
previewContract: Environment lifecycle, domain management
webhookContract: Event processing, validation, routing
```

## Implementation Strategy

### **Phase 1: Multi-Source Deployment System** (4-6 weeks)
Focus on supporting all deployment sources with proper authentication and webhook handling.

### **Phase 2: Advanced Preview Environments** (3-4 weeks) 
Implement dynamic subdomain generation, environment variable management, and lifecycle automation.

### **Phase 3: Service Orchestration** (4-5 weeks)
Build dependency-aware deployment chains with health monitoring and rollback capabilities.

### **Phase 4: Team Collaboration** (3-4 weeks)
Implement enterprise-grade team management with roles, permissions, and audit trails.

### **Phase 5: Advanced Dashboard** (3-4 weeks)
Build comprehensive UI for all platform features with real-time updates and visualizations.

### **Phase 6: Production Readiness** (2-3 weeks)
Optimization, security hardening, documentation, and installation automation.

## Key Architectural Decisions

### **1. Container Orchestration Evolution**
- **Current**: Docker Compose for simplicity
- **Target**: Docker Swarm for better service management and scaling
- **Future**: Optional Kubernetes support for enterprise deployments

### **2. Domain Management Strategy**
- **Current**: Basic Traefik integration with manual configuration
- **Target**: Automatic subdomain generation with Let's Encrypt SSL
- **Pattern**: `{service}-{environment}-{branch}.{domain.com}`

### **3. Multi-Source Integration Approach**
- **GitHub**: Official API with OAuth app integration
- **GitLab**: API tokens with project-level access
- **Generic Git**: SSH/HTTPS with credential vault
- **File Upload**: Temporary storage with build system integration

### **4. Preview Environment Management**
- **Creation**: Automatic on PR/MR creation via webhooks
- **Configuration**: Hierarchical environment variables (Global → Project → Service → Preview)
- **Cleanup**: Configurable expiration with grace periods
- **Resources**: Isolated containers with CPU/memory limits

## Current Development Environment

### **Enhanced Dependencies Required**
```json
{
  "@octokit/rest": "^20.0.2",      // GitHub API
  "@gitbeaker/node": "^35.8.1",    // GitLab API  
  "simple-git": "^3.21.0",         // Git operations
  "multer": "^1.4.5-lts.1",        // File uploads
  "tar-stream": "^3.1.6",          // Archive handling
  "dockerode": "^4.0.2",           // Enhanced Docker API
  "node-cron": "^3.0.3"            // Cleanup scheduling
}
```

### **Environment Variables Extensions**
```env
# Git Integration
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=  
GITHUB_WEBHOOK_SECRET=
GITLAB_ACCESS_TOKEN=
GITLAB_WEBHOOK_SECRET=

# Domain Management
DEPLOYER_BASE_DOMAIN=deploy.example.com
LETS_ENCRYPT_EMAIL=admin@example.com

# Resource Limits
PREVIEW_CPU_LIMIT=0.5
PREVIEW_MEMORY_LIMIT=512M
PREVIEW_CLEANUP_DAYS=7
```

## Success Criteria

### **Technical Milestones**
- [ ] **Multi-source deployments**: Deploy from GitHub, GitLab, Git, and uploads
- [ ] **Preview environments**: Automatic creation with custom subdomains
- [ ] **Service orchestration**: Deploy services in dependency order
- [ ] **Team collaboration**: Role-based access with audit trails
- [ ] **Performance**: <5min deployment time, <2min preview creation

### **User Experience Goals**
- [ ] **Easy installation**: <15 minutes from VPS to first deployment
- [ ] **Intuitive UI**: Non-technical users can manage projects and deployments
- [ ] **Reliable operations**: >99% deployment success rate
- [ ] **Comprehensive monitoring**: Real-time status and resource usage

## Ready for Implementation

**Current Status**: ✅ **FOUNDATION COMPLETE - READY FOR UNIVERSAL PLATFORM EXPANSION**

All foundational services, database schema, API contracts, and core infrastructure are implemented and tested. Ready to begin Phase 1 development focusing on multi-source deployment system and enhanced preview environments.

**Next Action**: Begin database schema extension for universal deployment features and implement Git integration services for GitHub, GitLab, and generic Git repository support.