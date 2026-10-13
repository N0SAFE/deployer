/**
 * Traefik Configuration Builders
 * 
 * Type-safe builders for creating Traefik configurations with variable support
 */

// Main builder
export { TraefikConfigBuilder } from '@/core/modules/traefik/config-builder/builders/traefik-config-builder';

// Types are exported from interfaces - re-export for convenience
export type { TraefikConfig, CompilationOptions } from '@/core/modules/traefik/interfaces';

// Component builders
export { RuleBuilder } from '@/core/modules/traefik/config-builder/builders/rule-builder';
export { HttpRouterBuilder } from '@/core/modules/traefik/config-builder/builders/http-router-builder';
export { ServiceBuilder, LoadBalancerBuilder, HealthCheckBuilder } from '@/core/modules/traefik/config-builder/builders/service-builder';
export { MiddlewareBuilder } from '@/core/modules/traefik/config-builder/builders/middleware-builder';
export { TLSBuilder } from '@/core/modules/traefik/config-builder/builders/tls-builder';
