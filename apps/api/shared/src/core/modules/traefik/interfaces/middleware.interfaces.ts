/**
 * Traefik Middleware Configuration Interfaces
 *
 * All middleware-related types for HTTP and TCP middlewares.
 *
 * @module traefik/interfaces/middleware
 */

import type {
  VariableString,
  VariableBoolean,
  VariableNumber,
  VariableArray,
  RateLimitConfig,
  IPWhiteListConfig,
} from './common.interfaces';

// ============================================================================
// PREFIX MIDDLEWARES
// ============================================================================

/**
 * AddPrefix middleware configuration
 */
export type AddPrefixConfig = {
  prefix: VariableString;
}

/**
 * StripPrefix middleware configuration
 */
export type StripPrefixConfig = {
  prefixes: VariableArray<string>;
  forceSlash?: VariableBoolean;
}

// ============================================================================
// HEADERS MIDDLEWARE
// ============================================================================

/**
 * Headers middleware configuration
 */
export type HeadersConfig = {
  customRequestHeaders?: Record<string, VariableString>;
  customResponseHeaders?: Record<string, VariableString>;
  accessControlAllowCredentials?: VariableBoolean;
  accessControlAllowHeaders?: VariableArray<string>;
  accessControlAllowMethods?: VariableArray<string>;
  accessControlAllowOriginList?: VariableArray<string>;
  accessControlAllowOriginListRegex?: VariableArray<string>;
  accessControlExposeHeaders?: VariableArray<string>;
  accessControlMaxAge?: VariableNumber;
  addVaryHeader?: VariableBoolean;
  allowedHosts?: VariableArray<string>;
  hostsProxyHeaders?: VariableArray<string>;
  sslRedirect?: VariableBoolean;
  sslTemporaryRedirect?: VariableBoolean;
  sslHost?: VariableString;
  sslProxyHeaders?: Record<string, VariableString>;
  stsSeconds?: VariableNumber;
  stsIncludeSubdomains?: VariableBoolean;
  stsPreload?: VariableBoolean;
  forceSTSHeader?: VariableBoolean;
  frameDeny?: VariableBoolean;
  customFrameOptionsValue?: VariableString;
  contentTypeNosniff?: VariableBoolean;
  browserXssFilter?: VariableBoolean;
  customBrowserXSSValue?: VariableString;
  contentSecurityPolicy?: VariableString;
  publicKey?: VariableString;
  referrerPolicy?: VariableString;
  featurePolicy?: VariableString;
  permissionsPolicy?: VariableString;
  isDevelopment?: VariableBoolean;
}

// ============================================================================
// REDIRECT MIDDLEWARES
// ============================================================================

/**
 * RedirectScheme middleware configuration
 */
export type RedirectSchemeConfig = {
  scheme: VariableString;
  port?: VariableString;
  permanent?: VariableBoolean;
}

/**
 * RedirectRegex middleware configuration
 */
export type RedirectRegexConfig = {
  regex: VariableString;
  replacement: VariableString;
  permanent?: VariableBoolean;
}

// ============================================================================
// AUTH MIDDLEWARES
// ============================================================================

/**
 * BasicAuth middleware configuration
 */
export type BasicAuthConfig = {
  users?: VariableArray<string>;
  usersFile?: VariableString;
  realm?: VariableString;
  removeHeader?: VariableBoolean;
  headerField?: VariableString;
}

/**
 * DigestAuth middleware configuration
 */
export type DigestAuthConfig = {
  users?: VariableArray<string>;
  usersFile?: VariableString;
  removeHeader?: VariableBoolean;
  realm?: VariableString;
  headerField?: VariableString;
}

/**
 * ForwardAuth middleware configuration
 */
export type ForwardAuthConfig = {
  address: VariableString;
  tls?: {
    ca?: VariableString;
    caOptional?: VariableBoolean;
    cert?: VariableString;
    key?: VariableString;
    insecureSkipVerify?: VariableBoolean;
  };
  trustForwardHeader?: VariableBoolean;
  authResponseHeaders?: VariableArray<string>;
  authResponseHeadersRegex?: VariableString;
  authRequestHeaders?: VariableArray<string>;
}

// ============================================================================
// CHAIN MIDDLEWARE
// ============================================================================

/**
 * Chain middleware configuration
 */
export type ChainConfig = {
  middlewares: VariableArray<string>;
}

// ============================================================================
// COMPRESSION MIDDLEWARE
// ============================================================================

/**
 * Compress middleware configuration
 */
export type CompressConfig = {
  excludedContentTypes?: VariableArray<string>;
  minResponseBodyBytes?: VariableNumber;
}

// ============================================================================
// PATH MIDDLEWARES
// ============================================================================

/**
 * ReplacePathRegex middleware configuration
 */
export type ReplacePathRegexConfig = {
  regex: VariableString;
  replacement: VariableString;
}

/**
 * ReplacePath middleware configuration
 */
export type ReplacePathConfig = {
  path: VariableString;
}

// ============================================================================
// RESILIENCE MIDDLEWARES
// ============================================================================

/**
 * Retry middleware configuration
 */
export type RetryConfig = {
  attempts?: VariableNumber;
  initialInterval?: VariableString;
}

/**
 * Buffering middleware configuration
 */
export type BufferingConfig = {
  maxRequestBodyBytes?: VariableNumber;
  memRequestBodyBytes?: VariableNumber;
  maxResponseBodyBytes?: VariableNumber;
  memResponseBodyBytes?: VariableNumber;
  retryExpression?: VariableString;
}

/**
 * CircuitBreaker middleware configuration
 */
export type CircuitBreakerConfig = {
  expression: VariableString;
  checkPeriod?: VariableString;
  fallbackDuration?: VariableString;
  recoveryDuration?: VariableString;
}

/**
 * InFlightReq middleware configuration
 */
export type InFlightReqConfig = {
  amount?: VariableNumber;
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
// MIDDLEWARE CONFIG TYPES
// ============================================================================

/**
 * HTTP Middleware configuration (union of all middleware types)
 */
export type HttpMiddlewareConfig = {
  addPrefix?: AddPrefixConfig;
  stripPrefix?: StripPrefixConfig;
  headers?: HeadersConfig;
  redirectScheme?: RedirectSchemeConfig;
  redirectRegex?: RedirectRegexConfig;
  basicAuth?: BasicAuthConfig;
  digestAuth?: DigestAuthConfig;
  forwardAuth?: ForwardAuthConfig;
  chain?: ChainConfig;
  compress?: CompressConfig;
  rateLimit?: RateLimitConfig;
  replacePathRegex?: ReplacePathRegexConfig;
  replacePath?: ReplacePathConfig;
  retry?: RetryConfig;
  buffering?: BufferingConfig;
  circuitBreaker?: CircuitBreakerConfig;
  inFlightReq?: InFlightReqConfig;
  ipWhiteList?: IPWhiteListConfig;
  ipAllowList?: IPWhiteListConfig;
}

/**
 * TCP Middleware configuration
 */
export type TcpMiddlewareConfig = {
  ipWhiteList?: IPWhiteListConfig;
  ipAllowList?: IPWhiteListConfig;
}

/**
 * Middleware collection by type
 */
export type MiddlewaresConfig = {
  http?: Record<string, HttpMiddlewareConfig>;
  tcp?: Record<string, TcpMiddlewareConfig>;
}
