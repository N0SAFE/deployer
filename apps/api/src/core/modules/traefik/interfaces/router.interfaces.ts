/**
 * Traefik Router Configuration Interfaces
 *
 * Router configuration types for HTTP, TCP, and UDP protocols.
 *
 * @module traefik/interfaces/router
 */

import type { VariableString, VariableBoolean, VariableNumber, TLSOptions } from './common.interfaces';

// ============================================================================
// RULE TYPES
// ============================================================================

/**
 * Rule matcher types for router rules
 */
export type RuleMatcher =
  | 'Host'
  | 'HostRegexp'
  | 'HostSNI'
  | 'HostSNIRegexp'
  | 'Path'
  | 'PathPrefix'
  | 'PathRegexp'
  | 'Query'
  | 'QueryRegexp'
  | 'Header'
  | 'HeaderRegexp'
  | 'Method'
  | 'ClientIP';

/**
 * Rule operators for combining matchers
 */
export type RuleOperator = '&&' | '||';

// ============================================================================
// HTTP ROUTER
// ============================================================================

/**
 * HTTP Router configuration
 */
export interface HttpRouterConfig {
  rule: VariableString;
  service: VariableString;
  entryPoints?: VariableString[];
  middlewares?: VariableString[];
  priority?: VariableNumber;
  tls?: TLSOptions | boolean;
}

// ============================================================================
// TCP ROUTER
// ============================================================================

/**
 * TCP Router configuration
 */
export interface TcpRouterConfig {
  rule: VariableString;
  service: VariableString;
  entryPoints?: VariableString[];
  middlewares?: VariableString[];
  priority?: VariableNumber;
  tls?: {
    passthrough?: VariableBoolean;
    certResolver?: VariableString;
    domains?: {
      main: VariableString;
      sans?: VariableString[];
    }[];
  };
}

// ============================================================================
// UDP ROUTER
// ============================================================================

/**
 * UDP Router configuration
 */
export interface UdpRouterConfig {
  entryPoints?: VariableString[];
  service: VariableString;
}

// ============================================================================
// ROUTER COLLECTIONS
// ============================================================================

/**
 * All router types union
 */
export type RouterConfig = HttpRouterConfig | TcpRouterConfig | UdpRouterConfig;

/**
 * Router collection by protocol type
 */
export interface RoutersConfig {
  http?: Record<string, HttpRouterConfig>;
  tcp?: Record<string, TcpRouterConfig>;
  udp?: Record<string, UdpRouterConfig>;
}
