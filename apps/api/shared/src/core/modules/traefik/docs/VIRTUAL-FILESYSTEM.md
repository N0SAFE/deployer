# Virtual Filesystem

> **Last Updated**: 2025-11-29

## Overview

The Traefik module implements a **virtual filesystem** that stores all configuration files in the database. This provides several advantages over direct filesystem operations:

- **Atomic operations**: Database transactions ensure consistency
- **Version history**: Changes can be tracked and rolled back
- **Multi-node support**: All nodes see the same configuration
- **Access control**: Database-level permissions apply
- **Audit trail**: All operations are timestamped

## Key Principle: Database is Source of Truth

```
┌─────────────────────────────────────────────────────────────────┐
│  DATABASE (Source of Truth)                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  traefik_config_files                                    │   │
│  │  traefik_static_files                                    │   │
│  │  traefik_service_configs                                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│                          │                                      │
│                          │ Sync (one-way)                       │
│                          ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  REAL FILESYSTEM (Cache/Read by Traefik)                 │   │
│  │  /etc/traefik/dynamic/...                                │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Important Rules**:
1. All writes go to the database first
2. Real filesystem is populated via sync operations
3. Never read from real filesystem for application logic
4. Traefik reads from real filesystem (write-only for us)

## TraefikFileSystemService

The main service for virtual filesystem operations.

### Directory Operations

```typescript
// Get complete virtual filesystem tree
const tree = await fileSystemService.getTraefikFileSystem();
// Returns: TraefikFileSystemEntry[]

// Get project-specific filesystem
const projectTree = await fileSystemService.getProjectFileSystem(projectId);

// Get directory listing
const entries = await fileSystemService.listDirectory('/dynamic/projects/');
```

### File Operations

```typescript
// Read file content
const content = await fileSystemService.getFileContent('/dynamic/projects/my-app/service.yml');
// Returns: FileContentResult { content: string, path: string, ... }

// Write file (to database) - simple string content
await fileSystemService.writeFile(
  '/dynamic/projects/my-app/service.yml',
  yamlContent,
  true  // createDirectories (optional, default: true)
);
// Returns: FileOperationResult { success: boolean, filePath: string, action: 'created'|'updated'|'error', ... }

// Delete file (from database)
await fileSystemService.deleteFile('/dynamic/projects/my-app/service.yml');
// Returns: FileOperationResult

// Check if file exists
const exists = await fileSystemService.fileExists('/dynamic/projects/my-app/service.yml');

// Backup file before modification
await fileSystemService.backupFile('/dynamic/projects/my-app/service.yml');
// Returns: FileOperationResult with backupPath
```

### Path Generation

```typescript
// Generate path for service config
// generateServiceConfigPath(serviceId, configId, projectName?)
const path = fileSystemService.generateServiceConfigPath(
  'svc_abc12345',  // serviceId
  'cfg_xyz67890',  // configId  
  'my-project'     // projectName (optional)
);
// Returns: '/dynamic/projects/my-project/svc-abc12345-xyz67890.yml'
// Without projectName: '/dynamic/standalone/svc-abc12345-xyz67890.yml'

// Generate middleware path
// generateMiddlewarePath(middlewareName, middlewareId, isGlobal?)
const middlewarePath = fileSystemService.generateMiddlewarePath(
  'rate-limit',     // middlewareName
  'mw_abc12345',    // middlewareId
  true              // isGlobal (optional, default: false)
);
// Returns: '/middleware/global/rate-limit-mw_abc123.yml' (global)
// Or:      '/middleware/local/rate-limit-mw_abc123.yml' (local)

// Generate SSL certificate path
// generateSSLCertificatePath(domain, certificateId)
const sslPath = fileSystemService.generateSSLCertificatePath(
  'example.com',    // domain
  'cert_abc12345'   // certificateId
);
// Returns: '/certs/example.com-cert_abc1.pem'

// Generate backup path
const backupPath = fileSystemService.generateBackupPath('/dynamic/projects/my-app/service.yml');
// Returns: '/backups/dynamic/projects/my-app/service.yml.bak'
```

## Data Structures

### TraefikFileSystemEntry

```typescript
interface TraefikFileSystemEntry {
  path: string;           // Full virtual path
  name: string;           // File/directory name
  type: 'file' | 'directory';
  size?: number;          // File size in bytes
  mimeType?: string;      // MIME type (files only)
  createdAt?: Date;
  updatedAt?: Date;
  children?: TraefikFileSystemEntry[]; // Directories only
  metadata?: Record<string, unknown>;
}
```

### Virtual Path Structure

```
/                                    # Root
├── traefik.yml                      # Main static config
├── dynamic/                         # Dynamic configurations
│   ├── projects/                    # Project-organized
│   │   └── {projectName}/
│   │       ├── service-{id}.yml     # Service configs
│   │       ├── middleware-{id}.yml  # Service middlewares
│   │       └── tls-{domain}.yml     # TLS options
│   └── standalone/                  # Non-project configs
│       └── service-{id}.yml
├── middleware/                      # Middleware library
│   ├── global/                      # Global middlewares
│   └── local/                       # Project-local middlewares
├── certs/                           # SSL certificates
│   ├── {domain}.cert.pem
│   └── {domain}.key.pem
└── plugins/                         # Plugin configurations
```

## Database Tables

### traefik_config_files

Main table for virtual config files.

```sql
CREATE TABLE traefik_config_files (
  id TEXT PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,        -- Virtual path
  content TEXT NOT NULL,            -- File content (YAML/JSON)
  content_type VARCHAR(100),        -- MIME type
  project_id TEXT REFERENCES projects(id),
  service_config_id TEXT REFERENCES traefik_service_configs(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_synced_at TIMESTAMP,         -- Real FS sync timestamp
  sync_status VARCHAR(20),          -- pending, synced, error
  metadata JSONB                    -- Additional metadata
);

CREATE INDEX idx_config_files_path ON traefik_config_files(path);
CREATE INDEX idx_config_files_project ON traefik_config_files(project_id);
CREATE INDEX idx_config_files_sync ON traefik_config_files(sync_status, updated_at);
```

### traefik_static_files

Static configuration files (rarely change).

```sql
CREATE TABLE traefik_static_files (
  id TEXT PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  content_type VARCHAR(100),
  is_template BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### traefik_backups

Backup copies before modifications.

```sql
CREATE TABLE traefik_backups (
  id TEXT PRIMARY KEY,
  source_path TEXT NOT NULL,
  source_type VARCHAR(50),          -- config_file, static_file
  content TEXT NOT NULL,
  reason VARCHAR(100),              -- update, delete, migration
  created_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB
);

CREATE INDEX idx_backups_source ON traefik_backups(source_path, created_at);
```

## MIME Type Detection

The virtual filesystem internally detects MIME types based on file extensions when storing files. This is used for metadata and content-type headers when downloading files.

```typescript
// MIME type is automatically detected from file extension
await fileSystemService.writeFile('/path/config.yml', yamlContent);
// Internal mimeType: 'application/yaml'

await fileSystemService.writeFile('/path/config.json', jsonContent);
// Internal mimeType: 'application/json'

// When downloading, the correct content-type is returned
const result = await fileSystemService.downloadFile('/path/config.yml');
// result.mimeType: 'application/yaml'
```

### Supported Extensions

| Extension | MIME Type |
|-----------|-----------|
| `.yml`, `.yaml` | `application/yaml` |
| `.json` | `application/json` |
| `.pem` | `application/x-pem-file` |
| `.crt`, `.cert` | `application/x-x509-ca-cert` |
| `.key` | `application/x-pem-file` |
| `.toml` | `application/toml` |
| `.txt` | `text/plain` |
| (other) | `application/octet-stream` |

## Usage Patterns

### Reading Configuration Files

```typescript
// Get all config files for a project
const projectConfigs = await fileSystemService.getProjectFileSystem(projectId);

// Get specific file content
const content = await fileSystemService.getFileContent(
  '/dynamic/projects/my-app/service.yml'
);

// Build a complete tree for UI display
const tree = await fileSystemService.getTraefikFileSystem();
```

### Writing Configuration Files

```typescript
// Write a service configuration
const builder = new TraefikConfigBuilder()
  .addRouter('my-service', router => router
    .rule('Host(`{{domain}}`)')
    .service('my-service')
  )
  .addService('my-service', service => service
    .loadBalancer(lb => lb.server('http://{{host}}:{{port}}'))
  );

// Provide context for variable resolution
const context = {
  domain: 'app.example.com',
  host: 'backend',
  port: '8080'
};

// writeFile takes (path, content, createDirectories?)
await fileSystemService.writeFile(
  '/dynamic/projects/my-project/service-svc_123.yml',
  builder.toYAML(context)
);
```

### Batch Operations

> **⚠️ NOT YET IMPLEMENTED**: Batch operations (`writeFiles`, `deleteFiles`, `moveDirectory`, `moveFile`) are documented but not yet implemented in `TraefikFileSystemService`. Use individual operations for now. This is planned for future implementation.

```typescript
// FUTURE: Write multiple files atomically (transaction)
// await fileSystemService.writeFiles([
//   { path: '/path/file1.yml', content: '...', mimeType: 'application/yaml' },
//   { path: '/path/file2.yml', content: '...', mimeType: 'application/yaml' },
// ]);

// CURRENT: Use individual write operations
await fileSystemService.writeFile('/path/file1.yml', content1);
await fileSystemService.writeFile('/path/file2.yml', content2);

// FUTURE: Delete multiple files atomically
// await fileSystemService.deleteFiles(['/path/file1.yml', '/path/file2.yml']);

// CURRENT: Use individual delete operations
await fileSystemService.deleteFile('/path/file1.yml');
await fileSystemService.deleteFile('/path/file2.yml');
```

### Moving/Renaming Files

> **⚠️ NOT YET IMPLEMENTED**: File/directory move operations are documented but not yet implemented. For now, use read → write → delete pattern.

```typescript
// FUTURE: Move/rename a file
// await fileSystemService.moveFile(
//   '/dynamic/projects/old-name/service.yml',
//   '/dynamic/projects/new-name/service.yml'
// );

// CURRENT: Read, write to new path, delete old
const content = await fileSystemService.getFileContent('/old/path.yml');
await fileSystemService.writeFile('/new/path.yml', content.content);
await fileSystemService.deleteFile('/old/path.yml');
```

## Integration with Sync Service

The virtual filesystem works with TraefikSyncService to write to real filesystem.

```typescript
// 1. Write to virtual filesystem (database)
await fileSystemService.writeFile(path, content);

// 2. Sync to real filesystem (async)
await syncService.syncServiceConfiguration(serviceConfigId);

// Or sync all pending changes
await syncService.syncAllConfigurations();
```

See [SYNC-SYSTEM.md](./SYNC-SYSTEM.md) for details on the synchronization process.

## Error Handling

### FileNotFoundError

```typescript
try {
  const content = await fileSystemService.getFileContent('/nonexistent/path');
} catch (error) {
  if (error instanceof FileNotFoundError) {
    console.log('File does not exist:', error.path);
  }
}
```

### FileExistsError

> **Note**: The current implementation of `writeFile` always overwrites existing files. This error would be thrown if a future `overwrite: false` option is implemented.

```typescript
try {
  // Future: with overwrite protection
  await fileSystemService.writeFile('/existing/path', content, { overwrite: false });
} catch (error) {
  if (error instanceof FileExistsError) {
    console.log('File already exists:', error.path);
  }
}
```

### InvalidPathError

```typescript
try {
  await fileSystemService.writeFile('../../../etc/passwd', 'malicious content');
} catch (error) {
  if (error instanceof InvalidPathError) {
    console.log('Invalid path:', error.path);
  }
}
```

## Best Practices

### 1. Always Use Virtual Paths

```typescript
// ✅ Good: Virtual path
const content = await fileSystemService.getFileContent('/dynamic/projects/app/config.yml');

// ❌ Bad: Real filesystem path
const content = fs.readFileSync('/etc/traefik/dynamic/projects/app/config.yml');
```

### 2. Let the Service Generate Paths

```typescript
// ✅ Good: Use path generators with proper parameters
const path = fileSystemService.generateServiceConfigPath(
  'svc_abc12345',  // serviceId
  'cfg_xyz67890',  // configId
  'my-project'     // projectName
);

// ❌ Bad: Manually construct paths
const path = `/dynamic/projects/${projectName}/service-${id}.yml`;
```

### 3. Use Backup Before Modifications

```typescript
// ✅ Good: Backup before overwriting
const existingContent = await fileSystemService.getFileContent(path);
await fileSystemService.backupFile(path);
await fileSystemService.writeFile(path, newContent);
```

### 4. Handle Batch Operations Carefully

> **Note**: Batch operations are not yet implemented. For now, use try-catch to handle partial failures.

```typescript
// ✅ Good: Handle individual failures gracefully
const filesToWrite = [file1, file2, file3];
const results = [];

for (const file of filesToWrite) {
  const result = await fileSystemService.writeFile(file.path, file.content);
  results.push(result);
  if (!result.success) {
    // Handle failure - could rollback previous writes
    console.error(`Failed to write ${file.path}: ${result.message}`);
  }
}
```
