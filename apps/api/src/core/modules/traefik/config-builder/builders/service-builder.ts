import type {
  LoadBalancerConfig,
  WeightedConfig,
  MirroringConfig,
  HttpServiceConfig,
  TcpServiceConfig,
  UdpServiceConfig,
} from '../types/service.types';
import type { Server, HealthCheck, VariableString, VariableNumber, VariableBoolean } from '../types/common.types';

/**
 * Builder for creating Traefik service configurations with type preservation
 */
export class ServiceBuilder<TConfig extends HttpServiceConfig | TcpServiceConfig | UdpServiceConfig = HttpServiceConfig> {
  private config: TConfig = {} as TConfig;

  constructor(private name: string) {}

  /**
   * Create a LoadBalancer service
   */
  loadBalancer(
    configOrFn: Partial<LoadBalancerConfig> | ((builder: LoadBalancerBuilder) => LoadBalancerBuilder)
  ): ServiceBuilder<{ loadBalancer: LoadBalancerConfig }> {
    const lbConfig = typeof configOrFn === 'function'
      ? configOrFn(new LoadBalancerBuilder()).build()
      : configOrFn;

    this.config = {
      loadBalancer: lbConfig as LoadBalancerConfig,
    } as TConfig;
    return this as any;
  }

  /**
   * Create a Weighted service
   */
  weighted(services: Array<{ name: VariableString; weight: VariableNumber }>): ServiceBuilder<{ weighted: WeightedConfig }> {
    this.config = {
      weighted: { services },
    } as TConfig;
    return this as any;
  }

  /**
   * Create a Mirroring service
   */
  mirroring(
    service: VariableString,
    mirrors: Array<{ name: VariableString; percent: VariableNumber }>
  ): ServiceBuilder<{ mirroring: MirroringConfig }> {
    this.config = {
      mirroring: { service, mirrors },
    } as TConfig;
    return this as any;
  }

  /**
   * Build the service configuration
   */
  build(): { name: string; config: TConfig } {
    // Validate that at least one service type is configured
    const config = this.config as any;
    if (!config.loadBalancer && !config.weighted && !config.mirroring) {
      throw new Error('Service must have at least one configuration (loadBalancer, weighted, or mirroring)');
    }
    
    return {
      name: this.name,
      config: this.config,
    };
  }

  /**
   * Get the service name
   */
  getName(): string {
    return this.name;
  }
}

/**
 * Builder for LoadBalancer configuration
 */
export class LoadBalancerBuilder {
  private config: Partial<LoadBalancerConfig> = {
    servers: [],
  };

  /**
   * Add a server
   */
  server(url: VariableString, weight?: VariableNumber): this {
    if (!this.config.servers) {
      this.config.servers = [];
    }
    this.config.servers.push({ url, weight });
    return this;
  }

  /**
   * Add multiple servers
   */
  servers(servers: Server[]): this {
    this.config.servers = servers;
    return this;
  }

  /**
   * Configure health check
   */
  healthCheck(
    configOrFn: Partial<HealthCheck> | ((builder: HealthCheckBuilder) => HealthCheckBuilder)
  ): this {
    const healthCheckConfig = typeof configOrFn === 'function'
      ? configOrFn(new HealthCheckBuilder()).build()
      : configOrFn;

    this.config.healthCheck = healthCheckConfig as HealthCheck;
    return this;
  }

  /**
   * Enable sticky sessions
   */
  sticky(cookieName: string, options?: { secure?: boolean; httpOnly?: boolean; sameSite?: 'none' | 'lax' | 'strict' }): this {
    this.config.sticky = {
      cookie: {
        name: cookieName,
        secure: options?.secure,
        httpOnly: options?.httpOnly,
        sameSite: options?.sameSite,
      },
    };
    return this;
  }

  /**
   * Set pass host header
   */
  passHostHeader(value: VariableBoolean = true): this {
    this.config.passHostHeader = value;
    return this;
  }

  /**
   * Build the LoadBalancer configuration
   */
  build(): LoadBalancerConfig {
    if (!this.config.servers || this.config.servers.length === 0) {
      throw new Error('LoadBalancer must have at least one server');
    }
    return this.config as LoadBalancerConfig;
  }
}

/**
 * Builder for HealthCheck configuration
 */
export class HealthCheckBuilder {
  private config: Partial<HealthCheck> = {};

  /**
   * Set health check path
   */
  path(path: VariableString): this {
    this.config.path = path;
    return this;
  }

  /**
   * Set health check interval
   */
  interval(interval: VariableString): this {
    this.config.interval = interval;
    return this;
  }

  /**
   * Set health check timeout
   */
  timeout(timeout: VariableString): this {
    this.config.timeout = timeout;
    return this;
  }

  /**
   * Set health check scheme
   */
  scheme(scheme: 'http' | 'https'): this {
    this.config.scheme = scheme;
    return this;
  }

  /**
   * Set health check port
   */
  port(port: VariableNumber): this {
    this.config.port = port;
    return this;
  }

  /**
   * Set health check hostname
   */
  hostname(hostname: VariableString): this {
    this.config.hostname = hostname;
    return this;
  }

  /**
   * Set health check headers
   */
  headers(headers: Record<string, string>): this {
    this.config.headers = headers;
    return this;
  }

  /**
   * Set follow redirects
   */
  followRedirects(value: VariableBoolean = true): this {
    this.config.followRedirects = value;
    return this;
  }

  /**
   * Build the HealthCheck configuration
   */
  build(): HealthCheck {
    return this.config as HealthCheck;
  }
}
