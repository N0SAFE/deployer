import type { HttpRouterConfig } from '../types/router.types';
import type { TLSOptions, VariableString, VariableNumber, VariableArray } from '../types/common.types';
import { RuleBuilder } from './rule-builder';

/**
 * Builder for creating HTTP router configurations
 */
export class HttpRouterBuilder {
  private config: Partial<HttpRouterConfig> = {};

  constructor(private name: string) {}

  /**
   * Set routing rule
   * @example .rule('Host(`example.com`)')
   * @example .rule(new RuleBuilder().host('example.com').pathPrefix('/api'))
   * @example .rule(r => r.host('example.com').pathPrefix('/api'))
   */
  rule(ruleOrBuilderOrFn: VariableString | RuleBuilder | ((rb: RuleBuilder) => RuleBuilder)): this {
    if (typeof ruleOrBuilderOrFn === 'string') {
      this.config.rule = ruleOrBuilderOrFn;
    } else if (ruleOrBuilderOrFn instanceof RuleBuilder) {
      this.config.rule = ruleOrBuilderOrFn.build();
    } else {
      const builder = ruleOrBuilderOrFn(new RuleBuilder());
      this.config.rule = builder.build();
    }
    return this;
  }

  /**
   * Set service name
   */
  service(serviceName: VariableString): this {
    this.config.service = serviceName;
    return this;
  }

  /**
   * Set entry points
   */
  entryPoints(...names: string[]): this {
    this.config.entryPoints = names as VariableArray<string>;
    return this;
  }

  /**
   * Add a single entry point
   */
  entryPoint(name: string): this {
    if (!this.config.entryPoints) {
      this.config.entryPoints = [];
    }
    (this.config.entryPoints as string[]).push(name);
    return this;
  }

  /**
   * Set middlewares
   */
  middlewares(...names: string[]): this {
    this.config.middlewares = names as VariableArray<string>;
    return this;
  }

  /**
   * Add a single middleware
   */
  middleware(name: string): this {
    if (!this.config.middlewares) {
      this.config.middlewares = [];
    }
    (this.config.middlewares as string[]).push(name);
    return this;
  }

  /**
   * Set priority
   */
  priority(value: number): this {
    this.config.priority = value;
    return this;
  }

  /**
   * Enable TLS
   * @example .tls() // Simple TLS
   * @example .tls(true) // Simple TLS
   * @example .tls({ certResolver: 'letsencrypt' }) // With cert resolver
   * @example .tls({ certResolver: 'letsencrypt', domains: [{ main: 'example.com' }] })
   */
  tls(options?: boolean | Partial<TLSOptions>): this {
    if (options === undefined || options === true) {
      this.config.tls = true;
    } else if (options === false) {
      this.config.tls = undefined;
    } else {
      this.config.tls = options as TLSOptions;
    }
    return this;
  }

  /**
   * Set TLS cert resolver
   */
  certResolver(resolver: VariableString): this {
    if (typeof this.config.tls === 'object') {
      this.config.tls.certResolver = resolver;
    } else {
      this.config.tls = { certResolver: resolver };
    }
    return this;
  }

  /**
   * Add TLS domain
   */
  domain(main: VariableString, sans?: VariableArray<string>): this {
    if (typeof this.config.tls !== 'object') {
      this.config.tls = {};
    }
    if (!this.config.tls.domains) {
      this.config.tls.domains = [];
    }
    this.config.tls.domains.push({ main, sans });
    return this;
  }

  /**
   * Build the router configuration
   */
  build(): { name: string; config: HttpRouterConfig } {
    if (!this.config.rule) {
      throw new Error(`Router '${this.name}' must have a rule`);
    }
    if (!this.config.service) {
      throw new Error(`Router '${this.name}' must have a service`);
    }

    return {
      name: this.name,
      config: this.config as HttpRouterConfig,
    };
  }

  /**
   * Get the router name
   */
  getName(): string {
    return this.name;
  }
}
