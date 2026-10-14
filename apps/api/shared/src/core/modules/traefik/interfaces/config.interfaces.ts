/**
 * Traefik Configuration Interfaces
 *
 * Main configuration types for the TraefikConfigBuilder.
 *
 * @module traefik/interfaces/config
 */

import type { RoutersConfig } from './router.interfaces';
import type { ServicesConfig } from './service.interfaces';
import type { MiddlewaresConfig } from './middleware.interfaces';
import type { TLSConfig } from './tls.interfaces';

// ============================================================================
// MAIN CONFIG
// ============================================================================

/**
 * Main Traefik dynamic configuration structure
 */
export interface TraefikConfig {
  http?: {
    routers?: RoutersConfig['http'];
    services?: ServicesConfig['http'];
    middlewares?: MiddlewaresConfig['http'];
  };
  tcp?: {
    routers?: RoutersConfig['tcp'];
    services?: ServicesConfig['tcp'];
    middlewares?: MiddlewaresConfig['tcp'];
  };
  udp?: {
    routers?: RoutersConfig['udp'];
    services?: ServicesConfig['udp'];
  };
  tls?: TLSConfig;
}

// ============================================================================
// COMPILATION OPTIONS
// ============================================================================

/**
 * Options for compiling the configuration
 */
export interface CompilationOptions {
  /**
   * Whether to resolve variables during compilation
   * @default true
   */
  resolveVariables?: boolean;

  /**
   * Variables to use for resolution
   */
  variables?: Record<string, unknown>;

  /**
   * Whether to include empty sections in output
   * @default false
   */
  includeEmptySections?: boolean;

  /**
   * Whether to validate the configuration
   * @default true
   */
  validate?: boolean;

  /**
   * Fail on undefined variables
   * @default false
   */
  strict?: boolean;

  /**
   * Output format
   * @default 'yaml'
   */
  format?: 'yaml' | 'json';

  /**
   * Whether to pretty print the output
   * @default true
   */
  prettyPrint?: boolean;
}

// ============================================================================
// BUILDER STATISTICS
// ============================================================================

/**
 * Statistics about the configuration
 */
export interface ConfigStats {
  httpRouters: number;
  tcpRouters: number;
  udpRouters: number;
  httpServices: number;
  tcpServices: number;
  udpServices: number;
  httpMiddlewares: number;
  tcpMiddlewares: number;
  tlsCertificates: number;
  tlsOptions: number;
  tlsStores: number;
}
