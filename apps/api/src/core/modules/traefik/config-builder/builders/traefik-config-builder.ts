import type { HttpRouterConfig, TcpRouterConfig, UdpRouterConfig } from '../types/router.types';
import type { HttpServiceConfig, TcpServiceConfig, UdpServiceConfig } from '../types/service.types';
import type { HttpMiddlewareConfig, TcpMiddlewareConfig } from '../types/middleware.types';
import type { TLSConfig } from '../types/tls.types';
import { HttpRouterBuilder } from './http-router-builder';
import { ServiceBuilder } from './service-builder';
import { MiddlewareBuilder } from './middleware-builder';
import { TLSBuilder } from './tls-builder';
import { VariableRegistry, VariableResolver, type VariableContext } from '../variables';
import * as yaml from 'yaml';

/**
 * Complete Traefik configuration
 */
export interface TraefikConfig {
  http?: {
    routers?: Record<string, HttpRouterConfig>;
    services?: Record<string, HttpServiceConfig>;
    middlewares?: Record<string, HttpMiddlewareConfig>;
  };
  tcp?: {
    routers?: Record<string, TcpRouterConfig>;
    services?: Record<string, TcpServiceConfig>;
    middlewares?: Record<string, TcpMiddlewareConfig>;
  };
  udp?: {
    routers?: Record<string, UdpRouterConfig>;
    services?: Record<string, UdpServiceConfig>;
  };
  tls?: TLSConfig;
}

/**
 * Compilation options
 */
export interface CompilationOptions {
  validate?: boolean; // Validate context before resolution
  strict?: boolean; // Fail on undefined variables
  format?: 'json' | 'yaml'; // Output format (default: json)
}

/**
 * Main builder for creating Traefik configurations
 */
export class TraefikConfigBuilder {
  private httpRouters = new Map<string, HttpRouterConfig>();
  private httpServices = new Map<string, HttpServiceConfig>();
  private httpMiddlewares = new Map<string, HttpMiddlewareConfig>();
  private tlsConfig?: TLSConfig;
  private variableRegistry = new VariableRegistry();

  /**
   * Load a Traefik configuration from YAML string, JSON string, or object
   * @param input YAML string, JSON string, or configuration object
   * @returns TraefikConfigBuilder instance with loaded configuration
   * @example
   * // From YAML string
   * const builder = TraefikConfigBuilder.load(`
   *   http:
   *     routers:
   *       api:
   *         rule: Host(\`example.com\`)
   *         service: api-service
   * `);
   * 
   * // From object
   * const builder = TraefikConfigBuilder.load({
   *   http: {
   *     routers: {
   *       api: { rule: 'Host(`example.com`)', service: 'api-service' }
   *     }
   *   }
   * });
   */
  static load(input: string | TraefikConfig): TraefikConfigBuilder {
    let config: TraefikConfig;

    if (typeof input === 'string') {
      // Try to parse as YAML first (YAML parser can also handle JSON)
      try {
        config = yaml.parse(input) as TraefikConfig;
      } catch (yamlError) {
        // If YAML parsing fails, try JSON
        try {
          config = JSON.parse(input) as TraefikConfig;
        } catch (jsonError) {
          throw new Error(
            `Failed to parse configuration: Invalid YAML/JSON format.\n` +
            `YAML Error: ${yamlError instanceof Error ? yamlError.message : String(yamlError)}\n` +
            `JSON Error: ${jsonError instanceof Error ? jsonError.message : String(jsonError)}`
          );
        }
      }
    } else {
      config = input;
    }

    const builder = new TraefikConfigBuilder();

    // Load HTTP routers
    if (config.http?.routers) {
      for (const [name, routerConfig] of Object.entries(config.http.routers)) {
        builder.httpRouters.set(name, routerConfig);
      }
    }

    // Load HTTP services
    if (config.http?.services) {
      for (const [name, serviceConfig] of Object.entries(config.http.services)) {
        builder.httpServices.set(name, serviceConfig as HttpServiceConfig);
      }
    }

    // Load HTTP middlewares
    if (config.http?.middlewares) {
      for (const [name, middlewareConfig] of Object.entries(config.http.middlewares)) {
        builder.httpMiddlewares.set(name, middlewareConfig);
      }
    }

    // Load TLS configuration
    if (config.tls) {
      builder.tlsConfig = config.tls;
    }

    return builder;
  }

  /**
   * Convert a TraefikConfig object to YAML string
   * @param config TraefikConfig object to convert
   * @returns YAML string representation
   * @example
   * const yamlString = TraefikConfigBuilder.toYAMLString(config);
   */
  static toYAMLString(config: TraefikConfig): string {
    return yaml.stringify(config);
  }

  /**
   * Get the variable registry for defining variables
   */
  getVariableRegistry(): VariableRegistry {
    return this.variableRegistry;
  }

  /**
   * Add an HTTP router
   * @example .addRouter('api', r => r.rule('Host(`example.com`)').service('api-service'))
   */
  addRouter(
    name: string,
    builderOrFn: HttpRouterBuilder | ((builder: HttpRouterBuilder) => HttpRouterBuilder)
  ): this {
    const builder = builderOrFn instanceof HttpRouterBuilder
      ? builderOrFn
      : builderOrFn(new HttpRouterBuilder(name));
    
    const { config } = builder.build();
    this.httpRouters.set(name, config);
    return this;
  }

  /**
   * Add an HTTP service
   * @example .addService('api-service', s => s.loadBalancer(lb => lb.server('http://api:3000')))
   */
  addService(
    name: string,
    builderOrFn: ServiceBuilder | ((builder: ServiceBuilder) => ServiceBuilder)
  ): this {
    const builder = builderOrFn instanceof ServiceBuilder
      ? builderOrFn
      : builderOrFn(new ServiceBuilder(name));
    
    const { config } = builder.build();
    this.httpServices.set(name, config as HttpServiceConfig);
    return this;
  }

  /**
   * Add an HTTP middleware
   * @example .addMiddleware('cors', m => m.cors({ origins: ['*'] }))
   */
  addMiddleware(
    name: string,
    builderOrFn: MiddlewareBuilder | ((builder: MiddlewareBuilder) => MiddlewareBuilder)
  ): this {
    const builder = builderOrFn instanceof MiddlewareBuilder
      ? builderOrFn
      : builderOrFn(new MiddlewareBuilder(name));
    
    const { config } = builder.build();
    this.httpMiddlewares.set(name, config);
    return this;
  }

  /**
   * Configure TLS
   * @example .configureTLS(tls => tls.certificate('/certs/cert.pem', '/certs/key.pem'))
   */
  configureTLS(
    builderOrFn: TLSBuilder | ((builder: TLSBuilder) => TLSBuilder)
  ): this {
    const builder = builderOrFn instanceof TLSBuilder
      ? builderOrFn
      : builderOrFn(new TLSBuilder());
    
    this.tlsConfig = builder.build();
    return this;
  }

  /**
   * Build the configuration without variable resolution
   * @returns Raw configuration with ~##variables##~ still present
   */
  build(): TraefikConfig {
    const config: TraefikConfig = {};

    // HTTP configuration
    if (this.httpRouters.size > 0 || this.httpServices.size > 0 || this.httpMiddlewares.size > 0) {
      config.http = {};

      if (this.httpRouters.size > 0) {
        config.http.routers = Object.fromEntries(this.httpRouters);
      }

      if (this.httpServices.size > 0) {
        config.http.services = Object.fromEntries(this.httpServices);
      }

      if (this.httpMiddlewares.size > 0) {
        config.http.middlewares = Object.fromEntries(this.httpMiddlewares);
      }
    }

    // TLS configuration
    if (this.tlsConfig) {
      config.tls = this.tlsConfig;
    }

    return config;
  }

  /**
   * Compile the configuration with variable resolution
   * @param context Variable values to resolve
   * @param options Compilation options
   * @returns Compiled configuration with variables resolved
   */
  compile(context: VariableContext, options: CompilationOptions = {}): TraefikConfig {
    const { validate = true, strict = false } = options;

    // Build raw configuration
    const rawConfig = this.build();

    // Resolve variables
    const resolver = new VariableResolver(this.variableRegistry);
    const result = resolver.resolve<TraefikConfig>(rawConfig, context, {
      validate,
      strict,
    });

    if (!result.success) {
      const errorMessages = result.errors.map(e => `  - ${e.path}: ${e.message}`).join('\n');
      const unresolvedVars = result.unresolved.length > 0
        ? `\nUnresolved variables: ${result.unresolved.join(', ')}`
        : '';

      throw new Error(
        `Configuration compilation failed:\n${errorMessages}${unresolvedVars}`
      );
    }

    return result.data!;
  }

  /**
   * Compile and export as JSON
   */
  toJSON(context: VariableContext, options?: CompilationOptions): string {
    const config = this.compile(context, options);
    return JSON.stringify(config, null, 2);
  }

  /**
   * Compile and export as YAML
   */
  toYAML(context: VariableContext, options?: CompilationOptions): string {
    const config = this.compile(context, options);
    return TraefikConfigBuilder.toYAMLString(config);
  }

  /**
   * Simple YAML conversion (can be enhanced with a proper YAML library)
   */
  private convertToYAML(obj: any, indent = 0): string {
    const spaces = '  '.repeat(indent);
    const lines: string[] = [];

    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) {
        continue;
      }

      if (typeof value === 'object' && !Array.isArray(value)) {
        lines.push(`${spaces}${key}:`);
        lines.push(this.convertToYAML(value, indent + 1));
      } else if (Array.isArray(value)) {
        lines.push(`${spaces}${key}:`);
        for (const item of value) {
          if (typeof item === 'object') {
            lines.push(`${spaces}  -`);
            lines.push(this.convertToYAML(item, indent + 2).replace(/^  /, ''));
          } else {
            lines.push(`${spaces}  - ${this.formatYAMLValue(item)}`);
          }
        }
      } else {
        lines.push(`${spaces}${key}: ${this.formatYAMLValue(value)}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Format a value for YAML output
   */
  private formatYAMLValue(value: any): string {
    if (typeof value === 'string') {
      // Escape strings with special characters
      if (value.includes(':') || value.includes('#') || value.includes('\n')) {
        return `"${value.replace(/"/g, '\\"')}"`;
      }
      return value;
    }
    return String(value);
  }

  /**
   * Preview what variables will be resolved
   */
  preview(context: VariableContext): {
    found: string[];
    missing: string[];
    total: number;
  } {
    const rawConfig = this.build();
    const resolver = new VariableResolver(this.variableRegistry);
    return resolver.preview(rawConfig, context);
  }

  /**
   * Clone the builder
   */
  clone(): TraefikConfigBuilder {
    const cloned = new TraefikConfigBuilder();
    cloned.httpRouters = new Map(this.httpRouters);
    cloned.httpServices = new Map(this.httpServices);
    cloned.httpMiddlewares = new Map(this.httpMiddlewares);
    cloned.tlsConfig = this.tlsConfig;
    cloned.variableRegistry = this.variableRegistry.clone();
    return cloned;
  }

  /**
   * Get statistics about the configuration
   */
  getStats(): {
    routers: number;
    services: number;
    middlewares: number;
    variables: number;
    hasTLS: boolean;
  } {
    return {
      routers: this.httpRouters.size,
      services: this.httpServices.size,
      middlewares: this.httpMiddlewares.size,
      variables: this.variableRegistry.getAll().length,
      hasTLS: !!this.tlsConfig,
    };
  }
}
