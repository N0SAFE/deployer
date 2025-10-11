import type {
  VariableString,
  VariableBoolean,
  VariableNumber,
  VariableArray,
  Server,
  HealthCheck,
} from './common.types';

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
  services: Array<{
    name: VariableString;
    weight: VariableNumber;
  }>;
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
  mirrors?: Array<{
    name: VariableString;
    percent: VariableNumber;
  }>;
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

/**
 * TCP Service configuration
 */
export interface TcpServiceConfig {
  loadBalancer?: {
    servers: Array<{
      address: VariableString;
    }>;
    terminationDelay?: VariableNumber;
    proxyProtocol?: {
      version?: VariableNumber;
    };
  };
  weighted?: {
    services: Array<{
      name: VariableString;
      weight: VariableNumber;
    }>;
  };
}

/**
 * UDP Service configuration
 */
export interface UdpServiceConfig {
  loadBalancer?: {
    servers: Array<{
      address: VariableString;
    }>;
  };
  weighted?: {
    services: Array<{
      name: VariableString;
      weight: VariableNumber;
    }>;
  };
}

/**
 * Service collection by type
 */
export interface ServicesConfig {
  http?: Record<string, HttpServiceConfig>;
  tcp?: Record<string, TcpServiceConfig>;
  udp?: Record<string, UdpServiceConfig>;
}
