import type { VariableString, VariableBoolean, VariableNumber, TLSOptions } from './common.types';

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
    domains?: Array<{
      main: VariableString;
      sans?: VariableString[];
    }>;
  };
}

/**
 * UDP Router configuration
 */
export interface UdpRouterConfig {
  entryPoints?: VariableString[];
  service: VariableString;
}

/**
 * All router types
 */
export type RouterConfig = HttpRouterConfig | TcpRouterConfig | UdpRouterConfig;

/**
 * Router collection by type
 */
export interface RoutersConfig {
  http?: Record<string, HttpRouterConfig>;
  tcp?: Record<string, TcpRouterConfig>;
  udp?: Record<string, UdpRouterConfig>;
}
