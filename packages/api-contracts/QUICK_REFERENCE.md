# API Contracts - Quick Reference Guide

> **Developer Quick Reference** - Find the right contract for your needs

## 🚀 **Most Used Contracts**

### Frontend Development
```typescript
// Authentication & Users
import { orpc } from '@/lib/orpc';
orpc.user.findById.queryOptions(...)        // Get user profile
orpc.user.update.mutationOptions(...)       // Update user settings

// Projects & Services  
orpc.project.list.queryOptions(...)         // List user projects
orpc.project.getById.queryOptions(...)      // Get project details
orpc.service.listByProject.queryOptions(...) // List project services

// Deployments (MAIN)
orpc.deployment.list.queryOptions(...)      // List deployments
orpc.deployment.trigger.mutationOptions(...) // Deploy service
orpc.deployment.getStatus.queryOptions(...) // Monitor status
orpc.deployment.getLogs.queryOptions(...)   // View logs
orpc.deployment.cancel.mutationOptions(...) // Cancel deployment
```

## 📋 **Contract Directory**

| Contract | Purpose | Routes | Status | Frontend Used |
|----------|---------|--------|--------|---------------|
| **🔑 Core Foundation** |
| `health` | System health monitoring, uptime checks | `/health/*` | 🟢 Active | ❌ Backend only |
| `user` | Authentication, profiles, user settings | `/user/*` | 🟢 Active | ✅ Dashboard, Auth |
| **🏢 Project Management** |
| `project` | Project lifecycle, team management | `/projects/*` | 🟢 Active | ✅ Project dashboard |
| `service` | Service definitions, Docker configs | `/services/*` | 🟢 Active | ✅ Service management |
| `environment` | Environment vars, configs per env | `/environments/*` | 🟢 Active | ✅ Settings pages |
| **🚀 Deployment Operations** |
| `deployment` | **PRIMARY: Deploy, monitor, rollback** | `/deployment/*` | 🟢 **MAIN** | ✅ **Primary usage** |
| `ci-cd.pipeline` | CI/CD pipeline creation & management | `/ci-cd/pipeline/*` | 🟡 Partial | ❌ Advanced users only |
| `ci-cd.build` | Build automation, artifacts | `/ci-cd/build/*` | 🟡 Partial | ❌ Build systems |
| `ci-cd.webhook` | Webhook integrations for pipelines | `/ci-cd/webhook/*` | 🟡 Partial | ❌ Integration configs |
| `ci-cd.deployment` | **DUPLICATE - DO NOT USE** | `/ci-cd/deployment/*` | 🔴 **Deprecated** | ❌ **Unused** |
| **🏗️ Infrastructure** |
| `traefik` | Load balancer, domain routing | `/traefik/*` | 🟢 Active | ❌ Auto-managed |
| `orchestration` | Container orchestration, scaling | `/orchestration/*` | 🟢 Active | ❌ Background ops |
| `storage` | File uploads, artifact storage | `/storage/*` | 🟢 Active | ❌ Internal usage |
| **📊 Analytics** |
| `analytics` | Usage metrics, performance data | `/analytics/*` | 🟢 Active | ❌ Future dashboards |
| `variable-resolver` | Dynamic config resolution | `/variable-resolver/*` | 🟢 Active | ❌ Template engine |

### **Legend**
- 🟢 **Active**: Fully implemented and used
- 🟡 **Partial**: Some features used, others available
- 🔴 **Deprecated**: Should not be used, planned for removal
- ✅ **Frontend Used**: Used by React components/hooks
- ❌ **Backend Only**: Internal backend usage only

## 💡 **Common Use Cases**

### 🎯 **When to Use Which Contract**

#### **For Frontend Development (React Components)**

```typescript
// ✅ ALWAYS USE THESE contracts in React components:
orpc.user.*         // User authentication, profiles  
orpc.project.*      // Project management UI
orpc.service.*      // Service configuration pages
orpc.environment.*  // Environment settings
orpc.deployment.*   // Deployment operations (PRIMARY)

// ❌ AVOID IN FRONTEND (backend handles these):
orpc.traefik.*      // Auto-managed routing
orpc.orchestration.* // Container lifecycle  
orpc.storage.*      // File operations
orpc.analytics.*    // Data collection
```

#### **By Feature Area**

| I want to... | Use Contract | Key Methods | Example |
|---------------|-------------|-------------|---------|
| **Deploy something** | `deployment` | `trigger`, `getStatus`, `getLogs` | Deploy a service to production |
| **Manage projects** | `project` | `list`, `create`, `getById` | Create new project, view dashboard |
| **Configure services** | `service` | `create`, `update`, `getConfig` | Set up Docker container settings |
| **Handle environments** | `environment` | `listByProject`, `update` | Configure staging vs production |
| **User operations** | `user` | `findById`, `update` | User profile, settings |
| **Health checks** | `health` | `status`, `ping` | System status monitoring |
| **Advanced CI/CD** | `ci-cd.pipeline` | `create`, `trigger` | Complex build workflows |

### 🚀 **Deploying a Service** (Most Common)
```typescript
// Complete deployment workflow
const deployService = async (serviceId: string, version: string) => {
  // 1. Trigger deployment
  const deployment = await orpc.deployment.trigger({
    serviceId,
    version,
    environmentId: 'production'
  });

  // 2. Monitor progress  
  const statusQuery = orpc.deployment.getStatus.queryOptions({
    input: { deploymentId: deployment.id },
    refetchInterval: 3000, // Poll every 3 seconds
    enabled: !!deployment.id,
  });

  // 3. Stream logs (optional)
  const logsQuery = orpc.deployment.getLogs.queryOptions({
    input: { 
      deploymentId: deployment.id,
      limit: 100 
    },
    refetchInterval: 2000, // Update logs every 2 seconds
  });

  return { deployment, statusQuery, logsQuery };
};
```

### 📊 **Managing Projects**
```typescript
// List user projects
const projects = orpc.project.list.queryOptions({
  input: { limit: 20 }
})

// Get project with services
const project = orpc.project.getById.queryOptions({
  input: { id: projectId }
})

// List project services  
const services = orpc.service.listByProject.queryOptions({
  input: { projectId }
})
```

### 👥 **User Management**
```typescript
// Get current user
const user = orpc.user.findById.queryOptions({
  input: { id: userId }
})

// Update user profile
const updateUser = orpc.user.update.mutationOptions({
  onSuccess: () => {
    toast.success('Profile updated')
  }
})
```

## ⚡ **Contract Hooks (Frontend)**

### React Query Integration
```typescript
import { orpc } from '@/lib/orpc';
import { useQuery, useMutation } from '@tanstack/react-query';

// Query hooks
const { data, isLoading, error } = useQuery(
  orpc.deployment.list.queryOptions({
    input: { serviceId }
  })
);

// Mutation hooks  
const deployMutation = useMutation(
  orpc.deployment.trigger.mutationOptions({
    onSuccess: () => invalidateQueries(),
    onError: (error) => toast.error(error.message)
  })
);
```

### WebSocket Events
```typescript
// Real-time deployment updates
const deploymentEvents = orpc.deployment.subscribe.queryOptions({
  input: { deploymentId },
  // Handles WebSocket connection automatically
});
```

## 🔄 **Data Flow Patterns**

### Deployment Workflow
```
1. User triggers deployment
   ↓ orpc.deployment.trigger
2. Get deployment ID
   ↓ orpc.deployment.getStatus (polling)
3. Monitor progress
   ↓ orpc.deployment.getLogs (streaming)
4. View real-time logs
   ↓ orpc.deployment.subscribe (WebSocket)
5. Handle completion/failure
```

### Project Setup
```
1. Create project
   ↓ orpc.project.create
2. Configure settings  
   ↓ orpc.project.updateGeneralConfig
3. Add services
   ↓ orpc.service.create
4. Setup environments
   ↓ orpc.environment.create
5. Deploy services
   ↓ orpc.deployment.trigger
```

## 🚫 **Deprecated/Unused**

### ❌ **Don't Use These**
```typescript
// ❌ CI/CD deployment routes (duplicates main deployment)
orpc.ciCd.deployment.*  // Use orpc.deployment.* instead

// ❌ Direct infrastructure calls (handled by backend)
orpc.traefik.*          // Let backend manage routing
orpc.orchestration.*    // Let backend manage containers  
```

### ⚠️ **Backend Only**
These contracts exist but are not meant for direct frontend usage:
- `traefik` - Automatic routing management
- `orchestration` - Container lifecycle
- `storage` - File operations  
- `analytics` - Metrics collection
- `variable-resolver` - Config processing

## 🛠 **Development Tips**

### Type Safety
```typescript
// Import types for better TypeScript support
import type { 
  Project,
  Service,
  Deployment,
  DeploymentStatus 
} from '@repo/api-contracts';

// Use inferred types from contracts
type DeploymentList = Awaited<ReturnType<typeof orpc.deployment.list>>;
```

### Error Handling
```typescript
// Consistent error handling across contracts
const mutation = orpc.deployment.trigger.mutationOptions({
  onError: (error) => {
    // All contracts return consistent error format
    toast.error(error.message || 'Operation failed');
    console.error('Deployment error:', error);
  }
});
```

### Performance
```typescript
// Optimize with proper stale times
const deployments = orpc.deployment.list.queryOptions({
  input: { serviceId },
  staleTime: 30 * 1000,    // 30 seconds for list
  refetchInterval: false,   // Don't auto-refetch lists
});

const status = orpc.deployment.getStatus.queryOptions({
  input: { deploymentId },
  staleTime: 0,            // Always fresh for status
  refetchInterval: 5000,   // Poll active deployments
});
```

## 📚 **Further Reading**

- **[CONTRACT_ARCHITECTURE.md](./CONTRACT_ARCHITECTURE.md)** - Complete contract documentation
- **[useDeployments.ts](../../apps/web/src/hooks/useDeployments.ts)** - Example usage patterns
- **[ORPC Documentation](https://orpc.io)** - Framework documentation

---

**Need help?** Check the [CONTRACT_ARCHITECTURE.md](./CONTRACT_ARCHITECTURE.md) for detailed information about each contract's responsibilities and usage patterns.