# Traefik Module Architecture

> **Last Updated**: 2025-11-29

## System Overview

The Traefik module follows a layered architecture with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TraefikCoreModule                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    FACADE LAYER                              │   │
│  │                   TraefikService                             │   │
│  │  (Entry point for all Traefik operations)                    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│         ┌────────────────────┼────────────────────┐                 │
│         ▼                    ▼                    ▼                 │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐           │
│  │  FileSystem │     │    Sync     │     │  Validation │           │
│  │   Service   │     │   Service   │     │   Service   │           │
│  └─────────────┘     └─────────────┘     └─────────────┘           │
│         │                    │                    │                 │
│         ▼                    ▼                    ▼                 │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐           │
│  │  Template   │     │   Variable  │     │   Event     │           │
│  │   Service   │     │   Resolver  │     │   Service   │           │
│  └─────────────┘     └─────────────┘     └─────────────┘           │
│         │                    │                    │                 │
│         └────────────────────┼────────────────────┘                 │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    REPOSITORY LAYER                          │   │
│  │          TraefikRepository / TraefikTemplateRepository       │   │
│  │  (All database operations go through this layer)             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    DATABASE LAYER                            │   │
│  │              PostgreSQL via Drizzle ORM                      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### 1. TraefikService (Facade)

**Role**: Entry point for all Traefik operations. Coordinates between services.

```typescript
@Injectable()
export class TraefikService {
  // Database Operations (Source of Truth)
  createServiceConfiguration()
  getServiceConfiguration()
  updateServiceConfiguration()
  deleteServiceConfiguration()
  
  // Filesystem Operations (Read-Only View)
  getTraefikFileSystem()
  getProjectFileSystem()
  getFileContent()
  
  // Synchronization Operations
  syncServiceConfiguration()
  syncAllConfigurations()
  forceSyncAll()
  cleanupOrphanedFiles()
  
  // High-Level Operations
  deployServiceConfiguration()
  removeServiceConfiguration()
}
```

### 2. TraefikFileSystemService

**Role**: Provides a virtual filesystem abstraction backed by the database.

```typescript
// Virtual FS operations (database)
getTraefikFileSystem()     // Read virtual directory tree
getProjectFileSystem()     // Read project-specific tree
getFileContent()           // Read virtual file content
writeFile()                // Write to database (NOT real FS)
deleteFile()               // Delete from database

// Path generation
generateServiceConfigPath()
generateMiddlewarePath()
generateSSLCertificatePath()
```

**Important**: This service ONLY operates on database storage. Real filesystem operations are handled by TraefikSyncService.

### 3. TraefikSyncService

**Role**: Synchronizes database configurations to the real filesystem.

```typescript
// Sync operations (database → real filesystem)
syncAllConfigurations()
syncServiceConfiguration()
syncProjectConfigurations()
syncStandaloneConfigurations()

// Cleanup operations
cleanupOrphanedFiles()
cleanupOrphanedFilesForProject()

// Real filesystem operations (private)
writeRealFile()    // Write actual file for Traefik
deleteRealFile()   // Delete actual file
```

### 4. TraefikValidationService

**Role**: Validates Traefik configurations before sync.

```typescript
validateConfig(configContent: string): Promise<ValidationResult>
```

**Returns**:
- `isValid`: boolean
- `errors`: validation errors with path and code
- `warnings`: non-critical issues
- `variables`: unresolved variable information

### 5. TraefikTemplateService

**Role**: Manages and renders configuration templates.

```typescript
parseTemplate(template, variables)      // Replace ~##var##~ with values
extractVariables(template)              // Find all variables in template
validateVariables(required, provided)   // Ensure all required vars present
getTemplateForDeployment()              // Get service or provider template
renderTemplateForDeployment()           // Full render with validation
```

### 6. TraefikVariableResolverService

**Role**: Resolves variables in configuration objects.

```typescript
buildVariableMap(context)               // Build var map from context
resolveString(template, context)        // Resolve ~##var##~ in string
resolveConfig(config, context)          // Resolve in entire config object
resolveBuilder(builder, context)        // Resolve in TraefikConfigBuilder
```

### 7. TraefikEventService

**Role**: Emits real-time events for configuration changes.

```typescript
// Event contracts
configSync      // Sync progress events
configChange    // Config modification events
validationResult // Validation result events

// Usage
subscribe('configSync', { configId })   // Subscribe to sync events
emit('configChange', { configId }, data) // Emit change event
```

### 8. TraefikMiddlewareLibraryService

**Role**: Provides pre-built, customizable middleware configurations.

```typescript
getRateLimiter(options)     // Rate limiting middleware
getCors(options)            // CORS headers middleware
getSecurityHeaders()        // Security headers preset
getCompression()            // Compression middleware
getBasicAuth(users)         // Basic authentication
getForwardAuth(address)     // Forward authentication
getRetry(attempts)          // Retry middleware
getCircuitBreaker(expr)     // Circuit breaker
```

## Data Flow

### Configuration Creation Flow

```
1. Client calls TraefikService.deployServiceConfiguration()
   │
2. TraefikService validates input
   │
3. TraefikRepository.createServiceConfig() - saves to database
   │
4. TraefikEventService.emit('configChange', { action: 'created' })
   │
5. TraefikSyncService.syncServiceConfiguration() - writes to real FS
   │
6. TraefikEventService.emit('configSync', { status: 'complete' })
```

### Configuration Read Flow

```
1. Client calls TraefikService.getFileContent(path)
   │
2. TraefikFileSystemService.getVirtualFileContent(path)
   │
3. TraefikRepository.getConfigByPath() - reads from database
   │
4. Returns content (never reads from real filesystem)
```

### Sync Flow

```
1. Client calls TraefikService.syncAllConfigurations()
   │
2. TraefikSyncService.getTraefikConfigsNeedingSync()
   │  (Only gets configs where updatedAt > lastSyncedAt)
   │
3. For each config:
   │  a. Generate YAML content
   │  b. TraefikSyncService.writeRealFile() - write to disk
   │  c. TraefikRepository.updateSyncStatus() - mark synced
   │  d. TraefikEventService.emit('configSync')
   │
4. Return summary (successful, failed, total)
```

## Database Schema Overview

### Core Tables

| Table | Description |
|-------|-------------|
| `traefik_service_configs` | Main service configurations |
| `traefik_domain_routes` | Domain routing rules |
| `traefik_service_targets` | Load balancer targets |
| `traefik_ssl_certificates` | SSL certificate data |
| `traefik_middlewares` | Middleware configurations |
| `traefik_config_files` | Virtual filesystem files |
| `traefik_static_files` | Static configuration files |
| `traefik_backups` | Configuration backups |

### Key Relationships

```
projects (1) ──┬──> services (n)
               │
               └──> traefik_service_configs (1)
                    │
                    ├──> traefik_domain_routes (n)
                    ├──> traefik_service_targets (n)
                    ├──> traefik_ssl_certificates (n)
                    └──> traefik_config_files (n)
```

## Dependency Graph

```
                TraefikCoreModule
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   DatabaseModule  EventsModule  ConfigModule
        │
        ▼
      GlobalDatabaseService
        │
        ▼
   Drizzle ORM → PostgreSQL
```

### Service Dependencies (No Circular Deps)

```
TraefikService (facade)
├── TraefikRepository ✓
├── TraefikFileSystemService ✓
└── TraefikSyncService ✓

TraefikSyncService
├── TraefikRepository ✓
└── TraefikFileSystemService ✓ (for path generation only)

TraefikFileSystemService
└── TraefikRepository ✓

TraefikValidationService
└── TraefikVariableResolverService ✓

TraefikEventService
└── (no dependencies on other traefik services) ✓
```

## Error Handling Architecture

```
TraefikError (base)
├── ConfigBuildError      # Builder failures
├── ConfigSyncError       # Sync failures
├── ConfigValidationError # Validation failures
├── FileSystemError       # Virtual FS failures
└── TemplateError         # Template rendering failures

GlobalErrors (core/errors)
├── NotFoundError         # Resource not found
├── ValidationError       # General validation
└── ConflictError         # Conflicting operations
```

## Event Architecture

```
TraefikEventService
├── Contracts
│   ├── configSync (input: configId, output: progress/status)
│   ├── configChange (input: configId, output: action/metadata)
│   └── validationResult (input: configId, output: errors/warnings)
│
├── Strategies
│   ├── ABORT - New request aborts previous
│   ├── QUEUE - Sequential processing
│   ├── PARALLEL - Concurrent processing
│   └── IGNORE - Skip if already processing
│
└── Integration
    └── BaseEventService → AsyncIterator → SSE/WebSocket
```

## File System Structure (Real FS)

```
/etc/traefik/                    # TRAEFIK_CONFIG_BASE_PATH
├── traefik.yml                  # Main static config
├── dynamic/                     # Dynamic configs (synced)
│   ├── projects/                # Project-organized configs
│   │   └── {projectName}/
│   │       └── service-{id}.yml
│   └── standalone/              # Non-project configs
│       └── service-{id}.yml
├── ssl/                         # SSL certificates
├── middleware/                  # Middleware configs
│   ├── global/
│   └── local/
├── certs/                       # Certificate files
└── plugins/                     # Traefik plugins

/var/backups/traefik/            # TRAEFIK_BACKUP_PATH
└── *.backup.{timestamp}         # Backup files
```

## Security Considerations

1. **Secret Storage**: SSL keys must be encrypted at rest
2. **Access Control**: Repository methods enforce project-level access
3. **Audit Trail**: All changes tracked via timestamps
4. **Backup**: Automatic backup before destructive operations
