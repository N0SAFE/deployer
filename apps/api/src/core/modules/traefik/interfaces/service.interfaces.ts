/**
 * Traefik Service Configuration Interfaces
 *
 * Service configuration types for HTTP, TCP, and UDP load balancers.
 *
 * @module traefik/interfaces/service
 */

import type {
  VariableString,
  VariableBoolean,
  VariableNumber,
  Server,
  HealthCheck,
} from './common.interfaces';

// ============================================================================
// HTTP LOAD BALANCER
// ============================================================================

/**
 * Load Balancer service configuration
 */
export interface LoadBalancerConfig {
  servers: Server[];
  healthCheck?: HealthCheck;
  passHostHeader?: VariableBoolean;
  sticky?: {
    cookie?: {
      name?: VariableString;
      secure?: VariableBoolean;
      httpOnly?: VariableBoolean;
      sameSite?: 'none' | 'lax' | 'strict';
    };
  };
  responseForwarding?: {
    flushInterval?: VariableString;
  };
  serversTransport?: VariableString;
}

/**
 * Weighted service configuration
 */
export interface WeightedConfig {
  services: {
    name: VariableString;
    weight: VariableNumber;
  }[];
  sticky?: {
    cookie?: {
      name?: VariableString;
      secure?: VariableBoolean;
      httpOnly?: VariableBoolean;
    };
  };
  healthCheck?: HealthCheck;
}

/**
 * Mirroring service configuration
 */
export interface MirroringConfig {
  service: VariableString;
  mirrors?: {
    name: VariableString;
    percent: VariableNumber;
  }[];
  healthCheck?: HealthCheck;
}

/**
 * HTTP Service configuration
 */
export interface HttpServiceConfig {
  loadBalancer?: LoadBalancerConfig;
  weighted?: WeightedConfig;
  mirroring?: MirroringConfig;
}

// ============================================================================
// TCP SERVICE
// ============================================================================

/**
 * TCP Service configuration
 */
export interface TcpServiceConfig {
  loadBalancer?: {
    servers: {
      address: VariableString;
    }[];
    terminationDelay?: VariableNumber;
    proxyProtocol?: {
      version?: VariableNumber;
    };
  };
  weighted?: {
    services: {
      name: VariableString;
      weight: VariableNumber;
    }[];
  };
}

// ============================================================================
// UDP SERVICE
// ============================================================================

/**
 * UDP Service configuration
 */
export interface UdpServiceConfig {
  loadBalancer?: {
    servers: {
      address: VariableString;
    }[];
  };
  weighted?: {
    services: {
      name: VariableString;
      weight: VariableNumber;
    }[];
  };
}

// ============================================================================
// SERVICE COLLECTIONS
// ============================================================================

/**
 * Service collection by protocol type
 */
export interface ServicesConfig {
  http?: Record<string, HttpServiceConfig>;
  tcp?: Record<string, TcpServiceConfig>;
  udp?: Record<string, UdpServiceConfig>;
}
