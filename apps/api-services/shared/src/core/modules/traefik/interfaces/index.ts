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
} from '@/core/modules/traefik/interfaces/common.interfaces';

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================
export type {
  TraefikConfig,
  CompilationOptions,
  ConfigStats,
} from '@/core/modules/traefik/interfaces/config.interfaces';

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
} from '@/core/modules/traefik/interfaces/router.interfaces';

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
} from '@/core/modules/traefik/interfaces/service.interfaces';

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
} from '@/core/modules/traefik/interfaces/middleware.interfaces';

// ============================================================================
// TLS TYPES
// ============================================================================
export type {
  TLSCertificate,
  TLSStore,
  ClientAuthType,
  TLSOptionsConfig,
  TLSConfig,
} from '@/core/modules/traefik/interfaces/tls.interfaces';

// ============================================================================
// VALIDATION TYPES
// ============================================================================
export type {
  ValidationError,
  ValidationWarning,
  VariableInfo,
  ValidationResult,
  ValidationOptions,
} from '@/core/modules/traefik/interfaces/validation.interfaces';

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
} from '@/core/modules/traefik/interfaces/variable.interfaces';

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
} from '@/core/modules/traefik/interfaces/file-system.interfaces';

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
} from '@/core/modules/traefik/interfaces/repository.interfaces';

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
} from '@/core/modules/traefik/interfaces/sync.interfaces';

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
} from '@/core/modules/traefik/interfaces/template.interfaces';

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
} from '@/core/modules/traefik/interfaces/middleware-library.interfaces';
