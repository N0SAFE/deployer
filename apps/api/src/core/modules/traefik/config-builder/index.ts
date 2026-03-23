/**
 * Traefik Config Builder Barrel Export
 * 
 * Exports all config builder components including builders and variables.
 * Types are exported from ../interfaces
 */

// Builders
export * from './builders';

// Variables
export * from './variables';

// Re-export types from interfaces for backward compatibility
export type {
  HttpRouterConfig,
  TcpRouterConfig,
  UdpRouterConfig,
  HttpServiceConfig,
  TcpServiceConfig,
  UdpServiceConfig,
  HttpMiddlewareConfig,
  TcpMiddlewareConfig,
  TLSConfig,
  TraefikConfig,
  CompilationOptions,
} from '../interfaces';
