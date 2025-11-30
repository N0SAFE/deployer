/**
 * Traefik Sync Service Interfaces
 *
 * Types for configuration synchronization operations.
 *
 * @module traefik/interfaces/sync
 */

// ============================================================================
// TRAEFIK CONFIG DATA (for sync operations)
// ============================================================================

/**
 * Traefik configuration data for sync operations
 * Represents the raw data from database that needs syncing
 */
export interface TraefikConfigData {
  /** Config ID */
  id: string;
  /** Config name */
  configName: string | null;
  /** Config type (service, middleware, etc.) */
  configType: string;
  /** Storage type */
  storageType: string;
  /** Project ID (if project-based) */
  projectId?: string | null;
  /** Project name (if project-based) */
  projectName?: string | null;
  /** Configuration content (YAML) */
  configContent: string;
  /** Whether config is active */
  isActive?: boolean | null;
  /** Created timestamp */
  createdAt?: Date | null;
  /** Updated timestamp */
  updatedAt?: Date | null;
  /** Last synced timestamp */
  lastSyncedAt?: Date | null;
}

/**
 * Complete service configuration with all related data
 */
export interface CompleteServiceConfig {
  /** Config ID */
  id: string;
  /** Service ID */
  serviceId: string;
  /** Domain name */
  domain?: string | null;
  /** Full domain */
  fullDomain: string;
  /** Service host */
  serviceHost?: string | null;
  /** Service port */
  servicePort?: number | null;
  /** Port (alias for servicePort) */
  port?: number | null;
  /** SSL enabled */
  sslEnabled?: boolean | null;
  /** SSL provider */
  sslProvider?: string | null;
  /** Service targets */
  serviceTargets?: ServiceTarget[];
  /** Domain routes */
  domainRoutes?: DomainRoute[];
  /** Middlewares */
  middlewares?: MiddlewareData[];
  /** Whether config is active */
  isActive?: boolean | null;
}

/**
 * Service target for load balancing
 */
export interface ServiceTarget {
  /** Target ID */
  id: string;
  /** Target URL */
  url: string;
  /** Weight for load balancing */
  weight?: number | null;
  /** Health check config */
  healthCheck?: {
    enabled: boolean;
    path: string;
    interval?: number;
    timeout?: number;
    retries?: number;
  } | null;
  /** Whether target is active */
  isActive?: boolean | null;
}

/**
 * Domain route configuration
 * Note: fullDomain is NOT on domain routes - it's on the parent config
 */
export interface DomainRoute {
  /** Route ID */
  id: string;
  /** Config ID (foreign key) */
  configId: string;
  /** Host rule (e.g., "Host(`api.example.com`)") */
  hostRule: string;
  /** Path rule (e.g., "PathPrefix(`/api`)") */
  pathRule?: string | null;
  /** HTTP method filter */
  method?: string | null;
  /** Header-based routing */
  headers?: unknown;
  /** Priority */
  priority?: number | null;
  /** Entry point (web, websecure, etc.) */
  entryPoint?: string | null;
  /** Route-specific middleware */
  middleware?: unknown;
  /** Whether route is active */
  isActive?: boolean | null;
  /** Created timestamp */
  createdAt?: Date | null;
  /** Updated timestamp */
  updatedAt?: Date | null;
}

/**
 * Middleware configuration data
 * Note: Uses 'config' field to match database schema (traefikMiddlewares)
 */
export interface MiddlewareData {
  /** Middleware ID */
  id: string;
  /** Middleware name */
  name: string;
  /** Middleware type */
  type: 'auth' | 'compression' | 'headers' | 'ratelimit' | 'redirect' | 'custom';
  /** Middleware configuration (matches 'config' column in database) */
  config: unknown;
  /** Description */
  description?: string | null;
  /** Whether middleware is global */
  isGlobal?: boolean | null;
  /** Service ID (null for global middleware) */
  serviceId?: string | null;
  /** Whether middleware is active */
  isActive?: boolean | null;
  /** Created timestamp */
  createdAt?: Date | null;
  /** Updated timestamp */
  updatedAt?: Date | null;
}

/**
 * Middleware configuration - can be an object or stringified JSON
 */
export type MiddlewareConfiguration = Record<string, unknown> | string | null | undefined;

// ============================================================================
// SYNC RESULT
// ============================================================================

/**
 * Action types for sync operations
 */
export type SyncAction = 'created' | 'updated' | 'deleted' | 'skipped' | 'error';

/**
 * Result of a sync operation
 */
export interface SyncResult {
  /** Config ID */
  configId: string;
  /** Config name */
  configName: string;
  /** Whether sync succeeded */
  success: boolean;
  /** Action performed */
  action: SyncAction;
  /** Message describing result */
  message: string;
  /** File path that was synced */
  filePath?: string;
  /** Error message if failed */
  error?: string;
  /** Size of synced file */
  size?: number;
  /** Content checksum */
  checksum?: string;
  /** Timestamp of sync */
  syncedAt?: Date;
}

// ============================================================================
// SYNC SUMMARY
// ============================================================================

/**
 * Summary of a sync operation
 */
export interface SyncSummary {
  /** Total configs processed */
  total: number;
  /** Successfully synced */
  successful: number;
  /** Failed to sync */
  failed: number;
  /** Skipped (already synced) */
  skipped?: number;
  /** Individual sync results */
  results: SyncResult[];
  /** Total duration in milliseconds */
  duration?: number;
  /** Start timestamp */
  startedAt?: Date;
  /** End timestamp */
  completedAt?: Date;
}

// ============================================================================
// SYNC OPTIONS
// ============================================================================

/**
 * Options for sync operations
 */
export interface SyncOptions {
  /** Force sync even if not needed */
  force?: boolean;
  /** Only sync specific project */
  projectId?: string;
  /** Dry run (don't write files) */
  dryRun?: boolean;
  /** Create backup before overwriting */
  backup?: boolean;
  /** Delete orphan files */
  cleanOrphans?: boolean;
}

// ============================================================================
// CLEANUP RESULT
// ============================================================================

/**
 * Result of cleanup operation
 */
export interface CleanupResult {
  /** Files that were deleted */
  deletedFiles: string[];
  /** Files that failed to delete */
  failedDeletes: {
    path: string;
    error: string;
  }[];
  /** Total files deleted */
  totalDeleted: number;
  /** Total failures */
  totalFailed: number;
}
