# API Reference

> **Last Updated**: 2025-01-29

## TraefikService (Facade)

The main entry point for all Traefik operations. This service coordinates database operations, filesystem operations, and synchronization.

### Service Configuration Operations

#### createServiceConfiguration

Creates a new service configuration for a specific service.

```typescript
createServiceConfiguration(
  serviceId: string,
  config: Omit<CreateServiceConfigInput, 'serviceId'>
): Promise<TraefikServiceConfig | null>
```

**Parameters**:
- `serviceId`: The service identifier to create configuration for
- `config`: Configuration data (excludes serviceId which is provided separately)

```typescript
interface CreateServiceConfigInput {
  serviceId: string;
  domain?: string | null;
  fullDomain?: string | null;
  serviceHost?: string | null;
  servicePort?: number | null;
  sslEnabled?: boolean | null;
  sslProvider?: string | null;
  isActive?: boolean | null;
  metadata?: Record<string, unknown> | null;
}
```

**Returns**: Created `TraefikServiceConfig` or `null`.

---

#### getServiceConfiguration

Retrieves a complete service configuration by config ID.

```typescript
getServiceConfiguration(configId: string): Promise<CompleteServiceConfig | null>
```

**Parameters**:
- `configId`: Service configuration ID

**Returns**: `CompleteServiceConfig` with all related data (service targets, domain routes, middlewares) or `null`.

```typescript
interface CompleteServiceConfig {
  id: string;
  serviceId: string;
  domain?: string | null;
  fullDomain: string;
  serviceHost?: string | null;
  servicePort?: number | null;
  port?: number | null;
  sslEnabled?: boolean | null;
  sslProvider?: string | null;
  serviceTargets?: ServiceTarget[];
  domainRoutes?: DomainRoute[];
  middlewares?: MiddlewareData[];
  isActive?: boolean | null;
}
```

---

#### updateServiceConfiguration

Updates an existing service configuration.

```typescript
updateServiceConfiguration(
  configId: string,
  updates: Omit<UpdateServiceConfigInput, 'id'>
): Promise<TraefikServiceConfig | null>
```

**Parameters**:
- `configId`: Service configuration ID
- `updates`: Partial update data

**Returns**: Updated `TraefikServiceConfig` or `null`.

---

#### deleteServiceConfiguration

Deletes a service configuration.

```typescript
deleteServiceConfiguration(configId: string): Promise<TraefikServiceConfig | null>
```

**Parameters**:
- `configId`: Service configuration ID

**Returns**: Deleted `TraefikServiceConfig` or `null`.

---

#### getAllServiceConfigurations

Gets all service configurations with optional filtering by active status.

```typescript
getAllServiceConfigurations(isActive?: boolean): Promise<TraefikServiceConfig[]>
```

**Parameters**:
- `isActive`: Optional filter for active/inactive configurations

**Returns**: Array of `TraefikServiceConfig` objects.

---

### Domain Route Management

#### addDomainRoute

Adds a domain route to a configuration.

```typescript
addDomainRoute(
  configId: string,
  routeConfig: Omit<CreateDomainRouteInput, 'configId'>
): Promise<DomainRoute | null>
```

---

#### updateDomainRoute

Updates a domain route.

```typescript
updateDomainRoute(
  routeId: string,
  updates: Partial<Omit<CreateDomainRouteInput, 'configId'>>
): Promise<DomainRoute | null>
```

---

#### deleteDomainRoute

Deletes a domain route.

```typescript
deleteDomainRoute(routeId: string): Promise<DomainRoute | null>
```

---

### Service Target Management

#### addServiceTarget

Adds a service target to a configuration for load balancing.

```typescript
addServiceTarget(
  configId: string,
  targetConfig: Omit<CreateServiceTargetInput, 'configId'>
): Promise<ServiceTarget | null>
```

---

#### updateServiceTarget

Updates a service target.

```typescript
updateServiceTarget(
  targetId: string,
  updates: Partial<Omit<CreateServiceTargetInput, 'configId'>>
): Promise<ServiceTarget | null>
```

---

#### deleteServiceTarget

Deletes a service target.

```typescript
deleteServiceTarget(targetId: string): Promise<ServiceTarget | null>
```

---

### SSL Certificate Management

#### addSSLCertificate

Adds an SSL certificate to a configuration.

```typescript
addSSLCertificate(
  configId: string,
  certConfig: Omit<CreateSSLCertificateInput, 'configId'>
): Promise<SSLCertificate | null>
```

---

#### updateSSLCertificate

Updates an SSL certificate.

```typescript
updateSSLCertificate(
  certId: string,
  updates: Partial<Omit<CreateSSLCertificateInput, 'configId'>>
): Promise<SSLCertificate | null>
```

---

#### deleteSSLCertificate

Deletes an SSL certificate.

```typescript
deleteSSLCertificate(certId: string): Promise<SSLCertificate | null>
```

---

### Middleware Management

#### createMiddleware

Creates a new middleware.

```typescript
createMiddleware(middlewareConfig: CreateMiddlewareInput): Promise<Middleware | null>
```

```typescript
interface CreateMiddlewareInput {
  name: string;
  type: 'auth' | 'compression' | 'headers' | 'ratelimit' | 'redirect' | 'custom';
  config: unknown;
  description?: string | null;
  isGlobal?: boolean | null;
  serviceId?: string | null;
  isActive?: boolean | null;
}
```

---

#### getMiddlewares

Gets middlewares with optional filtering.

```typescript
getMiddlewares(serviceId?: string, isGlobal?: boolean): Promise<Middleware[]>
```

**Parameters**:
- `serviceId`: Filter by service ID
- `isGlobal`: Filter for global middlewares only

---

#### updateMiddleware

Updates a middleware.

```typescript
updateMiddleware(
  middlewareId: string,
  updates: Partial<Omit<CreateMiddlewareInput, 'serviceId'>>
): Promise<Middleware | null>
```

---

#### deleteMiddleware

Deletes a middleware.

```typescript
deleteMiddleware(middlewareId: string): Promise<Middleware | null>
```

---

### Filesystem Operations

#### getTraefikFileSystem

Returns the virtual filesystem tree.

```typescript
getTraefikFileSystem(path?: string): Promise<VirtualDirectoryTree>
```

**Parameters**:
- `path`: Optional path to get subtree from

**Returns**: Tree structure of virtual files and directories.

---

#### getProjectFileSystem

Returns the filesystem tree for a specific project.

```typescript
getProjectFileSystem(projectName: string): Promise<VirtualDirectoryTree>
```

**Parameters**:
- `projectName`: Project name (not ID)

**Returns**: Tree structure of project files.

---

#### getFileContent

Reads content of a virtual file.

```typescript
getFileContent(filePath: string): Promise<FileContentResult>
```

**Parameters**:
- `filePath`: Virtual file path (e.g., `/dynamic/projects/my-app/service.yml`)

**Returns**: `FileContentResult` with content, size, and mimeType.

**Throws**: `FileNotFoundError` if file doesn't exist.

---

#### downloadFile

Downloads a file with appropriate headers.

```typescript
downloadFile(filePath: string): Promise<DownloadResult>
```

**Returns**: `DownloadResult` with content, size, mimeType, and filename.

---

#### listProjects

Lists all projects with Traefik configurations.

```typescript
listProjects(): Promise<string[]>
```

**Returns**: Array of project names.

---

### Synchronization Operations

#### syncServiceConfiguration

Synchronizes a single service configuration to the real filesystem.

```typescript
syncServiceConfiguration(serviceId: string): Promise<SyncResult>
```

**Parameters**:
- `serviceId`: Service ID (not config ID - the method looks up the config internally)

**Returns**:
```typescript
interface SyncResult {
  configId: string;
  configName: string;
  success: boolean;
  action: SyncAction;  // 'created' | 'updated' | 'deleted' | 'skipped' | 'error'
  message: string;
  filePath?: string;
  error?: string;
  size?: number;
  checksum?: string;
  syncedAt?: Date;
}
```

**Throws**: `ConfigNotFoundError` if no config exists for the service.

---

#### syncAllConfigurations

Synchronizes all pending configurations.

```typescript
syncAllConfigurations(): Promise<SyncSummary>
```

**Returns**:
```typescript
interface SyncSummary {
  total: number;       // Total configs processed
  successful: number;  // Successfully synced
  failed: number;      // Failed to sync
  skipped?: number;    // Skipped (already synced)
  results: SyncResult[];  // Individual sync results
  duration?: number;      // Total duration in milliseconds
  startedAt?: Date;
  completedAt?: Date;
}
```

---

#### forceSyncAll

Forces synchronization of all configurations (optionally for a specific project).

```typescript
forceSyncAll(projectName?: string): Promise<{
  total: number;
  successful: number;
  failed: number;
  results: {
    configId: string;
    configName: string;
    success: boolean;
    action: string;
    message?: string;
  }[];
}>
```

**Parameters**:
- `projectName`: Optional project name to sync only that project's configs

---

#### cleanupOrphanedFiles

Removes files from real filesystem that no longer exist in database.

```typescript
cleanupOrphanedFiles(projectName?: string): Promise<SyncSummary>
```

**Parameters**:
- `projectName`: Optional project name to cleanup only that project

---

### High-Level Operations

#### deployServiceConfiguration

Creates or updates and syncs a service configuration in one operation.

```typescript
deployServiceConfiguration(
  serviceId: string,
  config: Omit<CreateServiceConfigInput, 'serviceId'>
): Promise<{
  configuration: TraefikServiceConfig | null;
  syncResult: SyncResult;
}>
```

**Returns**: Object containing created/updated configuration and sync result.

---

#### removeServiceConfiguration

Marks a configuration as inactive and cleans up filesystem.

```typescript
removeServiceConfiguration(serviceId: string): Promise<{
  success: true;
  message: string;
}>
```

**Throws**: `ConfigNotFoundError` if configuration doesn't exist.

---

#### getHealthStatus

Gets health status of Traefik configurations.

```typescript
getHealthStatus(): Promise<HealthCheckSummary>
```

---

#### validateConfiguration

Validates a configuration by ID.

```typescript
validateConfiguration(configId: string): Promise<ValidationResult>
```

**Returns**:
```typescript
interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  variables?: VariableInfo[];
  data?: Record<string, unknown>;
}

interface ValidationError {
  variable?: string;
  path: string;
  message: string;
  code?: string;
  value?: unknown;
}

interface ValidationWarning {
  variable?: string;
  path: string;
  message: string;
  code?: string;
}
```

**Throws**: `ConfigNotFoundError` if configuration doesn't exist.

---

## TraefikFileSystemService

Virtual filesystem operations backed by database.

### Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `getTraefikFileSystem(path?)` | Get complete or partial tree | `VirtualDirectoryTree` |
| `getProjectFileSystem(projectName)` | Get project tree | `VirtualDirectoryTree` |
| `getFileContent(path)` | Read file content | `FileContentResult` |
| `downloadFile(path)` | Get file for download | `DownloadResult` |
| `fileExists(path)` | Check existence | `boolean` |
| `listProjects()` | List project names | `string[]` |
| `generateServiceConfigPath(serviceId, configId, projectName?)` | Generate standard path | `string` |
| `generateMiddlewarePath(middlewareName, middlewareId, isGlobal?)` | Generate middleware path | `string` |
| `generateSSLCertificatePath(domain, certificateId)` | Generate cert path | `string` |

> **Note**: Batch operations (`writeFiles`, `deleteFiles`, `moveDirectory`) are not yet implemented. Currently, file writing is handled through the sync service which writes to the real filesystem based on database state.

---

## TraefikSyncService

Synchronization from database to real filesystem.

### Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `syncAllConfigurations()` | Sync all pending configs | `SyncSummary` |
| `syncServiceConfiguration(configId)` | Sync single config | `SyncResult` |
| `syncTraefikConfigurationById(configId)` | Sync by config ID | `SyncResult` |
| `syncProjectConfigurations(projectName)` | Sync project configs | `SyncSummary` |
| `syncStandaloneConfigurations()` | Sync standalone configs | `SyncSummary` |
| `cleanupOrphanedFiles()` | Remove orphan files | `SyncSummary` |
| `cleanupOrphanedFilesForProject(projectName)` | Remove project orphans | `SyncSummary` |
| `deleteConfigurationFile(configId)` | Delete specific file | `SyncResult` |

---

## TraefikValidationService

Configuration validation.

### validateConfig

Validates a Traefik configuration content. Returns **synchronously** (not Promise).

```typescript
validateConfig(content: string): ValidationResult
```

**Parameters**:
- `content`: YAML or JSON configuration content

**Returns**: `ValidationResult` (synchronous, not Promise)

---

## TraefikTemplateService

Template parsing and rendering using `~##variableName##~` syntax.

### Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `parseTemplate(template, vars)` | Render template with variables | `string` |
| `extractVariables(template)` | Find all variables in template | `string[]` |
| `validateVariables(required, provided)` | Check required variables exist | `{ valid: boolean; missing: string[] }` |
| `getProviderTemplate(providerType)` | Get provider template | `ProviderTraefikTemplate \| null` |
| `getServiceTemplate(serviceId)` | Get service template | `ServiceTraefikTemplate \| null` |
| `createProviderTemplate(data)` | Create provider template | `ProviderTraefikTemplate` |
| `createServiceTemplate(data)` | Create service template | `ServiceTraefikTemplate` |
| `updateServiceTemplate(id, updates)` | Update service template | `ServiceTraefikTemplate` |
| `getTemplateForDeployment(serviceId, providerType)` | Get deployment template | `{ template: string; variables: TemplateVariables } \| null` |
| `renderTemplateForDeployment(serviceId, providerType, vars)` | Full render | `string \| null` |

---

## TraefikVariableResolverService

Variable resolution for `~##variableName##~` syntax.

### Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `buildVariableMap(context)` | Build variable map from context | `Record<string, string>` |
| `resolveVariables(template, context)` | Resolve variables in string | `string` |
| `validateVariables(variables, context)` | Validate variable values | `ValidationResult` |

### Built-in Variables (TRAEFIK_VARIABLES)

| Variable | Example |
|----------|---------|
| `~##domain##~` | `example.com` |
| `~##subdomain##~` | `api` |
| `~##fullDomain##~` | `api.example.com` |
| `~##host##~` | `api.example.com` |
| `~##serviceName##~` | `my-service` |
| `~##serviceId##~` | `svc_123` |
| `~##containerName##~` | `project-http-abc` |
| `~##containerPort##~` | `80` |
| `~##routerName##~` | `my-router` |
| `~##entryPoint##~` | `websecure` |
| `~##projectId##~` | `proj_123` |
| `~##projectName##~` | `my-project` |

---

## TraefikEventService

Real-time events using ORPC event contracts.

### Subscription Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `subscribeToSync(filter)` | Subscribe to sync events | `AsyncIterator` |
| `subscribeToChanges(filter)` | Subscribe to change events | `AsyncIterator` |
| `subscribeToValidation(filter)` | Subscribe to validation events | `AsyncIterator` |
| `subscribeToCleanup(filter)` | Subscribe to cleanup events | `AsyncIterator` |

### Emit Methods

| Method | Description |
|--------|-------------|
| `emitSyncStarted(input, total)` | Emit sync started |
| `emitSyncProgress(input, current, total, path)` | Emit sync progress |
| `emitSyncComplete(input, total)` | Emit sync complete |
| `emitSyncError(input, error)` | Emit sync error |
| `emitSyncSkipped(input)` | Emit sync skipped |
| `emitConfigCreated(configId, configType, projectId?, configName?, metadata?)` | Emit config created |
| `emitConfigUpdated(configId, configType, projectId?, configName?, metadata?)` | Emit config updated |
| `emitConfigDeleted(configId, configType, projectId?, configName?)` | Emit config deleted |
| `emitValidationResult(configId, isValid, errors, warnings, unresolvedVars?)` | Emit validation result |
| `emitCleanupStarted(projectId?, total?)` | Emit cleanup started |
| `emitCleanupProgress(projectId, current, total, path)` | Emit cleanup progress |
| `emitCleanupComplete(projectId, removed)` | Emit cleanup complete |
| `emitCleanupError(projectId, error)` | Emit cleanup error |

### Event Contracts

```typescript
// Config Sync Contract
interface ConfigSyncInput {
  configId?: string;
  projectId?: string;
  serviceId?: string;
}

interface ConfigSyncOutput {
  status: 'started' | 'progress' | 'complete' | 'error' | 'skipped';
  configId?: string;
  current?: number;
  total?: number;
  path?: string;
  error?: string;
  timestamp: string;
}

// Config Change Contract
interface ConfigChangeInput {
  configId?: string;
  projectId?: string;
}

interface ConfigChangeOutput {
  action: 'created' | 'updated' | 'deleted';
  configId: string;
  configType: 'service' | 'middleware' | 'certificate' | 'template' | 'static';
  configName?: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

// Validation Result Contract
interface ValidationResultInput {
  configId: string;
}

interface ValidationResultOutput {
  configId: string;
  isValid: boolean;
  errors: { path: string; code: string; message: string }[];
  warnings: { path: string; code: string; message: string }[];
  unresolvedVariables?: string[];
  timestamp: string;
}

// Cleanup Contract
interface CleanupInput {
  projectId?: string;
}

interface CleanupOutput {
  status: 'started' | 'progress' | 'complete' | 'error';
  removed?: number;
  current?: number;
  total?: number;
  path?: string;
  error?: string;
  timestamp: string;
}
```

---

## TraefikMiddlewareLibraryService

Pre-built middleware configurations.

### Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `getRateLimiter(options)` | Rate limiting middleware | `MiddlewareConfig` |
| `getCors(options)` | CORS headers middleware | `MiddlewareConfig` |
| `getSecurityHeaders(options)` | Security headers middleware | `MiddlewareConfig` |
| `getStrictSecurityHeaders(name?)` | Pre-configured strict security | `MiddlewareConfig` |
| `getCompression(options)` | Compression middleware | `MiddlewareConfig` |
| `getBasicAuth(options)` | Basic auth middleware | `MiddlewareConfig` |
| `getForwardAuth(options)` | Forward auth middleware | `MiddlewareConfig` |
| `getRetry(options)` | Retry middleware | `MiddlewareConfig` |
| `getCircuitBreaker(options)` | Circuit breaker middleware | `MiddlewareConfig` |
| `getStripPrefix(options)` | Strip prefix middleware | `MiddlewareConfig` |
| `getAddPrefix(options)` | Add prefix middleware | `MiddlewareConfig` |
| `getReplacePath(options)` | Replace path middleware | `MiddlewareConfig` |
| `getReplacePathRegex(options)` | Replace path regex middleware | `MiddlewareConfig` |
| `getRedirectScheme(options)` | Redirect scheme middleware | `MiddlewareConfig` |
| `getRedirectRegex(options)` | Redirect regex middleware | `MiddlewareConfig` |
| `getHttpsRedirect(name?)` | Pre-configured HTTPS redirect | `MiddlewareConfig` |
| `getIPAllowList(options)` | IP allow list middleware | `MiddlewareConfig` |
| `getHeaders(options)` | Custom headers middleware | `MiddlewareConfig` |
| `getBuffering(options)` | Buffering middleware | `MiddlewareConfig` |
| `getApiChain(options)` | API middleware chain | `MiddlewareChain` |
| `getWebAppChain(options)` | Web app middleware chain | `MiddlewareChain` |
| `getAdminChain(options)` | Admin middleware chain | `MiddlewareChain` |

### Return Types

```typescript
interface MiddlewareConfig {
  name: string;
  config: Record<string, unknown>;
}

interface MiddlewareChain {
  name: string;
  middlewares: MiddlewareConfig[];
  chain: Record<string, unknown>;
}
```

---

## TraefikConfigBuilder

Type-safe builder for creating Traefik configurations.

### Static Methods

```typescript
// Load configuration from YAML string, JSON string, or object
static load(input: string | TraefikConfig): TraefikConfigBuilder

// Convert config object to YAML string
static toYAMLString(config: TraefikConfig): string
```

### Instance Methods

```typescript
class TraefikConfigBuilder {
  // Add components using builder pattern
  addRouter(name: string, builderOrFn: HttpRouterBuilder | ((builder: HttpRouterBuilder) => HttpRouterBuilder)): this;
  addService(name: string, builderOrFn: ServiceBuilder | ((builder: ServiceBuilder) => ServiceBuilder)): this;
  addMiddleware(name: string, builderOrFn: MiddlewareBuilder | ((builder: MiddlewareBuilder) => MiddlewareBuilder)): this;
  configureTLS(builderOrFn: TLSBuilder | ((builder: TLSBuilder) => TLSBuilder)): this;
  
  // Variable registry
  getVariableRegistry(): VariableRegistry;
  
  // Build without variable resolution
  build(): TraefikConfig;
  
  // Compile with variable resolution
  compile(context: VariableContext, options?: CompilationOptions): TraefikConfig;
  
  // Export formats (requires context for variable resolution)
  toJSON(context: VariableContext, options?: CompilationOptions): string;
  toYAML(context: VariableContext, options?: CompilationOptions): string;
  
  // Preview what variables will be resolved
  preview(context: VariableContext): {
    found: string[];
    missing: string[];
    total: number;
  };
  
  // Clone the builder
  clone(): TraefikConfigBuilder;
  
  // Get statistics about the configuration
  getStats(): {
    routers: number;
    services: number;
    middlewares: number;
    variables: number;
    hasTLS: boolean;
  };
}
```

> **Note**: The builder uses `addRouter`, `addService`, `addMiddleware` to add components. Getter methods like `getRouter()`, `updateRouter()`, `removeRouter()` are **not implemented**. Use `build()` to get the raw config, then modify as needed and use `load()` to create a new builder.

---

## Data Types

### TraefikServiceConfig

Database model for service configurations.

```typescript
interface TraefikServiceConfig {
  id: string;
  serviceId: string;
  domain?: string | null;
  fullDomain?: string | null;
  serviceHost?: string | null;
  servicePort?: number | null;
  sslEnabled?: boolean | null;
  sslProvider?: string | null;
  isActive?: boolean | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  lastSyncedAt?: Date | null;
}
```

### VirtualFileItem

```typescript
interface VirtualFileItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  lastModified?: string;
  extension?: string;
  mimeType?: string;
  isReadable: boolean;
  isWritable: boolean;
  content?: string;
  projectId?: string;
  configId?: string;
}
```

### VirtualDirectoryTree

```typescript
interface VirtualDirectoryTree {
  name: string;
  path: string;
  files: VirtualFileItem[];
  subdirectories: VirtualDirectoryTree[];
}
```

---

## HTTP Endpoints

> **Status**: Future Implementation  
> The HTTP endpoints listed below are planned but not yet implemented. They document the expected REST API surface for the Traefik module.

### Service Configurations

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/traefik/services` | Create service config |
| `GET` | `/traefik/services` | List service configs |
| `GET` | `/traefik/services/:id` | Get service config |
| `PATCH` | `/traefik/services/:id` | Update service config |
| `DELETE` | `/traefik/services/:id` | Delete service config |
| `POST` | `/traefik/services/:id/sync` | Sync service config |
| `POST` | `/traefik/services/:id/deploy` | Deploy service config |

### Filesystem

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/traefik/filesystem` | Get complete tree |
| `GET` | `/traefik/filesystem/:projectName` | Get project tree |
| `GET` | `/traefik/files/*path` | Get file content |

### Synchronization

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/traefik/sync` | Sync all pending |
| `POST` | `/traefik/sync/force` | Force sync all |
| `POST` | `/traefik/sync/project/:projectName` | Sync project |
| `POST` | `/traefik/cleanup` | Cleanup orphans |

### Events (SSE)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/traefik/events/sync` | Sync events stream |
| `GET` | `/traefik/events/changes` | Change events stream |

### Middlewares

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/traefik/middlewares` | Create middleware |
| `GET` | `/traefik/middlewares` | List middlewares |
| `GET` | `/traefik/middlewares/:id` | Get middleware |
| `PATCH` | `/traefik/middlewares/:id` | Update middleware |
| `DELETE` | `/traefik/middlewares/:id` | Delete middleware |

### SSL Certificates

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/traefik/certificates` | Store certificate |
| `GET` | `/traefik/certificates` | List certificates |
| `GET` | `/traefik/certificates/:domain` | Get certificate |
| `DELETE` | `/traefik/certificates/:domain` | Delete certificate |
