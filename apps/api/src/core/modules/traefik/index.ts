/**
 * Traefik Module Barrel Export
 * 
 * This module provides the main export point for all Traefik-related
 * services, events, errors, and utilities.
 * 
 * @module TraefikModule
 */

// Interfaces (import all types from centralized location)
export * from './interfaces';

// Module
export * from './traefik.module';

// Services (export only services, not types - types come from interfaces)
export { TraefikService } from './services/traefik.service';
export { TraefikSyncService } from './services/traefik-sync.service';
export { TraefikFileSystemService } from './services/traefik-file-system.service';
export { TraefikValidationService } from './services/traefik-validation.service';
export { TraefikTemplateService } from './services/traefik-template.service';
export { TraefikVariableResolverService, TRAEFIK_VARIABLES } from './services/traefik-variable-resolver.service';
export { TraefikMiddlewareLibraryService } from './services/traefik-middleware-library.service';

// Events
export * from './events';

// Errors
export * from './errors';

// Config Builder (classes and utilities)
export { TraefikConfigBuilder } from './config-builder/builders/traefik-config-builder';
export { HttpRouterBuilder } from './config-builder/builders/http-router-builder';
export { ServiceBuilder } from './config-builder/builders/service-builder';
export { MiddlewareBuilder } from './config-builder/builders/middleware-builder';
export { TLSBuilder } from './config-builder/builders/tls-builder';
export { RuleBuilder } from './config-builder/builders/rule-builder';

// Variable system classes
export { Variable, StringVariable, NumberVariable } from './config-builder/variables/variable.types';
export { VariableRegistry, VariableRegistrationError } from './config-builder/variables/variable-registry';
export { VariableValidator } from './config-builder/variables/variable-validator';
export { VariableResolver, VariableResolutionError } from './config-builder/variables/variable-resolver';

// Repositories
export { TraefikRepository } from './repositories/traefik.repository';
export { TraefikTemplateRepository } from './repositories/traefik-template.repository';
