/**
 * Traefik Repository Interfaces
 *
 * Input/Output types for repository operations.
 *
 * @module traefik/interfaces/repository
 */

// ============================================================================
// SERVICE CONFIG
// ============================================================================

/**
 * Input for creating a service configuration
 */
export interface CreateServiceConfigInput {
  /** Service ID */
  serviceId: string;
  /** Domain name */
  domain: string;
  /** Subdomain (optional) */
  subdomain?: string;
  /** Service port */
  port: number;
  /** Enable SSL */
  sslEnabled?: boolean;
  /** SSL provider */
  sslProvider?: 'letsencrypt' | 'selfsigned' | 'custom';
  /** Path prefix for routing */
  pathPrefix?: string;
  /** Middleware configuration */
  middleware?: unknown;
  /** Health check configuration */
  healthCheck?: {
    enabled: boolean;
    path: string;
    interval?: number;
    timeout?: number;
  };
  /** Whether config is active */
  isActive?: boolean;
}

/**
 * Input for updating a service configuration
 */
export interface UpdateServiceConfigInput extends Partial<CreateServiceConfigInput> {
  /** Config ID (required) */
  id: string;
  /** Full domain (auto-generated) */
  fullDomain?: string;
  /** Update timestamp */
  updatedAt?: Date;
}

// ============================================================================
// DOMAIN ROUTES
// ============================================================================

/**
 * Input for creating a domain route
 */
export interface CreateDomainRouteInput {
  /** Associated config ID */
  configId: string;
  /** Host matching rule */
  hostRule: string;
  /** Path matching rule */
  pathRule?: string;
  /** HTTP method filter */
  method?: string;
  /** Header matching rules */
  headers?: unknown;
  /** Route priority */
  priority?: number;
  /** Entry point */
  entryPoint?: string;
  /** Middleware chain */
  middleware?: unknown;
  /** Whether route is active */
  isActive?: boolean;
}

// ============================================================================
// SERVICE TARGETS
// ============================================================================

/**
 * Input for creating a service target
 */
export interface CreateServiceTargetInput {
  /** Associated config ID */
  configId: string;
  /** Target URL */
  url: string;
  /** Load balancer weight */
  weight?: number;
  /** Health check configuration */
  healthCheck?: {
    enabled: boolean;
    path: string;
    interval?: number;
    timeout?: number;
    retries?: number;
  };
  /** Whether target is active */
  isActive?: boolean;
}

// ============================================================================
// SSL CERTIFICATES
// ============================================================================

/**
 * Input for creating an SSL certificate
 */
export interface CreateSSLCertificateInput {
  /** Associated config ID */
  configId: string;
  /** Domain name */
  domain: string;
  /** Subject alternative names */
  subjectAltNames?: string[];
  /** Certificate issuer */
  issuer?: string;
  /** Certificate serial number */
  serialNumber?: string;
  /** Certificate fingerprint */
  fingerprint?: string;
  /** Not valid before */
  notBefore?: Date;
  /** Not valid after */
  notAfter?: Date;
  /** Certificate data (PEM) */
  certificateData?: string;
  /** Private key data (PEM) - should be encrypted */
  privateKeyData?: string;
  /** Auto-renew certificate */
  autoRenew?: boolean;
  /** Days before expiry to renew */
  renewalThreshold?: number;
  /** Whether certificate is active */
  isActive?: boolean;
}

// ============================================================================
// CONFIG FILES
// ============================================================================

/**
 * Input for creating a config file
 */
export interface CreateConfigFileInput {
  /** Associated config ID */
  configId: string;
  /** File name */
  fileName: string;
  /** Absolute file path */
  filePath: string;
  /** Relative path within Traefik config */
  relativePath: string;
  /** File type */
  fileType?: 'traefik' | 'ssl' | 'middleware' | 'config';
  /** MIME type */
  contentType?: string;
  /** File size in bytes */
  size?: number;
  /** Content checksum */
  checksum?: string;
  /** File content */
  content?: string;
  /** Whether file is active */
  isActive?: boolean;
}

// ============================================================================
// MIDDLEWARES
// ============================================================================

/**
 * Middleware types
 */
export type MiddlewareType = 'auth' | 'compression' | 'headers' | 'ratelimit' | 'redirect' | 'custom';

/**
 * Input for creating a middleware
 */
export interface CreateMiddlewareInput {
  /** Middleware name */
  name: string;
  /** Middleware type */
  type: MiddlewareType;
  /** Middleware configuration */
  config: unknown;
  /** Description */
  description?: string;
  /** Whether middleware is global */
  isGlobal?: boolean;
  /** Associated service ID */
  serviceId?: string;
  /** Whether middleware is active */
  isActive?: boolean;
}

// ============================================================================
// HEALTH STATUS
// ============================================================================

/**
 * Health status type
 */
export type HealthStatus = 'healthy' | 'unhealthy' | 'unknown';

/**
 * Sync status type
 */
export type SyncStatus = 'pending' | 'synced' | 'error' | 'failed';
