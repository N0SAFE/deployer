/**
 * Traefik Middleware Library Interfaces
 *
 * Types for the pre-built middleware configuration library.
 *
 * @module traefik/interfaces/middleware-library
 */

// ============================================================================
// RATE LIMITING
// ============================================================================

/**
 * Rate limiter middleware options
 */
export interface RateLimiterOptions {
  /** Middleware name */
  name: string;
  /** Average requests per period */
  average: number;
  /** Maximum burst size */
  burst?: number;
  /** Time period (e.g., '1s', '1m') */
  period?: string;
  /** Source criterion for rate limiting */
  sourceCriterion?: {
    ipStrategy?: {
      depth?: number;
      excludedIPs?: string[];
    };
    requestHeaderName?: string;
    requestHost?: boolean;
  };
}

// ============================================================================
// CORS
// ============================================================================

/**
 * CORS middleware options
 */
export interface CorsMiddlewareOptions {
  /** Middleware name */
  name: string;
  /** Allowed origins */
  allowOrigins: string[];
  /** Allowed HTTP methods */
  allowMethods?: string[];
  /** Allowed headers */
  allowHeaders?: string[];
  /** Exposed headers */
  exposeHeaders?: string[];
  /** Max age in seconds */
  maxAge?: number;
  /** Allow credentials */
  allowCredentials?: boolean;
}

// ============================================================================
// SECURITY HEADERS
// ============================================================================

/**
 * Security headers middleware options
 */
export interface SecurityHeadersOptions {
  /** Middleware name */
  name: string;
  /** Content Security Policy */
  contentSecurityPolicy?: string;
  /** HSTS configuration */
  strictTransportSecurity?: {
    maxAge: number;
    includeSubDomains?: boolean;
    preload?: boolean;
  };
  /** X-Content-Type-Options: nosniff */
  contentTypeNosniff?: boolean;
  /** X-Frame-Options */
  frameOptions?: 'DENY' | 'SAMEORIGIN';
  /** X-XSS-Protection */
  xssProtection?: string;
  /** Referrer-Policy */
  referrerPolicy?: string;
  /** Permissions-Policy */
  permissionsPolicy?: string;
}

// ============================================================================
// COMPRESSION
// ============================================================================

/**
 * Compression middleware options
 */
export interface CompressionOptions {
  /** Middleware name */
  name: string;
  /** Content types to exclude */
  excludedContentTypes?: string[];
  /** Minimum response body size to compress */
  minResponseBodyBytes?: number;
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

/**
 * Basic auth middleware options
 */
export interface BasicAuthOptions {
  /** Middleware name */
  name: string;
  /** Users in htpasswd format */
  users: string[];
  /** Realm name */
  realm?: string;
  /** Remove auth header after validation */
  removeHeader?: boolean;
  /** Custom header field */
  headerField?: string;
}

/**
 * Forward auth middleware options
 */
export interface ForwardAuthOptions {
  /** Middleware name */
  name: string;
  /** Auth service address */
  address: string;
  /** Trust X-Forwarded-* headers */
  trustForwardHeader?: boolean;
  /** Headers to copy from auth response */
  authResponseHeaders?: string[];
  /** Regex to match headers from auth response */
  authResponseHeadersRegex?: string;
  /** Headers to send to auth service */
  authRequestHeaders?: string[];
  /** TLS configuration */
  tls?: {
    ca?: string;
    cert?: string;
    key?: string;
    insecureSkipVerify?: boolean;
  };
}

// ============================================================================
// RESILIENCE
// ============================================================================

/**
 * Retry middleware options
 */
export interface RetryOptions {
  /** Middleware name */
  name: string;
  /** Number of retry attempts */
  attempts: number;
  /** Initial retry interval */
  initialInterval?: string;
}

/**
 * Circuit breaker middleware options
 */
export interface CircuitBreakerOptions {
  /** Middleware name */
  name: string;
  /** Expression to evaluate circuit state */
  expression: string;
  /** Check period */
  checkPeriod?: string;
  /** Fallback duration */
  fallbackDuration?: string;
  /** Recovery duration */
  recoveryDuration?: string;
}

// ============================================================================
// PATH MANIPULATION
// ============================================================================

/**
 * Strip prefix middleware options
 */
export interface StripPrefixOptions {
  /** Middleware name */
  name: string;
  /** Prefixes to strip */
  prefixes: string[];
  /** Force trailing slash */
  forceSlash?: boolean;
}

/**
 * Add prefix middleware options
 */
export interface AddPrefixOptions {
  /** Middleware name */
  name: string;
  /** Prefix to add */
  prefix: string;
}

/**
 * Replace path middleware options
 */
export interface ReplacePathOptions {
  /** Middleware name */
  name: string;
  /** New path */
  path: string;
}

/**
 * Replace path regex middleware options
 */
export interface ReplacePathRegexOptions {
  /** Middleware name */
  name: string;
  /** Regex pattern */
  regex: string;
  /** Replacement string */
  replacement: string;
}

// ============================================================================
// REDIRECTS
// ============================================================================

/**
 * Redirect scheme middleware options
 */
export interface RedirectSchemeOptions {
  /** Middleware name */
  name: string;
  /** Target scheme */
  scheme: 'http' | 'https';
  /** Permanent redirect (301) */
  permanent?: boolean;
  /** Optional port override */
  port?: string;
}

/**
 * Redirect regex middleware options
 */
export interface RedirectRegexOptions {
  /** Middleware name */
  name: string;
  /** Regex pattern */
  regex: string;
  /** Replacement URL */
  replacement: string;
  /** Permanent redirect (301) */
  permanent?: boolean;
}

// ============================================================================
// IP FILTERING
// ============================================================================

/**
 * IP allow list middleware options
 */
export interface IPAllowListOptions {
  /** Middleware name */
  name: string;
  /** Allowed IP ranges (CIDR) */
  sourceRange: string[];
  /** IP strategy configuration */
  ipStrategy?: {
    depth?: number;
    excludedIPs?: string[];
  };
}

// ============================================================================
// HEADERS
// ============================================================================

/**
 * Custom headers middleware options
 */
export interface HeadersOptions {
  /** Middleware name */
  name: string;
  /** Custom request headers */
  customRequestHeaders?: Record<string, string>;
  /** Custom response headers */
  customResponseHeaders?: Record<string, string>;
  /** Access-Control-Allow-Credentials */
  accessControlAllowCredentials?: boolean;
  /** Access-Control-Allow-Headers */
  accessControlAllowHeaders?: string[];
  /** Access-Control-Allow-Methods */
  accessControlAllowMethods?: string[];
  /** Access-Control-Allow-Origin-List */
  accessControlAllowOriginList?: string[];
  /** Access-Control-Expose-Headers */
  accessControlExposeHeaders?: string[];
  /** Access-Control-Max-Age */
  accessControlMaxAge?: number;
  /** Add Vary header */
  addVaryHeader?: boolean;
  /** Hosts proxy headers */
  hostsProxyHeaders?: string[];
  /** SSL proxy headers */
  sslProxyHeaders?: Record<string, string>;
  /** STS seconds */
  stsSeconds?: number;
  /** STS include subdomains */
  stsIncludeSubdomains?: boolean;
  /** STS preload */
  stsPreload?: boolean;
  /** Force STS header */
  forceSTSHeader?: boolean;
  /** Frame deny */
  frameDeny?: boolean;
  /** Content-Type nosniff */
  contentTypeNosniff?: boolean;
  /** Browser XSS filter */
  browserXssFilter?: boolean;
  /** Content Security Policy */
  contentSecurityPolicy?: string;
  /** Referrer Policy */
  referrerPolicy?: string;
  /** Permissions Policy */
  permissionsPolicy?: string;
  /** Is development mode */
  isDevelopment?: boolean;
}

// ============================================================================
// BUFFERING
// ============================================================================

/**
 * Buffering middleware options
 */
export interface BufferingOptions {
  /** Middleware name */
  name: string;
  /** Max request body bytes */
  maxRequestBodyBytes?: number;
  /** Memory request body bytes */
  memRequestBodyBytes?: number;
  /** Max response body bytes */
  maxResponseBodyBytes?: number;
  /** Memory response body bytes */
  memResponseBodyBytes?: number;
  /** Retry expression */
  retryExpression?: string;
}

// ============================================================================
// MIDDLEWARE CHAINS
// ============================================================================

/**
 * API middleware chain options
 */
export interface ApiChainOptions {
  /** Chain name */
  name: string;
  /** Rate limiting options */
  rateLimit?: { average: number; burst?: number; period?: string };
  /** CORS options */
  cors?: { allowOrigins: string[] };
  /** Enable compression */
  compression?: boolean;
  /** Enable security headers */
  securityHeaders?: boolean;
}

/**
 * Web app middleware chain options
 */
export interface WebAppChainOptions {
  /** Chain name */
  name: string;
  /** Enable HTTPS redirect */
  httpsRedirect?: boolean;
  /** Enable security headers */
  securityHeaders?: boolean;
  /** Enable compression */
  compression?: boolean;
  /** WWW redirect options */
  wwwRedirect?: { stripWww: boolean; domain: string };
}

/**
 * Admin panel middleware chain options
 */
export interface AdminChainOptions {
  /** Chain name */
  name: string;
  /** Allowed IP ranges */
  ipAllowList?: string[];
  /** Basic auth configuration */
  basicAuth?: { users: string[]; realm?: string };
  /** Rate limiting options */
  rateLimit?: { average: number; burst?: number };
  /** Enable security headers */
  securityHeaders?: boolean;
}

// ============================================================================
// MIDDLEWARE RESULTS
// ============================================================================

/**
 * Middleware configuration result
 */
export interface MiddlewareConfig {
  /** Middleware name */
  name: string;
  /** Middleware configuration */
  config: Record<string, unknown>;
}

/**
 * Middleware chain result
 */
export interface MiddlewareChain {
  /** Chain name */
  name: string;
  /** Individual middlewares */
  middlewares: MiddlewareConfig[];
  /** Chain configuration */
  chain: Record<string, unknown>;
}
