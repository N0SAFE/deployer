# Features Documentation

Feature-specific implementation details organized by domain.

## 🎯 Feature Documentation

### Context & Service Management
- [**SERVICE-CONTEXT-SYSTEM.md**](./SERVICE-CONTEXT-SYSTEM.md) - Service and project context system with domain management
- [**DEPLOYMENT-CONTEXT-INTEGRATION.md**](./DEPLOYMENT-CONTEXT-INTEGRATION.md) - How deployment services use the context system

### Deployment Features
- [**COMPLETE-DEPLOYMENT-FLOW.md**](./COMPLETE-DEPLOYMENT-FLOW.md) - End-to-end deployment flow
- [**deployment/**](./deployment/) - Deployment-specific features:
  - [DEPLOYMENT-HEALTH-RULES.md](./deployment/DEPLOYMENT-HEALTH-RULES.md) - Health monitoring rules
  - [DEPLOYMENT-STATUS-SEMANTICS.md](./deployment/DEPLOYMENT-STATUS-SEMANTICS.md) - Status definitions
  - [DEPLOYMENT-CONFIGURATION-RULES.md](./deployment/DEPLOYMENT-CONFIGURATION-RULES.md) - Configuration rules
  - [DEPLOYMENT-RETENTION.md](./deployment/DEPLOYMENT-RETENTION.md) - Retention policies
  - [DEPLOYMENT-CLEANUP-IMPLEMENTATION.md](./deployment/DEPLOYMENT-CLEANUP-IMPLEMENTATION.md) - Cleanup implementation
  - [ROLLBACK-STATUS-FILTERING.md](./deployment/ROLLBACK-STATUS-FILTERING.md) - Rollback filtering

### Provider System
- [**PROVIDER-BUILDER-REGISTRY-FLOW.md**](./PROVIDER-BUILDER-REGISTRY-FLOW.md) - Provider builder registry flow
- [**PROVIDER-BUILDER-REGISTRY-IMPLEMENTATION-SUMMARY.md**](./PROVIDER-BUILDER-REGISTRY-IMPLEMENTATION-SUMMARY.md) - Implementation summary
- [**FRONTEND-PROVIDER-BUILDER-IMPLEMENTATION.md**](./FRONTEND-PROVIDER-BUILDER-IMPLEMENTATION.md) - Frontend provider builder

### GitHub Integration
- [**github-provider/**](./github-provider/) - GitHub-specific features:
  - [GITHUB-PROVIDER-COMPREHENSIVE-GUIDE.md](./github-provider/GITHUB-PROVIDER-COMPREHENSIVE-GUIDE.md) - Complete guide
  - [GITHUB-PROVIDER-IMPLEMENTATION.md](./github-provider/GITHUB-PROVIDER-IMPLEMENTATION.md) - Implementation details
  - [GITHUB-PROVIDER-MULTI-TENANT-SUMMARY.md](./github-provider/GITHUB-PROVIDER-MULTI-TENANT-SUMMARY.md) - Multi-tenant support

### Infrastructure
- [**TRAEFIK-CONFIGURATION-VARIABLES.md**](./TRAEFIK-CONFIGURATION-VARIABLES.md) - Traefik configuration
- [**docker/**](./docker/) - Docker-specific features:
  - [DOCKER-BUILD-STRATEGIES.md](./docker/DOCKER-BUILD-STRATEGIES.md) - Build strategies
  - [DOCKER-STORAGE-MANAGEMENT.md](./docker/DOCKER-STORAGE-MANAGEMENT.md) - Storage management
  - [DOCKER-FILE-OWNERSHIP-FIX.md](./docker/DOCKER-FILE-OWNERSHIP-FIX.md) - File ownership handling

### Database
- [**database/**](./database/) - Database features:
  - [DATABASE-ENCRYPTION-IMPLEMENTATION.md](./database/DATABASE-ENCRYPTION-IMPLEMENTATION.md) - Encryption implementation

### Testing
- [**testing/**](./testing/) - Testing features:
  - [TESTING-IMPLEMENTATION-SUMMARY.md](./testing/TESTING-IMPLEMENTATION-SUMMARY.md) - Testing setup
  - [PHASE-TRACKING-IMPLEMENTATION.md](./testing/PHASE-TRACKING-IMPLEMENTATION.md) - Phase tracking
  - [PHASE-TRACKING-IMPLEMENTATION-SUMMARY.md](./testing/PHASE-TRACKING-IMPLEMENTATION-SUMMARY.md) - Phase tracking summary

## 🔙 Navigation

- [← Back to Documentation Home](../README.md)
