# Error Handling

> **Last Updated**: 2025-11-29

## Overview

The Traefik module uses a hierarchical error class system for precise error handling. All errors extend the base `TraefikError` class and provide specific context for debugging.

## Error Hierarchy

```
Error (JavaScript built-in)
└── TraefikError (base)
    ├── ConfigBuildError          # Builder/compilation failures
    ├── ConfigSyncError           # Synchronization failures
    ├── ConfigValidationError     # Validation failures
    ├── FileSystemError           # Virtual FS failures
    │   ├── FileNotFoundError
    │   ├── FileExistsError
    │   └── InvalidPathError
    ├── TemplateError             # Template rendering failures
    │   ├── TemplateSyntaxError
    │   └── TemplateVariableError
    └── MiddlewareError           # Middleware library failures

Global Errors (core/errors)
├── NotFoundError                 # Generic resource not found
├── ValidationError               # Generic validation error
├── ConflictError                 # Conflicting operations
└── UnauthorizedError             # Permission denied
```

## Base Error Class

```typescript
// apps/api/src/core/modules/traefik/errors/traefik-error.ts
export class TraefikError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'TraefikError';
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      stack: this.stack
    };
  }
}
```

## Specific Error Classes

### ConfigBuildError

Thrown when building configurations fails.

```typescript
export class ConfigBuildError extends TraefikError {
  constructor(
    message: string,
    public readonly builderState?: Record<string, unknown>
  ) {
    super(message, 'CONFIG_BUILD_ERROR', { builderState });
    this.name = 'ConfigBuildError';
  }
}

// Usage
throw new ConfigBuildError(
  'Invalid router configuration: missing service reference',
  { routerName: 'my-router', config: routerConfig }
);
```

### ConfigSyncError

Thrown when syncing to real filesystem fails.

```typescript
export class ConfigSyncError extends TraefikError {
  constructor(
    message: string,
    public readonly configId: string,
    public readonly path?: string,
    public readonly cause?: Error
  ) {
    super(message, 'CONFIG_SYNC_ERROR', { configId, path });
    this.name = 'ConfigSyncError';
    if (cause) {
      this.stack += `\nCaused by: ${cause.stack}`;
    }
  }
}

// Usage
throw new ConfigSyncError(
  'Failed to write config file',
  'cfg_123',
  '/etc/traefik/dynamic/service.yml',
  fsError
);
```

### ConfigValidationError

Thrown when configuration validation fails.

```typescript
export interface ValidationIssue {
  path: string;           // JSON path to issue
  code: string;           // Error code
  message: string;        // Human-readable message
  severity: 'error' | 'warning';
}

export class ConfigValidationError extends TraefikError {
  constructor(
    public readonly issues: ValidationIssue[]
  ) {
    super(
      `Validation failed with ${issues.filter(i => i.severity === 'error').length} error(s)`,
      'CONFIG_VALIDATION_ERROR',
      { issues }
    );
    this.name = 'ConfigValidationError';
  }

  get errors(): ValidationIssue[] {
    return this.issues.filter(i => i.severity === 'error');
  }

  get warnings(): ValidationIssue[] {
    return this.issues.filter(i => i.severity === 'warning');
  }
}

// Usage
throw new ConfigValidationError([
  { path: 'http.routers.my-router.rule', code: 'INVALID_RULE', message: 'Invalid rule syntax', severity: 'error' },
  { path: 'http.services.my-service', code: 'EMPTY_SERVERS', message: 'No servers defined', severity: 'warning' }
]);
```

### FileSystemError Family

```typescript
// Base filesystem error
export class FileSystemError extends TraefikError {
  constructor(
    message: string,
    code: string,
    public readonly path: string
  ) {
    super(message, code, { path });
    this.name = 'FileSystemError';
  }
}

// File not found
export class FileNotFoundError extends FileSystemError {
  constructor(path: string) {
    super(`File not found: ${path}`, 'FILE_NOT_FOUND', path);
    this.name = 'FileNotFoundError';
  }
}

// File already exists
export class FileExistsError extends FileSystemError {
  constructor(path: string) {
    super(`File already exists: ${path}`, 'FILE_EXISTS', path);
    this.name = 'FileExistsError';
  }
}

// Invalid path
export class InvalidPathError extends FileSystemError {
  constructor(path: string, reason?: string) {
    super(
      `Invalid path: ${path}${reason ? ` - ${reason}` : ''}`,
      'INVALID_PATH',
      path
    );
    this.name = 'InvalidPathError';
  }
}
```

### TemplateError Family

```typescript
// Base template error
export class TemplateError extends TraefikError {
  constructor(
    message: string,
    code: string,
    public readonly template?: string
  ) {
    super(message, code, { template: template?.substring(0, 200) });
    this.name = 'TemplateError';
  }
}

// Invalid template syntax
export class TemplateSyntaxError extends TemplateError {
  constructor(
    message: string,
    public readonly line?: number,
    public readonly column?: number,
    template?: string
  ) {
    super(message, 'TEMPLATE_SYNTAX_ERROR', template);
    this.name = 'TemplateSyntaxError';
    this.context = { ...this.context, line, column };
  }
}

// Missing or invalid variable
export class TemplateVariableError extends TemplateError {
  constructor(
    public readonly variableName: string,
    public readonly reason: 'missing' | 'invalid_type' | 'invalid_value'
  ) {
    super(
      `Template variable '${variableName}' ${reason === 'missing' ? 'is not defined' : 'has invalid value'}`,
      'TEMPLATE_VARIABLE_ERROR'
    );
    this.name = 'TemplateVariableError';
    this.context = { ...this.context, variableName, reason };
  }
}
```

### MiddlewareError

```typescript
export class MiddlewareError extends TraefikError {
  constructor(
    message: string,
    public readonly middlewareName: string,
    public readonly middlewareType?: string
  ) {
    super(message, 'MIDDLEWARE_ERROR', { middlewareName, middlewareType });
    this.name = 'MiddlewareError';
  }
}

// Usage
throw new MiddlewareError(
  'Invalid rate limiter configuration: average must be positive',
  'my-rate-limiter',
  'rateLimit'
);
```

## Error Codes Reference

| Code | Class | Description |
|------|-------|-------------|
| `CONFIG_BUILD_ERROR` | ConfigBuildError | Failed to build configuration |
| `CONFIG_SYNC_ERROR` | ConfigSyncError | Failed to sync to filesystem |
| `CONFIG_VALIDATION_ERROR` | ConfigValidationError | Configuration validation failed |
| `FILE_NOT_FOUND` | FileNotFoundError | Virtual file not found |
| `FILE_EXISTS` | FileExistsError | File already exists |
| `INVALID_PATH` | InvalidPathError | Path contains invalid characters |
| `TEMPLATE_SYNTAX_ERROR` | TemplateSyntaxError | Invalid template syntax |
| `TEMPLATE_VARIABLE_ERROR` | TemplateVariableError | Missing or invalid variable |
| `MIDDLEWARE_ERROR` | MiddlewareError | Middleware configuration error |

## Usage Patterns

### Type Guards

```typescript
// Check for specific error type
function isTraefikError(error: unknown): error is TraefikError {
  return error instanceof TraefikError;
}

function isValidationError(error: unknown): error is ConfigValidationError {
  return error instanceof ConfigValidationError;
}

// In catch block
try {
  await syncService.syncServiceConfiguration(configId);
} catch (error) {
  if (isValidationError(error)) {
    // Handle validation errors specifically
    return { success: false, errors: error.errors, warnings: error.warnings };
  }
  if (isTraefikError(error)) {
    // Handle other Traefik errors
    logger.error(`Traefik error [${error.code}]: ${error.message}`, error.context);
    throw error;
  }
  // Unknown error
  throw error;
}
```

### Error Transformation

```typescript
// Transform errors for API response
function toApiError(error: unknown): ApiError {
  if (error instanceof ConfigValidationError) {
    return {
      status: 400,
      code: error.code,
      message: 'Configuration validation failed',
      details: error.issues
    };
  }
  if (error instanceof FileNotFoundError) {
    return {
      status: 404,
      code: error.code,
      message: error.message,
      path: error.path
    };
  }
  if (error instanceof ConfigSyncError) {
    return {
      status: 500,
      code: error.code,
      message: 'Failed to synchronize configuration',
      configId: error.configId
    };
  }
  // Generic error
  return {
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred'
  };
}
```

### Error Logging

```typescript
// Structured logging
class TraefikService {
  private readonly logger = new Logger(TraefikService.name);

  async syncConfig(configId: string) {
    try {
      await this.syncService.syncServiceConfiguration(configId);
    } catch (error) {
      if (error instanceof TraefikError) {
        this.logger.error({
          message: error.message,
          code: error.code,
          context: error.context,
          stack: error.stack
        });
      }
      throw error;
    }
  }
}
```

### Error Recovery

```typescript
// Retry with error handling
async function syncWithRecovery(configId: string): Promise<SyncResult> {
  try {
    await syncService.syncServiceConfiguration(configId);
    return { success: true };
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      // Validation errors are not recoverable
      return { success: false, errors: error.issues };
    }
    
    if (error instanceof ConfigSyncError) {
      // Sync errors might be recoverable
      await sleep(1000);
      try {
        await syncService.syncServiceConfiguration(configId);
        return { success: true, retried: true };
      } catch (retryError) {
        return { success: false, error: retryError.message };
      }
    }
    
    throw error; // Rethrow unknown errors
  }
}
```

## NestJS Exception Filter Integration

```typescript
// Global exception filter for Traefik errors
@Catch(TraefikError)
export class TraefikExceptionFilter implements ExceptionFilter {
  catch(exception: TraefikError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    
    const status = this.getHttpStatus(exception);
    
    response.status(status).json({
      statusCode: status,
      error: exception.name,
      code: exception.code,
      message: exception.message,
      context: exception.context,
      timestamp: new Date().toISOString()
    });
  }
  
  private getHttpStatus(exception: TraefikError): number {
    if (exception instanceof ConfigValidationError) return 400;
    if (exception instanceof FileNotFoundError) return 404;
    if (exception instanceof FileExistsError) return 409;
    if (exception instanceof InvalidPathError) return 400;
    return 500;
  }
}
```

## Best Practices

### 1. Always Include Context

```typescript
// ✅ Good: Include relevant context
throw new ConfigBuildError(
  'Failed to compile router',
  { routerName, rule: routerConfig.rule, entryPoints: routerConfig.entryPoints }
);

// ❌ Bad: No context
throw new ConfigBuildError('Failed to compile router');
```

### 2. Chain Errors

```typescript
// ✅ Good: Preserve original error
try {
  await fs.writeFile(path, content);
} catch (fsError) {
  throw new ConfigSyncError('Write failed', configId, path, fsError);
}

// ❌ Bad: Lose original error
try {
  await fs.writeFile(path, content);
} catch (fsError) {
  throw new ConfigSyncError('Write failed', configId, path);
}
```

### 3. Use Specific Error Classes

```typescript
// ✅ Good: Use specific class
if (!fileExists) {
  throw new FileNotFoundError(path);
}

// ❌ Bad: Use generic error
if (!fileExists) {
  throw new TraefikError('File not found', 'NOT_FOUND', { path });
}
```

### 4. Validate Early

```typescript
// ✅ Good: Validate before operation
if (!isValidPath(path)) {
  throw new InvalidPathError(path, 'Path contains invalid characters');
}
await this.writeFile(path, content);

// ❌ Bad: Let operation fail
await this.writeFile(path, content); // Fails with cryptic error
```
