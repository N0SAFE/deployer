# Synchronization System

> **Last Updated**: 2025-11-29

## Overview

The synchronization system bridges the gap between the database (source of truth) and the real filesystem (read by Traefik). It ensures that Traefik's file provider always has access to the latest configurations.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         TraefikSyncService                              │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │  Sync Engine                                                       │ │
│  │  - Detects changes (updatedAt > lastSyncedAt)                      │ │
│  │  - Writes files to real filesystem                                 │ │
│  │  - Updates sync status in database                                 │ │
│  │  - Emits events on completion                                      │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                              │                                          │
│                              ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │  Filesystem Operations                                             │ │
│  │  - writeRealFile(path, content)                                    │ │
│  │  - deleteRealFile(path)                                            │ │
│  │  - ensureDirectory(path)                                           │ │
│  └───────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
              │                                    ▲
              ▼                                    │
┌─────────────────────────┐           ┌───────────────────────────┐
│  Real Filesystem        │           │  Database                  │
│  /etc/traefik/dynamic/  │           │  traefik_config_files      │
│  (Read by Traefik)      │◀──────────│  traefik_service_configs   │
└─────────────────────────┘   Sync    └───────────────────────────────┘
```

## Sync Strategies

### 1. Incremental Sync (Default)

Only syncs configurations that have changed since last sync.

```typescript
// Sync all pending changes
const result = await syncService.syncAllConfigurations();
// Returns: { synced: 5, failed: 0, skipped: 10 }
```

**Detection Logic**:
```sql
-- Configs needing sync
SELECT * FROM traefik_config_files 
WHERE updated_at > last_synced_at 
   OR last_synced_at IS NULL;
```

### 2. Full Sync (Force)

Forces sync of all configurations regardless of change status.

```typescript
// Force sync everything
const result = await syncService.forceSyncAll();
```

### 3. Targeted Sync

Sync specific configurations.

```typescript
// Sync a single service configuration
await syncService.syncServiceConfiguration(serviceConfigId);

// Sync all configs for a project
await syncService.syncProjectConfigurations(projectId);

// Sync standalone (non-project) configs
await syncService.syncStandaloneConfigurations();
```

## TraefikSyncService API

### Main Methods

```typescript
// Incremental sync
syncAllConfigurations(): Promise<SyncResult>

// Force complete resync
forceSyncAll(): Promise<SyncResult>

// Sync single service
syncServiceConfiguration(serviceConfigId: string): Promise<void>

// Sync project
syncProjectConfigurations(projectId: string): Promise<SyncResult>

// Sync standalone configs
syncStandaloneConfigurations(): Promise<SyncResult>

// Cleanup operations
cleanupOrphanedFiles(): Promise<CleanupResult>
cleanupOrphanedFilesForProject(projectId: string): Promise<CleanupResult>
```

### Sync Result Type

```typescript
interface SyncResult {
  total: number;           // Total configs processed
  synced: number;          // Successfully synced
  failed: number;          // Failed to sync
  skipped: number;         // Already synced / no changes
  errors: SyncError[];     // Details of failures
  duration: number;        // Total time in ms
}

interface SyncError {
  configId: string;
  path: string;
  error: string;
  stack?: string;
}
```

## Sync Process Details

### Per-Configuration Sync Flow

```
1. Get config from database
   │
2. Generate file path
   │
3. Resolve variables (TraefikVariableResolverService)
   │
4. Compile configuration (TraefikConfigBuilder.compile())
   │
5. Generate YAML content (TraefikConfigBuilder.toYAML())
   │
6. Validate content (TraefikValidationService)
   │
7. Write to real filesystem
   │
8. Update sync status in database
   │
9. Emit sync event (TraefikEventService)
```

### Code Example

```typescript
async syncServiceConfiguration(serviceConfigId: string): Promise<void> {
  // 1. Get from database
  const config = await this.repository.getServiceConfig(serviceConfigId);
  if (!config) {
    throw new ConfigNotFoundError(serviceConfigId);
  }
  
  // 2. Generate path
  const path = this.fileSystemService.generateServiceConfigPath({
    projectName: config.project?.name ?? 'standalone',
    serviceId: config.id
  });
  
  // 3. Resolve variables
  const resolvedBuilder = this.variableResolver.resolveBuilder(
    config.config,  // TraefikConfigBuilder from DB
    this.buildVariableContext(config)
  );
  
  // 4-5. Generate YAML
  const content = resolvedBuilder.toYAML();
  
  // 6. Validate
  const validation = await this.validationService.validateConfig(content);
  if (!validation.isValid) {
    await this.repository.updateSyncStatus(config.id, 'error', validation.errors);
    throw new ConfigValidationError(validation.errors);
  }
  
  // 7. Write to filesystem
  const realPath = this.getRealPath(path);
  await this.ensureDirectory(dirname(realPath));
  await fs.writeFile(realPath, content, 'utf-8');
  
  // 8. Update status
  await this.repository.updateSyncStatus(config.id, 'synced');
  
  // 9. Emit event
  this.eventService.emit('configSync', { configId: config.id }, {
    status: 'complete',
    path,
    timestamp: new Date().toISOString()
  });
}
```

## Cleanup Operations

### Orphaned File Cleanup

Removes files from real filesystem that no longer exist in database.

```typescript
// Clean all orphaned files
const result = await syncService.cleanupOrphanedFiles();
// Returns: { removed: 3, errors: [] }

// Clean orphaned files for specific project
await syncService.cleanupOrphanedFilesForProject(projectId);
```

### Cleanup Logic

```
1. List all files in /etc/traefik/dynamic/
   │
2. For each file:
   │  a. Check if corresponding database record exists
   │  b. If no record → mark as orphaned
   │
3. Create backup of orphaned files
   │
4. Delete orphaned files from filesystem
   │
5. Return cleanup report
```

## Event Integration

The sync service emits events for real-time monitoring.

### Sync Events

```typescript
// Event contract
const configSyncContract = contractBuilder('configSync')
  .input(z.object({
    configId: z.string().optional(),
    projectId: z.string().optional()
  }))
  .output(z.object({
    status: z.enum(['started', 'progress', 'complete', 'error']),
    current: z.number().optional(),
    total: z.number().optional(),
    path: z.string().optional(),
    error: z.string().optional()
  }));

// Usage: Subscribe to sync events
const subscription = eventService.subscribe('configSync', { projectId });
for await (const event of subscription) {
  console.log(`Sync ${event.status}: ${event.current}/${event.total}`);
}
```

### Event Timeline

```
Sync Start:   { status: 'started', total: 10 }
    │
Progress:     { status: 'progress', current: 1, total: 10, path: '/dynamic/...' }
Progress:     { status: 'progress', current: 2, total: 10, path: '/dynamic/...' }
    ...
Complete:     { status: 'complete', current: 10, total: 10 }
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TRAEFIK_CONFIG_BASE_PATH` | Base path for Traefik configs | `/etc/traefik` |
| `TRAEFIK_DYNAMIC_PATH` | Path for dynamic configs | `/etc/traefik/dynamic` |
| `TRAEFIK_BACKUP_PATH` | Path for backups | `/var/backups/traefik` |
| `TRAEFIK_SYNC_BATCH_SIZE` | Configs per sync batch | `50` |
| `TRAEFIK_SYNC_INTERVAL` | Auto-sync interval (ms) | `0` (disabled) |

### File Permissions

```typescript
// Sync service file permissions
const FILE_MODE = 0o644;    // rw-r--r--
const DIR_MODE = 0o755;     // rwxr-xr-x
```

## Scheduled Sync

The sync service can be configured for periodic sync.

```typescript
// In TraefikModule configuration
{
  provide: 'TRAEFIK_SYNC_SCHEDULER',
  useFactory: (syncService: TraefikSyncService) => {
    if (process.env.TRAEFIK_SYNC_INTERVAL) {
      const interval = parseInt(process.env.TRAEFIK_SYNC_INTERVAL);
      return setInterval(() => syncService.syncAllConfigurations(), interval);
    }
    return null;
  },
  inject: [TraefikSyncService]
}
```

## Failure Handling

### Retry Strategy

```typescript
interface SyncRetryConfig {
  maxRetries: number;      // Default: 3
  retryDelay: number;      // Default: 1000ms
  backoffMultiplier: number; // Default: 2
}

// Sync with retry
async syncWithRetry(configId: string): Promise<void> {
  for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
    try {
      await this.syncServiceConfiguration(configId);
      return;
    } catch (error) {
      if (attempt === this.config.maxRetries) throw error;
      await sleep(this.config.retryDelay * Math.pow(this.config.backoffMultiplier, attempt - 1));
    }
  }
}
```

### Partial Failure Handling

```typescript
// Sync continues even if individual configs fail
const result = await syncService.syncAllConfigurations();

if (result.failed > 0) {
  // Log failures but don't throw
  for (const error of result.errors) {
    logger.error(`Sync failed for ${error.configId}: ${error.error}`);
  }
  
  // Mark failed configs for retry
  await this.repository.markForRetry(result.errors.map(e => e.configId));
}
```

## Monitoring

### Sync Status Queries

```typescript
// Get configs by sync status
const pending = await repository.getConfigsByStatus('pending');
const failed = await repository.getConfigsByStatus('error');
const synced = await repository.getConfigsByStatus('synced');

// Get last sync timestamp
const lastSync = await repository.getLastSyncTimestamp();

// Get sync statistics
const stats = await repository.getSyncStatistics();
// { total: 100, synced: 95, pending: 3, error: 2 }
```

### Health Check Integration

```typescript
// Sync health check
async checkSyncHealth(): Promise<HealthStatus> {
  const stats = await this.repository.getSyncStatistics();
  const pendingAge = await this.repository.getOldestPendingSync();
  
  if (stats.error > stats.total * 0.1) {
    return { status: 'unhealthy', reason: 'High error rate' };
  }
  
  if (pendingAge && pendingAge > 60000) { // 1 minute
    return { status: 'degraded', reason: 'Old pending syncs' };
  }
  
  return { status: 'healthy' };
}
```

## Best Practices

### 1. Use Events for UI Updates

```typescript
// ✅ Good: Subscribe to events for real-time updates
const subscription = eventService.subscribe('configSync', { projectId });

// ❌ Bad: Polling for sync status
while (true) {
  await sleep(1000);
  const status = await api.getSyncStatus();
}
```

### 2. Batch Operations

```typescript
// ✅ Good: Sync entire project at once
await syncService.syncProjectConfigurations(projectId);

// ❌ Bad: Sync configs one by one
for (const config of configs) {
  await syncService.syncServiceConfiguration(config.id);
}
```

### 3. Handle Errors Gracefully

```typescript
// ✅ Good: Handle partial failures
const result = await syncService.syncAllConfigurations();
if (result.failed > 0) {
  // Notify, log, but don't crash
  await notifyAdmin(result.errors);
}

// ❌ Bad: Let errors crash the process
await syncService.syncAllConfigurations(); // Unhandled error if any fail
```

### 4. Clean Up Regularly

```typescript
// ✅ Good: Schedule regular cleanup
@Cron('0 */6 * * *') // Every 6 hours
async cleanupJob() {
  await this.syncService.cleanupOrphanedFiles();
}
```
