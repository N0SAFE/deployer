# Provider and Builder Registry Flow

**Created**: October 8, 2025  
**Status**: ✅ COMPLETED

## Overview

This document describes the architectural pattern for managing providers and builders through dedicated registry services. The core principle is **indirection** - the application never directly instantiates or uses providers/builders, but always accesses them through registry services.

## Architecture Principles

### 1. **Registry Pattern**
- **Provider Registry Service**: Central registry for all deployment source providers
- **Builder Registry Service**: Central registry for all build system builders
- Each registry maintains metadata, schemas, and service instances
- Registries are loaded on-demand when needed

### 2. **Separation of Concerns**
- Provider Registry handles source code providers (GitHub, Static, etc.)
- Builder Registry handles build systems (Dockerfile, Static, etc.)
- Each registry is independently managed and testable

### 3. **Lazy Loading**
- Registries are initialized only when accessed
- Services are injected into registries, not created by them
- Reduces startup time and resource usage

## User Flow

### Step 1: Service Creation
```
User → Create Service
  ├─→ Select Provider (from Provider Registry metadata)
  ├─→ Select Builder (from Builder Registry metadata)
  └─→ Get compatible builders for selected provider
```

**API Calls**:
- `GET /providers` - List all available providers
- `GET /providers/:providerId/builders` - Get compatible builders
- `GET /builders` - List all available builders

### Step 2: Service Configuration
```
User → Configure Service
  ├─→ Fetch Provider Schema (GET /providers/:id/schema)
  ├─→ Fetch Builder Schema (GET /builders/:id/schema)
  ├─→ Render Dynamic Forms (frontend)
  ├─→ Validate Provider Config (POST /providers/:id/validate)
  ├─→ Validate Builder Config (POST /builders/:id/validate)
  └─→ Save Service with configs
```

**Data Storage**:
```json
{
  "service": {
    "id": "service-uuid",
    "name": "my-app",
    "providerId": "github",
    "builderId": "dockerfile",
    "providerConfig": {
      "repository": "owner/repo",
      "branch": "main",
      // ... provider-specific config
    },
    "builderConfig": {
      "dockerfilePath": "./Dockerfile",
      "buildArgs": {},
      // ... builder-specific config
    }
  }
}
```

### Step 3: Deployment Execution
```
User → Trigger Deployment
  ├─→ Deployment Service receives request
  ├─→ Load Service from database
  ├─→ Get Provider from Provider Registry
  │   └─→ ProviderRegistry.getProvider(providerId) → IDeploymentProvider instance
  ├─→ Get Builder from Builder Registry
  │   └─→ BuilderRegistry.getBuilder(builderId) → IBuilder instance
  ├─→ Execute Deployment Flow
  │   ├─→ Provider.fetchSourceCode(providerConfig)
  │   ├─→ Builder.build(sourceCode, builderConfig)
  │   └─→ Deploy built artifacts
  └─→ Update deployment status
```

## Registry Services Architecture

### Provider Registry Service

**Location**: `/apps/api/src/core/modules/providers/services/provider-registry.service.ts`

**Responsibilities**:
- Register provider services on initialization
- Maintain provider metadata (id, name, description, icon, category)
- Store provider configuration schemas
- Provide provider lookup by ID
- Return provider instances (not just metadata)

**Key Methods**:
```typescript
class ProviderRegistryService {
  // Registration
  registerProvider(provider: IDeploymentProvider & IProvider): void

  // Metadata Access
  getAllProviders(): ProviderMetadata[]
  getProviderMetadata(id: string): ProviderMetadata | null
  
  // Schema Access
  getProviderSchema(id: string): ConfigSchema | null
  
  // Instance Access (NEW - Critical for deployment)
  getProvider(id: string): IDeploymentProvider | null
  
  // Compatibility
  getCompatibleBuilders(providerId: string): BuilderMetadata[]
  
  // Validation
  validateProviderConfig(providerId: string, config: any): Promise<ValidationResult>
}
```

### Builder Registry Service

**Location**: `/apps/api/src/core/modules/builders/services/builder-registry.service.ts`

**Responsibilities**:
- Register builder services on initialization
- Maintain builder metadata (id, name, description, icon, category)
- Store builder configuration schemas
- Provide builder lookup by ID
- Return builder instances (not just metadata)

**Key Methods**:
```typescript
class BuilderRegistryService {
  // Registration
  registerBuilder(builder: IBuilder): void

  // Metadata Access
  getAllBuilders(): BuilderMetadata[]
  getBuilderMetadata(id: string): BuilderMetadata | null
  
  // Schema Access
  getBuilderSchema(id: string): ConfigSchema | null
  
  // Instance Access (NEW - Critical for deployment)
  getBuilder(id: string): IBuilder | null
  
  // Compatibility
  getCompatibleProviders(builderId: string): ProviderMetadata[]
  
  // Validation
  validateBuilderConfig(builderId: string, config: any): Promise<ValidationResult>
}
```

## Implementation Steps

### Phase 1: Split Registry Services ✅ COMPLETED

1. **Create Builder Registry Service** ✅
   - [x] Created `/apps/api/src/core/modules/builders/services/builder-registry.service.ts`
   - [x] Implemented builder registration and lookup
   - [x] Added `getBuilder(id)` method for instance access
   - [x] Added metadata, schema, validation methods

2. **Update Provider Registry Service** ✅
   - [x] Removed builder-related methods from ProviderRegistryService
   - [x] Added `getProvider(id)` method for instance access
   - [x] Kept only provider-specific functionality
   - [x] Updated return types (null instead of undefined for consistency)

3. **Create Separate Initializers** ✅
   - [x] Created `ProviderRegistryInitializer` (provider-specific only)
   - [x] Created `BuilderRegistryInitializer` (builder-specific only)
   - [x] Each initializer registers only its type

4. **Update Controllers** ✅
   - [x] Updated ProviderSchemaController to inject both registries
   - [x] Implemented cross-registry lookups for compatibility
   - [x] `getCompatibleBuilders`: Provider registry → builder IDs → builder registry → full metadata
   - [x] `getCompatibleProviders`: Builder registry → provider IDs → provider registry → full metadata

5. **Update Module Configuration** ✅
   - [x] Updated ProvidersSchemaModule to provide both registries
   - [x] Registered both initializers
   - [x] Exported both registry services for use in other modules

### Phase 2: Update Deployment Flow

4. **Update Deployment Service** ✅ COMPLETED
   - [x] Inject `ProviderRegistryService` and `BuilderRegistryService`
   - [x] Use `providerRegistry.getProvider(service.provider)` to get provider instance
   - [x] Use `builderRegistry.getBuilder(service.builder)` to get builder instance
   - [x] Replace switch-case buildType logic with registry-based deployment
   - [x] Fetch source files using `provider.fetchSource()`
   - [x] Build and deploy using `builder.deploy()`
   - [x] Handle cleanup of source files after deployment

5. **Update Deployment Module** ✅ COMPLETED
   - [x] Import `ProvidersModule` for provider registry access
   - [x] Import `BuildersModule` for builder registry access
   - [x] Updated module documentation to reflect registry usage

### Phase 3: Update API Controllers

6. **Update Provider Schema Controller** ✅ COMPLETED
   - [x] Uses both `ProviderRegistryService` and `BuilderRegistryService`
   - [x] Cross-registry compatibility lookups implemented

7. **Create Builder Schema Controller** ⏸️ NOT NEEDED
   - Controller handles both providers and builders in single endpoint set
   - Separation maintained at service level, not controller level

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Application Startup                      │
│                                                               │
│  ProviderRegistryInitializer                                 │
│    └─→ Inject all IDeploymentProvider + IProvider services  │
│    └─→ Register each in ProviderRegistryService             │
│                                                               │
│  BuilderRegistryInitializer                                  │
│    └─→ Inject all IBuilder services                         │
│    └─→ Register each in BuilderRegistryService              │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    User Creates Service                      │
│                                                               │
│  1. GET /providers → ProviderRegistryService.getAllProviders()│
│     Returns: [{ id, name, description, category, ... }]      │
│                                                               │
│  2. GET /builders → BuilderRegistryService.getAllBuilders()  │
│     Returns: [{ id, name, description, category, ... }]      │
│                                                               │
│  3. GET /providers/:id/schema → ProviderRegistry.getSchema() │
│     Returns: ConfigSchema with fields                        │
│                                                               │
│  4. GET /builders/:id/schema → BuilderRegistry.getSchema()   │
│     Returns: ConfigSchema with fields                        │
│                                                               │
│  5. POST /services → Save service with:                      │
│     { providerId, builderId, providerConfig, builderConfig } │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   User Triggers Deployment                   │
│                                                               │
│  DeploymentService.deploy(serviceId)                         │
│    ├─→ Load service from database                           │
│    ├─→ provider = ProviderRegistry.getProvider(providerId)  │
│    ├─→ builder = BuilderRegistry.getBuilder(builderId)      │
│    ├─→ sourceCode = provider.fetchSource(providerConfig)    │
│    ├─→ artifact = builder.build(sourceCode, builderConfig)  │
│    └─→ Deploy artifact to infrastructure                     │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Benefits

### 1. **Loose Coupling**
- Services don't directly depend on specific providers/builders
- Easy to add new providers/builders without changing service code
- Runtime provider/builder selection

### 2. **Testability**
- Mock registries for testing
- Test providers/builders in isolation
- Integration tests without full provider/builder stack

### 3. **Flexibility**
- Dynamic provider/builder discovery
- Runtime configuration validation
- Easy feature toggling (enable/disable providers)

### 4. **Performance**
- Lazy initialization of registries
- On-demand service instantiation
- Efficient metadata caching

### 5. **Maintainability**
- Clear separation of concerns
- Single source of truth for provider/builder metadata
- Centralized validation logic

## Migration Strategy

### Backward Compatibility
- Existing services with hardcoded provider/builder references will continue to work
- Gradual migration to registry-based approach
- Database schema supports both approaches during transition

### Rollout Plan
1. **Phase 1**: Create registry services (non-breaking)
2. **Phase 2**: Update deployment flow to use registries (non-breaking)
3. **Phase 3**: Deprecate direct provider/builder usage
4. **Phase 4**: Remove direct dependencies (breaking - major version bump)

## Security Considerations

### Configuration Validation
- All provider/builder configs validated before storage
- Schema-based validation prevents malicious input
- Type-safe configuration objects

### Access Control
- Registry access controlled via NestJS guards
- Provider/builder instances isolated per request
- No shared state between deployments

### Audit Trail
- Log all registry access
- Track which services use which providers/builders
- Monitor for unusual patterns

## Future Enhancements

### Dynamic Provider Loading
- Load providers from external packages
- Plugin system for custom providers
- Hot-reload provider updates

### Provider Versioning
- Support multiple versions of same provider
- Graceful version migrations
- Compatibility checks

### Advanced Routing
- Route deployments to specific provider instances
- Load balancing across provider instances
- Failover between provider implementations

---

**Status**: Ready for implementation  
**Next Steps**: Begin Phase 1 - Split Registry Services
