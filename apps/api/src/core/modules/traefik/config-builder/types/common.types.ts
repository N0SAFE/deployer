/**
 * Common types used across Traefik configuration
 */

/**
 * Represents a value that can contain variables (~##varName##~)
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

/**
 * Server definition for load balancers
 */
export interface Server {
  url: VariableString;
  weight?: VariableNumber;
}

/**
 * Health check configuration
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

/**
 * TLS configuration options
 */
export interface TLSOptions {
  certResolver?: VariableString;
  domains?: Array<{
    main: VariableString;
    sans?: VariableArray<string>;
  }>;
  options?: VariableString;
}

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

/**
 * CORS configuration options
 */
export interface CorsOptions {
  origins?: VariableArray<string>;
  methods?: VariableArray<string>;
  headers?: VariableArray<string>;
  exposedHeaders?: VariableArray<string>;
  maxAge?: VariableNumber;
  credentials?: VariableBoolean;
}

/**
 * IP whitelist configuration
 */
export interface IPWhiteListConfig {
  sourceRange?: VariableArray<string>;
  ipStrategy?: {
    depth?: VariableNumber;
    excludedIPs?: VariableArray<string>;
  };
}
