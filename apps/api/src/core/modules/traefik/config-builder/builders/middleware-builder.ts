import type {
  HttpMiddlewareConfig,
  HeadersConfig,
  RedirectSchemeConfig,
  BasicAuthConfig,
  DigestAuthConfig,
  ForwardAuthConfig,
  CompressConfig,
  BufferingConfig,
  CircuitBreakerConfig,
} from '../types/middleware.types';
import type { VariableString, VariableNumber, VariableArray, CorsOptions, RateLimitConfig, IPWhiteListConfig } from '../types/common.types';

/**
 * Builder for creating Traefik middleware configurations
 */
export class MiddlewareBuilder {
  private config: HttpMiddlewareConfig = {};

  constructor(private name: string) {}

  /**
   * Add prefix to path
   */
  addPrefix(prefix: VariableString): this {
    this.config.addPrefix = { prefix };
    return this;
  }

  /**
   * Strip prefix(es) from path
   */
  stripPrefix(...prefixes: VariableString[]): this {
    this.config.stripPrefix = {
      prefixes: prefixes as VariableArray<string>,
    };
    return this;
  }

  /**
   * Strip prefix with force slash
   */
  stripPrefixWithSlash(...prefixes: VariableString[]): this {
    this.config.stripPrefix = {
      prefixes: prefixes as VariableArray<string>,
      forceSlash: true,
    };
    return this;
  }

  /**
   * Configure headers (including CORS)
   */
  headers(config: Partial<HeadersConfig>): this {
    this.config.headers = config as HeadersConfig;
    return this;
  }

  /**
   * Configure CORS
   */
  cors(options: CorsOptions): this {
    this.config.headers = {
      ...this.config.headers,
      accessControlAllowOriginList: options.origins,
      accessControlAllowMethods: options.methods,
      accessControlAllowHeaders: options.headers,
      accessControlExposeHeaders: options.exposedHeaders,
      accessControlAllowCredentials: options.credentials,
      accessControlMaxAge: options.maxAge,
    };
    return this;
  }

  /**
   * Add custom request headers
   */
  customRequestHeaders(headers: Record<string, string>): this {
    this.config.headers = {
      ...this.config.headers,
      customRequestHeaders: headers,
    };
    return this;
  }

  /**
   * Add custom response headers
   */
  customResponseHeaders(headers: Record<string, string>): this {
    this.config.headers = {
      ...this.config.headers,
      customResponseHeaders: headers,
    };
    return this;
  }

  /**
   * Redirect to HTTPS
   */
  redirectToHttps(permanent = true): this {
    this.config.redirectScheme = {
      scheme: 'https',
      permanent,
    };
    return this;
  }

  /**
   * Redirect scheme (http/https)
   */
  redirectScheme(scheme: VariableString, port?: VariableString, permanent = true): this {
    this.config.redirectScheme = {
      scheme,
      port,
      permanent,
    };
    return this;
  }

  /**
   * Redirect using regex
   */
  redirectRegex(regex: VariableString, replacement: VariableString, permanent = true): this {
    this.config.redirectRegex = {
      regex,
      replacement,
      permanent,
    };
    return this;
  }

  /**
   * Basic authentication
   */
  basicAuth(
    users?: VariableArray<string>,
    usersFile?: VariableString,
    options?: { realm?: string; removeHeader?: boolean }
  ): this {
    this.config.basicAuth = {
      users,
      usersFile,
      realm: options?.realm,
      removeHeader: options?.removeHeader,
    };
    return this;
  }

  /**
   * Digest authentication
   */
  digestAuth(
    users?: VariableArray<string>,
    usersFile?: VariableString,
    options?: { realm?: string; removeHeader?: boolean }
  ): this {
    this.config.digestAuth = {
      users,
      usersFile,
      realm: options?.realm,
      removeHeader: options?.removeHeader,
    };
    return this;
  }

  /**
   * Forward authentication
   */
  forwardAuth(address: VariableString, options?: Partial<ForwardAuthConfig>): this {
    this.config.forwardAuth = {
      address,
      ...options,
    } as ForwardAuthConfig;
    return this;
  }

  /**
   * Chain multiple middlewares
   */
  chain(...middlewares: VariableString[]): this {
    this.config.chain = {
      middlewares: middlewares as VariableArray<string>,
    };
    return this;
  }

  /**
   * Enable compression
   */
  compress(options?: Partial<CompressConfig>): this {
    this.config.compress = options || {};
    return this;
  }

  /**
   * Rate limiting
   */
  rateLimit(config: RateLimitConfig): this {
    this.config.rateLimit = config;
    return this;
  }

  /**
   * Replace path
   */
  replacePath(path: VariableString): this {
    this.config.replacePath = { path };
    return this;
  }

  /**
   * Replace path using regex
   */
  replacePathRegex(regex: VariableString, replacement: VariableString): this {
    this.config.replacePathRegex = { regex, replacement };
    return this;
  }

  /**
   * Configure retry
   */
  retry(attempts: VariableNumber, initialInterval?: VariableString): this {
    this.config.retry = {
      attempts,
      initialInterval,
    };
    return this;
  }

  /**
   * Configure buffering
   */
  buffering(config: Partial<BufferingConfig>): this {
    this.config.buffering = config as BufferingConfig;
    return this;
  }

  /**
   * Circuit breaker
   */
  circuitBreaker(expression: VariableString, options?: Partial<CircuitBreakerConfig>): this {
    this.config.circuitBreaker = {
      expression,
      ...options,
    } as CircuitBreakerConfig;
    return this;
  }

  /**
   * In-flight request limiter
   */
  inFlightReq(amount: VariableNumber, options?: { requestHeaderName?: string; requestHost?: boolean }): this {
    this.config.inFlightReq = {
      amount,
      sourceCriterion: options,
    };
    return this;
  }

  /**
   * IP whitelist
   */
  ipWhiteList(
    sourceRange: VariableArray<string>,
    options?: { depth?: number; excludedIPs?: VariableArray<string> }
  ): this {
    this.config.ipWhiteList = {
      sourceRange,
      ipStrategy: options?.depth
        ? {
            depth: options.depth,
            excludedIPs: options.excludedIPs,
          }
        : undefined,
    };
    return this;
  }

  /**
   * Build the middleware configuration
   */
  build(): { name: string; config: HttpMiddlewareConfig } {
    if (Object.keys(this.config).length === 0) {
      throw new Error('Middleware configuration is empty');
    }
    return {
      name: this.name,
      config: this.config,
    };
  }

  /**
   * Get the middleware name
   */
  getName(): string {
    return this.name;
  }
}
