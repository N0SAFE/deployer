import type {
  VariableString,
  VariableBoolean,
  VariableNumber,
  VariableArray,
  RateLimitConfig,
  CorsOptions,
  IPWhiteListConfig,
} from './common.types';

/**
 * AddPrefix middleware configuration
 */
export interface AddPrefixConfig {
  prefix: VariableString;
}

/**
 * StripPrefix middleware configuration
 */
export interface StripPrefixConfig {
  prefixes: VariableArray<string>;
  forceSlash?: VariableBoolean;
}

/**
 * Headers middleware configuration
 */
export interface HeadersConfig {
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
  isDevelopment?: VariableBoolean;
}

/**
 * RedirectScheme middleware configuration
 */
export interface RedirectSchemeConfig {
  scheme: VariableString;
  port?: VariableString;
  permanent?: VariableBoolean;
}

/**
 * RedirectRegex middleware configuration
 */
export interface RedirectRegexConfig {
  regex: VariableString;
  replacement: VariableString;
  permanent?: VariableBoolean;
}

/**
 * BasicAuth middleware configuration
 */
export interface BasicAuthConfig {
  users?: VariableArray<string>;
  usersFile?: VariableString;
  realm?: VariableString;
  removeHeader?: VariableBoolean;
  headerField?: VariableString;
}

/**
 * DigestAuth middleware configuration
 */
export interface DigestAuthConfig {
  users?: VariableArray<string>;
  usersFile?: VariableString;
  removeHeader?: VariableBoolean;
  realm?: VariableString;
  headerField?: VariableString;
}

/**
 * ForwardAuth middleware configuration
 */
export interface ForwardAuthConfig {
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

/**
 * Chain middleware configuration
 */
export interface ChainConfig {
  middlewares: VariableArray<string>;
}

/**
 * Compress middleware configuration
 */
export interface CompressConfig {
  excludedContentTypes?: VariableArray<string>;
  minResponseBodyBytes?: VariableNumber;
}

/**
 * ReplacePathRegex middleware configuration
 */
export interface ReplacePathRegexConfig {
  regex: VariableString;
  replacement: VariableString;
}

/**
 * ReplacePath middleware configuration
 */
export interface ReplacePathConfig {
  path: VariableString;
}

/**
 * Retry middleware configuration
 */
export interface RetryConfig {
  attempts?: VariableNumber;
  initialInterval?: VariableString;
}

/**
 * Buffering middleware configuration
 */
export interface BufferingConfig {
  maxRequestBodyBytes?: VariableNumber;
  memRequestBodyBytes?: VariableNumber;
  maxResponseBodyBytes?: VariableNumber;
  memResponseBodyBytes?: VariableNumber;
  retryExpression?: VariableString;
}

/**
 * CircuitBreaker middleware configuration
 */
export interface CircuitBreakerConfig {
  expression: VariableString;
  checkPeriod?: VariableString;
  fallbackDuration?: VariableString;
  recoveryDuration?: VariableString;
}

/**
 * InFlightReq middleware configuration
 */
export interface InFlightReqConfig {
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

/**
 * HTTP Middleware configuration
 */
export interface HttpMiddlewareConfig {
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
}

/**
 * TCP Middleware configuration
 */
export interface TcpMiddlewareConfig {
  ipWhiteList?: IPWhiteListConfig;
}

/**
 * Middleware collection by type
 */
export interface MiddlewaresConfig {
  http?: Record<string, HttpMiddlewareConfig>;
  tcp?: Record<string, TcpMiddlewareConfig>;
}
