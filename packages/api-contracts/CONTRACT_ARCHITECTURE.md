# API Contract Architecture

> **Universal Deployment Platform** - Contract Documentation and Organization Guide

## Overview

This document provides a comprehensive guide to the API contract organization in the Universal Deployment Platform. Each contract module represents a specific domain with well-defined responsibilities, clear boundaries, and minimal overlap.

### 🎯 **Contract Design Philosophy**

Our API contracts follow these core principles:

1. **Domain-Driven Design**: Each contract represents a business domain
2. **Single Responsibility**: One contract, one area of concern  
3. **Frontend-First**: Contracts are designed based on actual frontend usage
4. **Minimal Overlap**: Clear boundaries prevent duplication
5. **Developer Experience**: Intuitive naming and comprehensive documentation

### 📊 **Contract Maturity Levels**

| Level | Description | Frontend Usage | API Implementation | Documentation |
|-------|-------------|----------------|-------------------|---------------|
| 🟢 **Production Ready** | Fully mature, actively used | ✅ Complete | ✅ Complete | ✅ Complete |
| 🟡 **Partially Ready** | Some features used, others deprecated | 🔄 Partial | ✅ Complete | 🔄 Needs Update |
| 🔴 **Deprecated/Unused** | Implemented but not used | ❌ None | ⚠️ Should Remove | ❌ Outdated |

## Contract Hierarchy

```
appContract
├── Core Foundation
│   ├── health      - System health and status monitoring
│   └── user        - Authentication and user management
├── Project Management
│   ├── project     - Project lifecycle and settings
│   ├── service     - Service definitions and configurations
│   └── environment - Environment management and variables
├── Deployment Operations
│   ├── deployment  - Core deployment operations (ACTIVE)
│   └── ci-cd       - Pipeline automation (PARTIALLY USED)
├── Infrastructure
│   ├── traefik     - Load balancer and domain management
│   ├── orchestration - Container orchestration
│   └── storage     - File and artifact storage
└── Monitoring & Analytics
    ├── analytics   - Usage metrics and insights
    └── variable-resolver - Dynamic configuration resolution
```

## Contract Specifications

### 🟢 **Core Foundation Contracts**

#### `health` Contract
**Purpose**: System health monitoring and status checks  
**Routes**: `/health/*`  
**Usage**: ✅ Active - Used by monitoring systems  
**Responsibilities**:
- API health checks
- Service dependency status
- System resource monitoring
- Readiness and liveness probes

#### `user` Contract  
**Purpose**: User management and authentication  
**Routes**: `/user/*`  
**Usage**: ✅ Active - Used by auth system and dashboard  
**Responsibilities**:
- User CRUD operations
- Profile management
- Email verification
- Account settings

### 🟡 **Project Management Contracts**

#### `project` Contract
**Purpose**: Project lifecycle management  
**Routes**: `/projects/*`  
**Usage**: ✅ Active - Core platform functionality  
**Responsibilities**:
- Project creation, updates, deletion
- Project settings and configuration
- Team collaboration and permissions  
- Project-level statistics and metrics

#### `service` Contract
**Purpose**: Service definition and management within projects  
**Routes**: `/services/*`  
**Usage**: ✅ Active - Core deployment functionality  
**Responsibilities**:
- Service configuration management
- Docker configuration
- Environment variable management
- Service dependencies and relationships

#### `environment` Contract
**Purpose**: Environment management and configuration  
**Routes**: `/environments/*`  
**Usage**: ✅ Active - Environment-specific deployments  
**Responsibilities**:
- Environment creation and management
- Environment variable configuration
- Environment-specific settings
- Environment cloning and templating

### 🔵 **Deployment Operations Contracts**

#### `deployment` Contract ⭐ **PRIMARY**
**Purpose**: Core deployment operations  
**Routes**: `/deployment/*`  
**Usage**: ✅ **ACTIVE** - Primary deployment system  
**Frontend Usage**: ✅ Used by `useDeployments.ts` hooks  
**Responsibilities**:
- Trigger deployments
- Monitor deployment status
- Retrieve deployment logs
- Cancel and rollback deployments
- WebSocket real-time updates

#### `ci-cd` Contract ⚠️ **REVIEW NEEDED**
**Purpose**: Advanced CI/CD pipeline automation  
**Routes**: `/ci-cd/*`  
**Usage**: 🟡 **PARTIALLY USED** - Only pipeline, build, webhook modules  
**Frontend Usage**: ❌ **NOT USED** by frontend  
**Responsibilities**:
- Pipeline management ✅ **USED**
- Build automation ✅ **USED**  
- **~~Deployment automation~~** ❌ **DUPLICATE** - Conflicts with `deployment` contract
- Webhook management ✅ **USED**

**⚠️ ISSUE**: The `ci-cd.deployment` module duplicates functionality from the main `deployment` contract but is unused by the frontend.

### 🟢 **Infrastructure Contracts**

#### `traefik` Contract
**Purpose**: Load balancer and domain management  
**Routes**: `/traefik/*`  
**Usage**: ✅ Active - Domain routing and SSL  
**Responsibilities**:
- Traefik instance management
- Domain and subdomain configuration
- SSL certificate management
- Route registration for deployments
- Load balancing configuration

#### `orchestration` Contract
**Purpose**: Container orchestration and management  
**Routes**: `/orchestration/*`  
**Usage**: ✅ Active - Container lifecycle  
**Responsibilities**:
- Container deployment orchestration
- Resource allocation and scaling
- Multi-container service coordination
- Health monitoring and recovery

#### `storage` Contract
**Purpose**: File and artifact storage management  
**Routes**: `/storage/*`  
**Usage**: ✅ Active - File operations  
**Responsibilities**:
- Deployment artifact storage
- File upload and download
- Storage cleanup and retention
- Backup and restore operations

### 🔶 **Monitoring & Analytics Contracts**

#### `analytics` Contract
**Purpose**: Platform usage analytics and insights  
**Routes**: `/analytics/*`  
**Usage**: ✅ Active - Dashboard metrics  
**Responsibilities**:
- Deployment statistics and trends
- Performance metrics collection
- Usage analytics and reporting
- Cost analysis and resource utilization

#### `variable-resolver` Contract
**Purpose**: Dynamic configuration resolution  
**Routes**: `/variable-resolver/*`  
**Usage**: ✅ Active - Configuration management  
**Responsibilities**:
- Environment variable interpolation
- Secret resolution and injection
- Configuration template processing
- Dynamic value computation

## Contract Usage Matrix

| Contract | Frontend Used | Backend Implemented | API Routes Active | Status |
|----------|---------------|-------------------|------------------|--------|
| `health` | ❌ | ✅ | ✅ | ✅ **Active** |
| `user` | ✅ | ✅ | ✅ | ✅ **Active** |
| `project` | ✅ | ✅ | ✅ | ✅ **Active** |
| `service` | ✅ | ✅ | ✅ | ✅ **Active** |
| `environment` | ✅ | ✅ | ✅ | ✅ **Active** |
| `deployment` | ✅ | ✅ | ✅ | ✅ **Active** |
| `traefik` | ❌ | ✅ | ✅ | ✅ **Active** |
| `orchestration` | ❌ | ✅ | ✅ | ✅ **Active** |
| `storage` | ❌ | ✅ | ✅ | ✅ **Active** |
| `analytics` | ❌ | ✅ | ✅ | ✅ **Active** |
| `variable-resolver` | ❌ | ✅ | ✅ | ✅ **Active** |
| `ci-cd.pipeline` | ❌ | ✅ | ✅ | ✅ **Active** |
| `ci-cd.build` | ❌ | ✅ | ✅ | ✅ **Active** |
| `ci-cd.webhook` | ❌ | ✅ | ✅ | ✅ **Active** |
| `ci-cd.deployment` | ❌ | ✅ | ❌ | ⚠️ **DUPLICATE** |

## Issues Identified

### 🚨 **Contract Duplication**

**Problem**: The `ci-cd.deployment` module duplicates core deployment functionality from the main `deployment` contract.

**Affected Endpoints**:
- Deployment triggering: `deployment.trigger` vs `ci-cd.deployment.deployBuild`
- Status monitoring: `deployment.getStatus` vs `ci-cd.deployment.getDeploymentStatus`
- Log retrieval: `deployment.getLogs` vs `ci-cd.deployment.getDeploymentLogs`
- Cancellation: `deployment.cancel` vs `ci-cd.deployment.cancelDeployment`
- Rollback: `deployment.rollback` vs `ci-cd.deployment.rollbackDeployment`

**Impact**:
- ❌ ~30 unused API endpoints
- ❌ Maintenance overhead  
- ❌ Code duplication in controllers
- ❌ Potential confusion for developers

### 🔧 **Contract Boundaries**

Some contracts have overlapping responsibilities that should be clarified:

1. **Environment vs Project**: Environment variables management spans both
2. **Service vs Orchestration**: Container management responsibilities overlap
3. **Analytics vs Deployment**: Deployment statistics are scattered

## Recommendations

### 1. **Immediate Actions**

#### **Remove CI/CD Deployment Duplication**
```typescript
// ❌ Remove from ci-cd/index.ts
export const ciCdContract = oc.router({
  pipeline: pipelineManagementContract,
  build: buildAutomationContract,
  // deployment: deploymentAutomationContract, // REMOVE
  webhook: webhookManagementContract,
  getOverview: // ... keep overview
});
```

#### **Clarify Contract Boundaries**
- Move deployment-related analytics to `deployment` contract
- Consolidate environment variable management in `environment` contract
- Define clear orchestration vs service management boundaries

### 2. **Future Enhancements**

#### **Add Missing Contracts**
Consider adding these domain-specific contracts:
- `team` - Team management and collaboration
- `webhook` - Standalone webhook management (separate from ci-cd)
- `preview` - Preview environment management
- `monitoring` - System monitoring and alerting

#### **Improve Contract Organization**
- Group related contracts into sub-modules
- Add contract versioning for backward compatibility
- Implement contract deprecation workflow

## Contract Development Guidelines

### 1. **Single Responsibility Principle**
Each contract should handle one domain area with minimal overlap.

### 2. **Clear Naming Convention**
- Use descriptive, domain-specific names
- Maintain consistent route prefixes
- Follow REST conventions where applicable

### 3. **Frontend-First Design**
- Design contracts based on frontend requirements
- Ensure all contracts have clear frontend use cases
- Remove unused contracts promptly

### 4. **Documentation Requirements**
- Document contract purpose and scope
- Maintain usage examples
- Track frontend dependencies

## 🎯 Contract Usage Patterns

### **When to Create a New Contract**

✅ **Create a new contract when:**
- You have a distinct business domain (e.g., billing, notifications)
- The functionality doesn't fit into existing contracts
- You need different authentication/authorization rules
- The endpoints would be used by different frontend components

❌ **Don't create a new contract when:**
- The functionality is closely related to an existing contract
- You're adding just 1-2 endpoints
- The data models are shared with existing contracts
- The frontend usage overlaps significantly with existing contracts

### **Contract Relationship Types**

```typescript
// 1. AGGREGATION - Contract uses other contracts' data
analytics: {
  getDeploymentMetrics() // Uses deployment data
}

// 2. COMPOSITION - Contract manages lifecycle of related entities  
project: {
  createProject() // Also creates default environments
}

// 3. COORDINATION - Contract orchestrates multiple operations
orchestration: {
  deployMultiService() // Coordinates service + traefik + storage
}

// 4. SPECIALIZATION - Contract handles specific use cases
webhook: {
  triggerPipelineHook() // Specialized pipeline triggering
}
```

### **Contract Versioning Strategy**

```typescript
// Current: Single version per contract
export const projectContract = oc.router({ ... })

// Future: Version-aware contracts  
export const projectContract = oc.router({
  v1: projectV1Contract,
  v2: projectV2Contract,
})
```

## 📚 Contract Documentation Standards

### **Required Documentation for Each Contract**

1. **Purpose Statement**: One-sentence description of what the contract handles
2. **Scope Definition**: What's included and what's not
3. **Frontend Usage**: Which components/hooks use this contract
4. **Dependencies**: Which other contracts this one depends on
5. **Examples**: Common usage patterns and code samples

### **Contract Metadata Template**

```typescript
export const myContract = oc
  .tag("Domain Name") // For OpenAPI grouping
  .prefix("/api-path") // Consistent route prefix
  .meta({
    title: "Human Readable Title",
    description: "Detailed contract purpose and scope",
    version: "1.0.0",
    tags: ["category", "subcategory"],
    examples: [
      {
        name: "Common Usage",
        code: "await orpc.my.commonOperation({ ... })"
      }
    ],
    dependencies: ["user", "project"], // Other contracts this depends on
    frontendUsage: ["Dashboard", "Settings"], // Components that use this
    maturityLevel: "production-ready" // production-ready | partial | deprecated
  })
  .router({ ... })
```

## Migration Path

### Phase 1: Cleanup (Immediate)
1. Remove `ci-cd.deployment` module
2. Update API controllers
3. Clean up unused schemas
4. Update contract exports

### Phase 2: Reorganization (Medium-term)
1. Consolidate overlapping functionality
2. Improve contract boundaries
3. Add missing domain contracts
4. Update documentation

### Phase 3: Enhancement (Long-term)  
1. Implement contract versioning
2. Add comprehensive testing
3. Optimize contract performance
4. Implement contract analytics

---

**Last Updated**: 2025-08-27  
**Next Review**: After CI/CD cleanup completion