/**
 * Traefik Interfaces Barrel Export
 *
 * Central export point for all Traefik module interfaces and types.
 * Import from here to avoid circular dependencies and ensure consistency.
 *
 * @module traefik/interfaces
 */

// ============================================================================
// COMMON TYPES (base types used everywhere)
// ============================================================================
export type {
  VariableString,
  VariableNumber,
  VariableBoolean,
  VariableArray,
  Server,
  HealthCheck,
  TLSOptions,
  RateLimitConfig,
  CorsOptions,
  IPWhiteListConfig,
  EntrypointConfig,
} from './common.interfaces';

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================
export type {
  TraefikConfig,
  CompilationOptions,
  ConfigStats,
} from './config.interfaces';

// ============================================================================
// ROUTER TYPES
// ============================================================================
export type {
  RuleMatcher,
  RuleOperator,
  HttpRouterConfig,
  TcpRouterConfig,
  UdpRouterConfig,
  RouterConfig,
  RoutersConfig,
} from './router.interfaces';

// ============================================================================
// SERVICE TYPES
// ============================================================================
export type {
  LoadBalancerConfig,
  WeightedConfig,
  MirroringConfig,
  HttpServiceConfig,
  TcpServiceConfig,
  UdpServiceConfig,
  ServicesConfig,
} from './service.interfaces';

// ============================================================================
// MIDDLEWARE TYPES
// ============================================================================
export type {
  AddPrefixConfig,
  StripPrefixConfig,
  HeadersConfig,
  RedirectSchemeConfig,
  RedirectRegexConfig,
  BasicAuthConfig,
  DigestAuthConfig,
  ForwardAuthConfig,
  ChainConfig,
  CompressConfig,
  ReplacePathRegexConfig,
  ReplacePathConfig,
  RetryConfig,
  BufferingConfig,
  CircuitBreakerConfig,
  InFlightReqConfig,
  HttpMiddlewareConfig,
  TcpMiddlewareConfig,
  MiddlewaresConfig,
} from './middleware.interfaces';

// ============================================================================
// TLS TYPES
// ============================================================================
export type {
  TLSCertificate,
  TLSStore,
  ClientAuthType,
  TLSOptionsConfig,
  TLSConfig,
} from './tls.interfaces';

// ============================================================================
// VALIDATION TYPES
// ============================================================================
export type {
  ValidationError,
  ValidationWarning,
  VariableInfo,
  ValidationResult,
  ValidationOptions,
} from './validation.interfaces';

// ============================================================================
// VARIABLE TYPES
// ============================================================================
export type {
  VariableType,
  VariableMetadata,
  VariableContext,
  ResolutionOptions,
  ResolutionResult,
  RegistryStats,
} from './variable.interfaces';

// ============================================================================
// FILE SYSTEM TYPES
// ============================================================================
export type {
  VirtualFileItem,
  VirtualDirectoryTree,
  TraefikFileSystemPaths,
  FileSystemNamingConventions,
  FileOperationResult,
  FileContentResult,
  DownloadResult,
  ParsedServiceConfigFileName,
} from './file-system.interfaces';

// ============================================================================
// REPOSITORY TYPES
// ============================================================================
export type {
  CreateServiceConfigInput,
  UpdateServiceConfigInput,
  CreateDomainRouteInput,
  CreateServiceTargetInput,
  CreateSSLCertificateInput,
  CreateConfigFileInput,
  MiddlewareType,
  CreateMiddlewareInput,
  HealthStatus,
  SyncStatus,
} from './repository.interfaces';

// ============================================================================
// SYNC TYPES
// ============================================================================
export type {
  TraefikConfigData,
  CompleteServiceConfig,
  ServiceTarget,
  DomainRoute,
  MiddlewareData,
  MiddlewareConfiguration,
  SyncAction,
  SyncResult,
  SyncSummary,
  SyncOptions,
  CleanupResult,
} from './sync.interfaces';

// ============================================================================
// TEMPLATE TYPES
// ============================================================================
export type {
  TemplateVariable,
  TemplateVariables,
  ParsedTemplate,
  TemplateOptions,
  BuiltInTemplateType,
  TemplateCatalogEntry,
} from './template.interfaces';

// ============================================================================
// MIDDLEWARE LIBRARY TYPES
// ============================================================================
export type {
  RateLimiterOptions,
  CorsMiddlewareOptions,
  SecurityHeadersOptions,
  CompressionOptions,
  BasicAuthOptions,
  ForwardAuthOptions,
  RetryOptions,
  CircuitBreakerOptions,
  StripPrefixOptions,
  AddPrefixOptions,
  ReplacePathOptions,
  ReplacePathRegexOptions,
  RedirectSchemeOptions,
  RedirectRegexOptions,
  IPAllowListOptions,
  HeadersOptions,
  BufferingOptions,
  ApiChainOptions,
  WebAppChainOptions,
  AdminChainOptions,
  MiddlewareConfig,
  MiddlewareChain,
} from './middleware-library.interfaces';
