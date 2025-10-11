# Service Context System - Architecture Diagram

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         APPLICATION LAYER                                │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐      │
│  │ DeploymentService│  │   Docker Service │  │  Health Monitor  │      │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘      │
│           │                     │                     │                 │
└───────────┼─────────────────────┼─────────────────────┼─────────────────┘
            │                     │                     │
            │                     │                     │
┌───────────▼─────────────────────▼─────────────────────▼─────────────────┐
│                      DEPLOYMENT ORCHESTRATOR                             │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │               buildServiceContext(serviceId)                    │    │
│  │                                                                 │    │
│  │  1. Query Database (service, deployment, project)              │    │
│  │  2. Generate Default Domain                                    │    │
│  │  3. Build ServiceContext with ServiceContextBuilder            │    │
│  │  4. Return Unified Context                                     │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │               updateRouting(serviceId, url)                     │    │
│  │                                                                 │    │
│  │  1. Build ServiceContext                                       │    │
│  │  2. Get Traefik Config from DB                                 │    │
│  │  3. Resolve Variables using Context                            │    │
│  │  4. Write Config to Filesystem                                 │    │
│  │  5. Log Primary Domain URL                                     │    │
│  └────────────────────────────────────────────────────────────────┘    │
└───────────┬──────────────────────┬───────────────────────┬──────────────┘
            │                      │                       │
            │                      │                       │
┌───────────▼──────────────────────▼───────────────────────▼──────────────┐
│                         CONTEXT LAYER                                    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │             ServiceContextService                                │   │
│  │                                                                  │   │
│  │  • createServiceContext()    → Build from DB entities           │   │
│  │  • createProjectContext()    → Build with services              │   │
│  │  • generateDefaultDomain()   → Auto-generate domain             │   │
│  │  • addDomainToService()      → Add named domain                 │   │
│  │  • setPrimaryDomain()        → Set primary flag                 │   │
│  │  • getDomainOrPrimary()      → Extract domain                   │   │
│  │  • getMergedEnvironment()    → Merge project + service env      │   │
│  │  • toTraefikContext()        → Convert to Traefik vars          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │             ServiceContext (Type)                                │   │
│  │                                                                  │   │
│  │  service     → { id, name, type, description }                  │   │
│  │  deployment  → { id, containerName, port, environment, status } │   │
│  │  domains     → Record<string, DomainConfig>                     │   │
│  │  project     → { id, name, baseDomain }                         │   │
│  │  network     → { name, id, ports, protocols }                   │   │
│  │  paths       → { healthCheck, prefix }                          │   │
│  │  routing     → { rules, middlewares, priority }                 │   │
│  │  environment → Record<string, string>                           │   │
│  │  resources   → { cpu, memory, storage }                         │   │
│  │  healthCheck → { enabled, path, interval, timeout }             │   │
│  │  custom      → Record<string, any>                              │   │
│  │  getProjectContext() → Bidirectional reference                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │             ContextUtils (Static Utilities)                      │   │
│  │                                                                  │   │
│  │  • toTraefikVariableContext()  → Convert to VariableResolution  │   │
│  │  • getAllDomains()             → Extract all domains            │   │
│  │  • getDomainOrPrimary()        → Get specific or primary domain │   │
│  │  • getMergedEnvironment()      → Merge env variables            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└───────────┬──────────────────────────────────────────────┬──────────────┘
            │                                              │
            │                                              │
┌───────────▼──────────────────────────────────────────────▼──────────────┐
│                         TRAEFIK LAYER                                    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │         TraefikVariableResolverService                           │   │
│  │                                                                  │   │
│  │  Legacy Methods:                                                │   │
│  │  • buildVariableMap(context)                                    │   │
│  │  • resolveString(template, context)                             │   │
│  │  • resolveConfig(config, context)                               │   │
│  │  • resolveBuilder(builder, context)                             │   │
│  │                                                                  │   │
│  │  New Context-Based Methods:                                     │   │
│  │  • buildVariableMapFromServiceContext(serviceContext) ✨        │   │
│  │  • resolveStringFromServiceContext(template, ctx) ✨            │   │
│  │  • resolveConfigFromServiceContext(config, ctx) ✨              │   │
│  │  • resolveBuilderFromServiceContext(builder, ctx) ✨            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │         TRAEFIK_VARIABLES Registry                              │   │
│  │                                                                  │   │
│  │  SERVICE_NAME, SERVICE_ID, SERVICE_TYPE                         │   │
│  │  DEPLOYMENT_ID, CONTAINER_NAME, CONTAINER_PORT                  │   │
│  │  DOMAIN, SUBDOMAIN, FULL_DOMAIN, BASE_DOMAIN, HOST ✨           │   │
│  │  CERT_FILE, KEY_FILE, CERT_RESOLVER                             │   │
│  │  PATH_PREFIX, HEALTH_CHECK_PATH                                 │   │
│  │  NETWORK_NAME, NETWORK_ID                                       │   │
│  │  PROJECT_ID, PROJECT_NAME                                       │   │
│  │  ... and more                                                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Context Building Flow

```
┌────────────┐
│  Database  │
│            │
│ services   │──┐
│ deployments│  │
│ projects   │  │
└────────────┘  │
                │
                ▼
┌──────────────────────────────────────┐
│ DeploymentOrchestrator               │
│ .buildServiceContext(serviceId)      │
│                                      │
│  1. Query service by ID              │
│  2. Query latest deployment          │
│  3. Query project                    │
└──────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────┐
│ ServiceContextService                │
│ .generateDefaultDomain()             │
│                                      │
│  serviceName: "api"                  │
│  projectName: "my-app"               │
│  baseDomain: "example.com"           │
│  environment: "production"           │
│         │                            │
│         ▼                            │
│  "api-production.example.com"        │
└──────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────┐
│ ServiceContextBuilder                │
│                                      │
│  .withService({ id, name, type })    │
│  .withDeployment({ id, container })  │
│  .withDomains({ default: domain })   │
│  .withProject({ id, name })          │
│  .withNetwork({ name })              │
│  .withPaths({ healthCheck })         │
│  .withEnvironment({ ... })           │
│  .build()                            │
└──────────────────────────────────────┘
                │
                ▼
        ┌──────────────┐
        │ServiceContext│
        └──────────────┘
```

### 2. Variable Resolution Flow

```
┌──────────────┐
│ServiceContext│
└──────┬───────┘
       │
       ▼
┌────────────────────────────────────────┐
│ ContextUtils                           │
│ .toTraefikVariableContext()            │
│                                        │
│  Maps ServiceContext → Variable Map:  │
│  • service → SERVICE_NAME, etc.       │
│  • deployment → CONTAINER_NAME, etc.  │
│  • domains.primary → HOST, DOMAIN     │
│  • project → PROJECT_NAME, etc.       │
│  • network → NETWORK_NAME, etc.       │
└────────────────────────────────────────┘
       │
       ▼
┌────────────────────────────────────────┐
│ VariableResolutionContext              │
│                                        │
│  service: { id, name, type }          │
│  deployment: { id, containerName }    │
│  domain: { fullDomain, baseDomain }   │
│  project: { id, name }                │
│  ssl: { certResolver }                │
│  path: { healthCheck, prefix }        │
└────────────────────────────────────────┘
       │
       ▼
┌────────────────────────────────────────┐
│ TraefikVariableResolverService         │
│ .resolveBuilderFromServiceContext()    │
│                                        │
│  Template: "Host(`~##host##~`)"       │
│  Variable: ~##host##~ → fullDomain    │
│  Result: "Host(`api-prod.example.com`)"│
└────────────────────────────────────────┘
       │
       ▼
┌────────────────────────────────────────┐
│ Resolved Traefik Config                │
│                                        │
│  http:                                │
│    routers:                           │
│      api-prod:                        │
│        rule: "Host(`api-prod...`)"    │
│        service: "api-prod-service"    │
│    services:                          │
│      api-prod-service:                │
│        loadBalancer:                  │
│          servers:                     │
│            - url: "http://container"  │
└────────────────────────────────────────┘
       │
       ▼
┌────────────────────────────────────────┐
│ Filesystem                             │
│                                        │
│  /app/traefik-configs/                │
│    service-{id}.yml                   │
└────────────────────────────────────────┘
```

## Domain Configuration

```
┌─────────────────────────────────────────────────────────────┐
│                    DomainConfig                              │
│                                                              │
│  name: "production"                                          │
│  fullDomain: "api-production.example.com"                    │
│  baseDomain: "example.com"                                   │
│  subdomain: "api-production"                                 │
│  isPrimary: true                                             │
│  ssl: {                                                      │
│    enabled: true                                             │
│    provider: "letsencrypt"                                   │
│    certResolver: "default"                                   │
│  }                                                           │
│  pathPrefix: "/api"                                          │
│  metadata: { ... }                                           │
└─────────────────────────────────────────────────────────────┘

Multiple Domains per Service:

┌────────────────┐
│ ServiceContext │
│                │
│ domains: {     │
│   production   │──→ isPrimary: true  → api.example.com
│   staging      │──→ isPrimary: false → api-staging.example.com
│   custom       │──→ isPrimary: false → custom.domain.com
│ }              │
└────────────────┘
```

## Bidirectional References

```
┌──────────────────────────────────────────────────────────┐
│                   ProjectContext                          │
│                                                           │
│  project: { id: "proj-1", name: "my-app" }               │
│                                                           │
│  servicesContext: {                                      │
│    api    ──→ ServiceContext (with getProjectContext())  │
│    web    ──→ ServiceContext (with getProjectContext())  │
│    worker ──→ ServiceContext (with getProjectContext())  │
│  }                                                        │
└──────────────────────────────────────────────────────────┘
                           ▲
                           │
                    Proxy Reference
                           │
                           │
┌──────────────────────────┼───────────────────────────────┐
│        ServiceContext    │                                │
│                         │                                │
│  service: { id, name }  │                                │
│  domains: { ... }       │                                │
│                         │                                │
│  getProjectContext() ───┘                                │
│    Returns: ProjectContext with all services             │
└──────────────────────────────────────────────────────────┘

Access Pattern:
• Service → Project: serviceContext.getProjectContext()
• Project → Service: projectContext.servicesContext['api']
• Service → Sibling: serviceContext.getProjectContext().servicesContext['web']
```

## Integration Points

```
┌─────────────────────────────────────────────────────────────┐
│                     CURRENT INTEGRATIONS                     │
└─────────────────────────────────────────────────────────────┘

✅ DeploymentOrchestrator
   • buildServiceContext()
   • updateRouting() with context

✅ TraefikVariableResolverService
   • resolveBuilderFromServiceContext()
   • Context-to-variable conversion

✅ ContextModule
   • Exported in CoreModule
   • Available globally

┌─────────────────────────────────────────────────────────────┐
│                     PENDING INTEGRATIONS                     │
└─────────────────────────────────────────────────────────────┘

⏳ DeploymentService
   • Use context for deployment config

⏳ DeploymentHealthMonitor
   • Context-aware health checks

⏳ EnvironmentResolverService
   • Context-based env resolution

⏳ DockerService
   • Container config from context

⏳ Database Schema
   • Domain configuration tables

⏳ ORPC Contracts
   • Domain management APIs

⏳ Frontend
   • Domain management UI
```

## Benefits Summary

```
┌────────────────────────────────────────────────────────────────┐
│                        BEFORE                                   │
└────────────────────────────────────────────────────────────────┘

const context: VariableResolutionContext = {
  service: { id, name, type },
  deployment: { id, containerName, containerPort, ... },
  domain: { domain, subdomain, fullDomain, baseDomain },
  project: { id, name },
  ssl: { certFile, keyFile, certResolver },
  path: { prefix, healthCheck },
  network: { name, id },
  route: { ... },
  custom: { ... }
};

Issues:
❌ 100+ lines of manual mapping
❌ No type safety across services
❌ Scattered domain logic
❌ Difficult to maintain
❌ No domain management

┌────────────────────────────────────────────────────────────────┐
│                        AFTER                                    │
└────────────────────────────────────────────────────────────────┘

const serviceContext = await this.buildServiceContext(serviceId);

Benefits:
✅ Single line context building
✅ Complete type safety
✅ Centralized domain logic
✅ Easy to maintain
✅ Multi-domain support
✅ 50% code reduction
✅ Bidirectional references
```

---

**Legend:**
- ✨ New context-based method
- ✅ Implemented
- ⏳ Pending
- ❌ Old problem
- → Data flow
