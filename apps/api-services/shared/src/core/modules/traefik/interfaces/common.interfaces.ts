/**
 * Common Traefik Configuration Types
 *
 * Base types used across all Traefik configuration interfaces.
 * These types support the variable resolution system with ~##varName##~ syntax.
 *
 * @module traefik/interfaces/common
 */

// ============================================================================
// VARIABLE TYPES
// ============================================================================

/**
 * Represents a string value that can contain variables (~##varName##~)
 */
export type VariableString = string;

/**
 * Represents a numeric value that can be a variable
 */
export type VariableNumber = number | VariableString;

/**
 * Represents a boolean value that can be a variable
 */
export type VariableBoolean = boolean | VariableString;

/**
 * Represents an array that can contain variables
 */
export type VariableArray<T> = (T | VariableString)[];

// ============================================================================
// SERVER TYPES
// ============================================================================

/**
 * Server definition for load balancers
 */
export interface Server {
  url: VariableString;
  weight?: VariableNumber;
}

/**
 * Health check configuration for services
 */
export interface HealthCheck {
  scheme?: 'http' | 'https';
  path?: VariableString;
  interval?: VariableString;
  timeout?: VariableString;
  hostname?: VariableString;
  port?: VariableNumber;
  followRedirects?: VariableBoolean;
  headers?: Record<string, VariableString>;
}

// ============================================================================
// TLS TYPES (common)
// ============================================================================

/**
 * TLS configuration options for routers
 */
export interface TLSOptions {
  certResolver?: VariableString;
  domains?: {
    main: VariableString;
    sans?: VariableArray<string>;
  }[];
  options?: VariableString;
}

// ============================================================================
// RATE LIMITING
// ============================================================================

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  average?: VariableNumber;
  burst?: VariableNumber;
  period?: VariableString;
  sourceCriterion?: {
    ipStrategy?: {
      depth?: VariableNumber;
      excludedIPs?: VariableArray<string>;
    };
    requestHeaderName?: VariableString;
    requestHost?: VariableBoolean;
  };
}

// ============================================================================
// CORS OPTIONS
// ============================================================================

/**
 * CORS configuration options for middleware builder
 */
export interface CorsOptions {
  origins?: VariableArray<string>;
  methods?: VariableArray<string>;
  headers?: VariableArray<string>;
  exposedHeaders?: VariableArray<string>;
  credentials?: VariableBoolean;
  maxAge?: VariableNumber;
}

// ============================================================================
// IP FILTERING
// ============================================================================

/**
 * IP whitelist/allowlist configuration
 */
export interface IPWhiteListConfig {
  sourceRange?: VariableArray<string>;
  ipStrategy?: {
    depth?: VariableNumber;
    excludedIPs?: VariableArray<string>;
  };
}

// ============================================================================
// ENTRYPOINTS
// ============================================================================

/**
 * Entrypoint configuration
 */
export interface EntrypointConfig {
  address?: VariableString;
  http?: {
    redirections?: {
      entryPoint?: {
        to?: VariableString;
        scheme?: VariableString;
        permanent?: VariableBoolean;
      };
    };
  };
  transport?: {
    lifeCycle?: {
      requestAcceptGraceTimeout?: VariableString;
      graceTimeOut?: VariableString;
    };
    respondingTimeouts?: {
      readTimeout?: VariableString;
      writeTimeout?: VariableString;
      idleTimeout?: VariableString;
    };
  };
}
