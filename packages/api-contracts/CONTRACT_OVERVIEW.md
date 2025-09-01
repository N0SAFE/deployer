# API Contract Overview

> **Complete Contract Reference** - Comprehensive guide to all platform contracts

## 🏗️ **Contract Organization Summary**

The Universal Deployment Platform uses a domain-driven contract architecture with clear separation of concerns:

```
📁 Core Foundation (2 contracts)
├── 🟢 health      - System monitoring & health checks
└── 🟢 user        - Authentication & user management

📁 Project Management (3 contracts)  
├── 🟢 project     - Project lifecycle & team management
├── 🟢 service     - Service configuration & monitoring
└── 🟢 environment - Environment management & variables

📁 Deployment Operations (2 contracts)
├── 🟢 deployment  - Primary deployment operations
└── 🟡 ci-cd       - Advanced pipeline automation

📁 Infrastructure (3 contracts)
├── 🟢 traefik      - Load balancer & routing
├── 🟢 orchestration - Container management  
└── 🟢 storage      - File & artifact storage

📁 Analytics & Utilities (2 contracts)
├── 🟢 analytics      - Usage metrics & insights
└── 🟢 variable-resolver - Dynamic configuration
```

## 📊 **Contract Usage Matrix**

| Contract | Routes | Frontend | Backend | WebSocket | Status | Complexity |
|----------|--------|----------|---------|-----------|--------|------------|
| **Core Foundation** |
| `health` | `/health/*` | ❌ | ✅ | ❌ | 🟢 Active | Low |
| `user` | `/user/*` | ✅ | ✅ | ❌ | 🟢 Active | Medium |
| **Project Management** |
| `project` | `/projects/*` | ✅ | ✅ | ❌ | 🟢 Active | High |
| `service` | `/services/*` | ✅ | ✅ | ✅ | 🟢 Active | Medium-High |
| `environment` | `/environments/*` | ✅ | ✅ | ❌ | 🟢 Active | High |
| **Deployment Operations** |
| `deployment` | `/deployment/*` | ✅ | ✅ | ✅ | 🟢 **PRIMARY** | Medium |
| `ci-cd` | `/ci-cd/*` | ❌ | ✅ | ❌ | 🟡 Partial | High |
| **Infrastructure** |
| `traefik` | `/traefik/*` | ❌ | ✅ | ❌ | 🟢 Active | Medium |
| `orchestration` | `/orchestration/*` | ❌ | ✅ | ❌ | 🟢 Active | Medium |
| `storage` | `/storage/*` | ❌ | ✅ | ❌ | 🟢 Active | Low |
| **Analytics & Utilities** |
| `analytics` | `/analytics/*` | ❌ | ✅ | ❌ | 🟢 Active | Medium |
| `variable-resolver` | `/variable-resolver/*` | ❌ | ✅ | ❌ | 🟢 Active | Medium |

## 🎯 **Contract Selection Guide**

### **For Frontend Development**

#### **✅ Always Use These (Primary Frontend Contracts)**
```typescript
orpc.user.*         // User authentication & profiles
orpc.project.*      // Project management & settings  
orpc.service.*      // Service configuration & monitoring
orpc.environment.*  // Environment & variable management
orpc.deployment.*   // Deployment operations (MAIN)
```

#### **❌ Avoid in Frontend (Backend-Only Contracts)**
```typescript
orpc.health.*          // System health monitoring
orpc.traefik.*         // Load balancer management
orpc.orchestration.*   // Container orchestration
orpc.storage.*         // File operations
orpc.analytics.*       // Metrics collection
orpc.variable-resolver.* // Variable processing engine
orpc.ciCd.*           // Advanced CI/CD automation
```

### **By Development Scenario**

| Scenario | Primary Contract | Supporting Contracts | Example |
|----------|------------------|---------------------|---------|
| **User Dashboard** | `user` | `project`, `analytics` | Profile, project list, usage stats |
| **Project Setup** | `project` | `environment`, `service` | Create project, add services, configure envs |
| **Service Management** | `service` | `project`, `deployment` | Configure Docker, view deployments |
| **Environment Config** | `environment` | `project`, `variable-resolver` | Set variables, create previews |
| **Deploy Application** | `deployment` | `service`, `environment` | Trigger deploy, monitor status |
| **System Monitoring** | `health` | `analytics`, `service` | Health checks, system metrics |

## 🔄 **Contract Interaction Patterns**

### **Common Workflow: Deploy a Service**
```
1. User selects project     → orpc.project.getById()
2. User selects service     → orpc.service.listByProject() 
3. User picks environment   → orpc.environment.list()
4. Trigger deployment       → orpc.deployment.trigger()
5. Monitor progress         → orpc.deployment.getStatus() (polling)
6. Stream logs              → orpc.deployment.getLogs() (WebSocket)
7. Handle completion        → orpc.deployment.list() (refresh)
```

### **Contract Dependencies**
```
user (auth required)
├── project (user's projects)
│   ├── service (project's services)  
│   │   └── deployment (service deployments)
│   └── environment (project environments)
│       └── variable-resolver (resolve env vars)
├── health (system status)
└── analytics (user metrics)
```

## 📚 **Documentation Hierarchy**

### **Quick Start** 
- **[QUICK_REFERENCE.md](./QUICK_REFERENCE.md)** - Essential contracts and usage patterns

### **Comprehensive Documentation**
- **[CONTRACT_ARCHITECTURE.md](./CONTRACT_ARCHITECTURE.md)** - Complete technical architecture
- **[CONTRACT_OVERVIEW.md](./CONTRACT_OVERVIEW.md)** - This document - broad overview

### **Individual Contract Documentation**
Each contract has comprehensive inline documentation covering:
- Purpose and scope definition
- Frontend integration status  
- Relationship to other contracts
- Usage examples and patterns
- Route organization and complexity

## 🔧 **Development Workflow**

### **Adding New Functionality**

1. **Identify the Domain**: Which contract should handle this feature?
2. **Check for Duplication**: Does similar functionality already exist?
3. **Design the Endpoint**: Follow RESTful patterns and naming conventions
4. **Update Documentation**: Add comprehensive inline documentation
5. **Test Integration**: Verify frontend usage and backend implementation

### **Contract Modification Guidelines**

#### **✅ Safe Changes**
- Adding new optional fields to input schemas
- Adding new endpoints to existing contracts
- Enhancing documentation and examples
- Adding new optional response fields

#### **⚠️ Breaking Changes** 
- Removing or renaming existing endpoints
- Making optional fields required
- Changing response data structures
- Modifying route paths or HTTP methods

#### **🚫 Avoid These**
- Creating duplicate functionality across contracts
- Adding endpoints without frontend use cases
- Inconsistent naming or route patterns
- Missing or inadequate documentation

## 📈 **Contract Maturity Roadmap**

### **Current State (2025)**
- ✅ Core functionality complete and stable
- ✅ Primary frontend integration active
- ✅ Comprehensive documentation in place
- ⚠️ Some contracts have unused advanced features

### **Next Phase**
- 🎯 Remove duplicate CI/CD deployment functionality
- 🎯 Add frontend integration for analytics and monitoring
- 🎯 Implement contract versioning system
- 🎯 Add comprehensive API testing coverage

### **Future Enhancements**
- 🔮 Contract performance optimization
- 🔮 Advanced webhook and event system
- 🔮 Multi-tenant contract extensions
- 🔮 GraphQL federation layer

## 🏁 **Getting Started**

### **For New Developers**
1. Start with [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) for essential contracts
2. Review the main [CONTRACT_ARCHITECTURE.md](./CONTRACT_ARCHITECTURE.md) for comprehensive understanding
3. Explore individual contract files for detailed documentation
4. Check existing frontend usage in `/apps/web/src/hooks/`

### **For API Integration**
1. Use the `deployment` contract for simple deployments
2. Use `project`, `service`, and `environment` contracts for management interfaces
3. Use `user` contract for authentication and profiles
4. Avoid backend-only contracts (`traefik`, `orchestration`, `storage`, etc.)

---

**Need Help?** 
- Check [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) for common patterns
- Review [CONTRACT_ARCHITECTURE.md](./CONTRACT_ARCHITECTURE.md) for detailed specs
- Examine individual contract files for comprehensive documentation
- Look at frontend usage examples in `/apps/web/src/hooks/`

*Last Updated: August 2025*