import { Injectable, Logger } from '@nestjs/common';
import { MiddlewareError, MiddlewareConfigurationError } from '../errors';

// Import types from centralized interfaces
import type {
  RateLimiterOptions,
  CorsMiddlewareOptions,
  SecurityHeadersOptions,
  CompressionOptions,
  BasicAuthOptions,
  ForwardAuthOptions,
  RetryOptions,
  CircuitBreakerOptions,
  StripPrefixOptions,
  AddPrefixOptions,
  ReplacePathOptions,
  ReplacePathRegexOptions,
  RedirectSchemeOptions,
  RedirectRegexOptions,
  IPAllowListOptions,
  HeadersOptions,
  BufferingOptions,
  ApiChainOptions,
  WebAppChainOptions,
  AdminChainOptions,
  MiddlewareConfig,
  MiddlewareChain,
} from '../interfaces';

// Re-export CorsMiddlewareOptions as CorsOptions for backward compatibility
export type CorsOptions = CorsMiddlewareOptions;

/**
 * TraefikMiddlewareLibraryService
 * 
 * Provides pre-built, customizable middleware configurations for Traefik.
 * Includes common middleware patterns like rate limiting, CORS, security headers,
 * authentication, and more.
 * 
 * @example
 * ```typescript
 * const rateLimiter = middlewareLibrary.getRateLimiter({
 *   name: 'api-limit',
 *   average: 100,
 *   burst: 50
 * });
 * 
 * builder.addMiddleware(rateLimiter.name, rateLimiter.config);
 * ```
 */
@Injectable()
export class TraefikMiddlewareLibraryService {
  private readonly logger = new Logger(TraefikMiddlewareLibraryService.name);

  // ============================================================================
  // RATE LIMITING
  // ============================================================================

  /**
   * Create a rate limiter middleware configuration
   */
  getRateLimiter(options: RateLimiterOptions): MiddlewareConfig {
    this.validateOptions(options, ['name', 'average']);

    const config: Record<string, unknown> = {
      rateLimit: {
        average: options.average,
        burst: options.burst ?? Math.ceil(options.average * 1.5),
        ...(options.period && { period: options.period }),
        ...(options.sourceCriterion && { sourceCriterion: options.sourceCriterion }),
      },
    };

    this.logger.debug(`Created rate limiter: ${options.name}`);
    return { name: options.name, config };
  }

  // ============================================================================
  // CORS
  // ============================================================================

  /**
   * Create a CORS middleware configuration
   */
  getCors(options: CorsOptions): MiddlewareConfig {
    this.validateOptions(options, ['name', 'allowOrigins']);

    const config: Record<string, unknown> = {
      headers: {
        accessControlAllowOriginList: options.allowOrigins,
        accessControlAllowMethods: options.allowMethods ?? ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        accessControlAllowHeaders: options.allowHeaders ?? ['Content-Type', 'Authorization'],
        ...(options.exposeHeaders && { accessControlExposeHeaders: options.exposeHeaders }),
        ...(options.maxAge !== undefined && { accessControlMaxAge: options.maxAge }),
        ...(options.allowCredentials !== undefined && { accessControlAllowCredentials: options.allowCredentials }),
        addVaryHeader: true,
      },
    };

    this.logger.debug(`Created CORS middleware: ${options.name}`);
    return { name: options.name, config };
  }

  // ============================================================================
  // SECURITY HEADERS
  // ============================================================================

  /**
   * Create a security headers middleware configuration
   */
  getSecurityHeaders(options: SecurityHeadersOptions): MiddlewareConfig {
    this.validateOptions(options, ['name']);

    // Use interface for typed headers object
    interface TraefikSecurityHeaders {
      stsSeconds?: number;
      stsIncludeSubdomains?: boolean;
      stsPreload?: boolean;
      contentTypeNosniff?: boolean;
      frameDeny?: boolean;
      browserXssFilter?: boolean;
      contentSecurityPolicy?: string;
      referrerPolicy?: string;
      permissionsPolicy?: string;
    }

    const headers: TraefikSecurityHeaders = {};

    // HSTS
    if (options.strictTransportSecurity) {
      headers.stsSeconds = options.strictTransportSecurity.maxAge;
      if (options.strictTransportSecurity.includeSubDomains) {
        headers.stsIncludeSubdomains = true;
      }
      if (options.strictTransportSecurity.preload) {
        headers.stsPreload = true;
      }
    }

    // Other security headers
    if (options.contentTypeNosniff !== false) {
      headers.contentTypeNosniff = true;
    }
    if (options.frameOptions) {
      headers.frameDeny = options.frameOptions === 'DENY';
    }
    if (options.xssProtection) {
      headers.browserXssFilter = options.xssProtection === '1; mode=block';
    }
    if (options.contentSecurityPolicy) {
      headers.contentSecurityPolicy = options.contentSecurityPolicy;
    }
    if (options.referrerPolicy) {
      headers.referrerPolicy = options.referrerPolicy;
    }
    if (options.permissionsPolicy) {
      headers.permissionsPolicy = options.permissionsPolicy;
    }

    const config: Record<string, unknown> = { headers };

    this.logger.debug(`Created security headers middleware: ${options.name}`);
    return { name: options.name, config };
  }

  /**
   * Get pre-configured strict security headers
   */
  getStrictSecurityHeaders(name = 'strict-security'): MiddlewareConfig {
    return this.getSecurityHeaders({
      name,
      contentSecurityPolicy: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; object-src 'none'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
      strictTransportSecurity: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      contentTypeNosniff: true,
      frameOptions: 'DENY',
      xssProtection: '1; mode=block',
      referrerPolicy: 'strict-origin-when-cross-origin',
    });
  }

  // ============================================================================
  // COMPRESSION
  // ============================================================================

  /**
   * Create a compression middleware configuration
   */
  getCompression(options: CompressionOptions): MiddlewareConfig {
    this.validateOptions(options, ['name']);

    const config: Record<string, unknown> = {
      compress: {
        ...(options.excludedContentTypes && { excludedContentTypes: options.excludedContentTypes }),
        ...(options.minResponseBodyBytes !== undefined && { minResponseBodyBytes: options.minResponseBodyBytes }),
      },
    };

    this.logger.debug(`Created compression middleware: ${options.name}`);
    return { name: options.name, config };
  }

  // ============================================================================
  // AUTHENTICATION
  // ============================================================================

  /**
   * Create a basic auth middleware configuration
   */
  getBasicAuth(options: BasicAuthOptions): MiddlewareConfig {
    this.validateOptions(options, ['name', 'users']);

    if (options.users.length === 0) {
      throw new MiddlewareConfigurationError(options.name, 'basicAuth', ['At least one user is required']);
    }

    const config: Record<string, unknown> = {
      basicAuth: {
        users: options.users,
        ...(options.realm && { realm: options.realm }),
        ...(options.removeHeader !== undefined && { removeHeader: options.removeHeader }),
        ...(options.headerField && { headerField: options.headerField }),
      },
    };

    this.logger.debug(`Created basic auth middleware: ${options.name}`);
    return { name: options.name, config };
  }

  /**
   * Create a forward auth middleware configuration
   */
  getForwardAuth(options: ForwardAuthOptions): MiddlewareConfig {
    this.validateOptions(options, ['name', 'address']);

    const config: Record<string, unknown> = {
      forwardAuth: {
        address: options.address,
        ...(options.trustForwardHeader !== undefined && { trustForwardHeader: options.trustForwardHeader }),
        ...(options.authResponseHeaders && { authResponseHeaders: options.authResponseHeaders }),
        ...(options.authResponseHeadersRegex && { authResponseHeadersRegex: options.authResponseHeadersRegex }),
        ...(options.authRequestHeaders && { authRequestHeaders: options.authRequestHeaders }),
        ...(options.tls && { tls: options.tls }),
      },
    };

    this.logger.debug(`Created forward auth middleware: ${options.name}`);
    return { name: options.name, config };
  }

  // ============================================================================
  // RESILIENCE
  // ============================================================================

  /**
   * Create a retry middleware configuration
   */
  getRetry(options: RetryOptions): MiddlewareConfig {
    this.validateOptions(options, ['name', 'attempts']);

    if (options.attempts < 1) {
      throw new MiddlewareConfigurationError(options.name, 'retry', ['Attempts must be at least 1']);
    }

    const config: Record<string, unknown> = {
      retry: {
        attempts: options.attempts,
        ...(options.initialInterval && { initialInterval: options.initialInterval }),
      },
    };

    this.logger.debug(`Created retry middleware: ${options.name}`);
    return { name: options.name, config };
  }

  /**
   * Create a circuit breaker middleware configuration
   */
  getCircuitBreaker(options: CircuitBreakerOptions): MiddlewareConfig {
    this.validateOptions(options, ['name', 'expression']);

    const config: Record<string, unknown> = {
      circuitBreaker: {
        expression: options.expression,
        ...(options.checkPeriod && { checkPeriod: options.checkPeriod }),
        ...(options.fallbackDuration && { fallbackDuration: options.fallbackDuration }),
        ...(options.recoveryDuration && { recoveryDuration: options.recoveryDuration }),
      },
    };

    this.logger.debug(`Created circuit breaker middleware: ${options.name}`);
    return { name: options.name, config };
  }

  // ============================================================================
  // PATH MANIPULATION
  // ============================================================================

  /**
   * Create a strip prefix middleware configuration
   */
  getStripPrefix(options: StripPrefixOptions): MiddlewareConfig {
    this.validateOptions(options, ['name', 'prefixes']);

    const config: Record<string, unknown> = {
      stripPrefix: {
        prefixes: options.prefixes,
        ...(options.forceSlash !== undefined && { forceSlash: options.forceSlash }),
      },
    };

    this.logger.debug(`Created strip prefix middleware: ${options.name}`);
    return { name: options.name, config };
  }

  /**
   * Create an add prefix middleware configuration
   */
  getAddPrefix(options: AddPrefixOptions): MiddlewareConfig {
    this.validateOptions(options, ['name', 'prefix']);

    const config: Record<string, unknown> = {
      addPrefix: {
        prefix: options.prefix,
      },
    };

    this.logger.debug(`Created add prefix middleware: ${options.name}`);
    return { name: options.name, config };
  }

  /**
   * Create a replace path middleware configuration
   */
  getReplacePath(options: ReplacePathOptions): MiddlewareConfig {
    this.validateOptions(options, ['name', 'path']);

    const config: Record<string, unknown> = {
      replacePath: {
        path: options.path,
      },
    };

    this.logger.debug(`Created replace path middleware: ${options.name}`);
    return { name: options.name, config };
  }

  /**
   * Create a replace path regex middleware configuration
   */
  getReplacePathRegex(options: ReplacePathRegexOptions): MiddlewareConfig {
    this.validateOptions(options, ['name', 'regex', 'replacement']);

    const config: Record<string, unknown> = {
      replacePathRegex: {
        regex: options.regex,
        replacement: options.replacement,
      },
    };

    this.logger.debug(`Created replace path regex middleware: ${options.name}`);
    return { name: options.name, config };
  }

  // ============================================================================
  // REDIRECTS
  // ============================================================================

  /**
   * Create a redirect scheme middleware configuration
   */
  getRedirectScheme(options: RedirectSchemeOptions): MiddlewareConfig {
    this.validateOptions(options, ['name', 'scheme']);

    const config: Record<string, unknown> = {
      redirectScheme: {
        scheme: options.scheme,
        ...(options.permanent !== undefined && { permanent: options.permanent }),
        ...(options.port && { port: options.port }),
      },
    };

    this.logger.debug(`Created redirect scheme middleware: ${options.name}`);
    return { name: options.name, config };
  }

  /**
   * Create a redirect regex middleware configuration
   */
  getRedirectRegex(options: RedirectRegexOptions): MiddlewareConfig {
    this.validateOptions(options, ['name', 'regex', 'replacement']);

    const config: Record<string, unknown> = {
      redirectRegex: {
        regex: options.regex,
        replacement: options.replacement,
        ...(options.permanent !== undefined && { permanent: options.permanent }),
      },
    };

    this.logger.debug(`Created redirect regex middleware: ${options.name}`);
    return { name: options.name, config };
  }

  /**
   * Get pre-configured HTTPS redirect middleware
   */
  getHttpsRedirect(name = 'https-redirect'): MiddlewareConfig {
    return this.getRedirectScheme({
      name,
      scheme: 'https',
      permanent: true,
    });
  }

  // ============================================================================
  // IP FILTERING
  // ============================================================================

  /**
   * Create an IP allow list middleware configuration
   */
  getIPAllowList(options: IPAllowListOptions): MiddlewareConfig {
    this.validateOptions(options, ['name', 'sourceRange']);

    const config: Record<string, unknown> = {
      ipAllowList: {
        sourceRange: options.sourceRange,
        ...(options.ipStrategy && { ipStrategy: options.ipStrategy }),
      },
    };

    this.logger.debug(`Created IP allow list middleware: ${options.name}`);
    return { name: options.name, config };
  }

  // ============================================================================
  // HEADERS
  // ============================================================================

  /**
   * Create a custom headers middleware configuration
   */
  getHeaders(options: HeadersOptions): MiddlewareConfig {
    this.validateOptions(options, ['name']);

    const headersConfig: Record<string, unknown> = {};

    // Add all provided options
    const headerKeys: (keyof HeadersOptions)[] = [
      'customRequestHeaders',
      'customResponseHeaders',
      'accessControlAllowCredentials',
      'accessControlAllowHeaders',
      'accessControlAllowMethods',
      'accessControlAllowOriginList',
      'accessControlExposeHeaders',
      'accessControlMaxAge',
      'addVaryHeader',
      'hostsProxyHeaders',
      'sslProxyHeaders',
      'stsSeconds',
      'stsIncludeSubdomains',
      'stsPreload',
      'forceSTSHeader',
      'frameDeny',
      'contentTypeNosniff',
      'browserXssFilter',
      'contentSecurityPolicy',
      'referrerPolicy',
      'permissionsPolicy',
      'isDevelopment',
    ];

    for (const key of headerKeys) {
      if (options[key] !== undefined) {
        headersConfig[key] = options[key];
      }
    }

    const config: Record<string, unknown> = { headers: headersConfig };

    this.logger.debug(`Created headers middleware: ${options.name}`);
    return { name: options.name, config };
  }

  // ============================================================================
  // BUFFERING
  // ============================================================================

  /**
   * Create a buffering middleware configuration
   */
  getBuffering(options: BufferingOptions): MiddlewareConfig {
    this.validateOptions(options, ['name']);

    const config: Record<string, unknown> = {
      buffering: {
        ...(options.maxRequestBodyBytes !== undefined && { maxRequestBodyBytes: options.maxRequestBodyBytes }),
        ...(options.memRequestBodyBytes !== undefined && { memRequestBodyBytes: options.memRequestBodyBytes }),
        ...(options.maxResponseBodyBytes !== undefined && { maxResponseBodyBytes: options.maxResponseBodyBytes }),
        ...(options.memResponseBodyBytes !== undefined && { memResponseBodyBytes: options.memResponseBodyBytes }),
        ...(options.retryExpression && { retryExpression: options.retryExpression }),
      },
    };

    this.logger.debug(`Created buffering middleware: ${options.name}`);
    return { name: options.name, config };
  }

  // ============================================================================
  // MIDDLEWARE CHAINS
  // ============================================================================

  /**
   * Create an API middleware chain
   */
  getApiChain(options: ApiChainOptions): MiddlewareChain {
    this.validateOptions(options, ['name']);

    const middlewares: MiddlewareConfig[] = [];

    if (options.rateLimit) {
      middlewares.push(
        this.getRateLimiter({
          name: `${options.name}-rate-limit`,
          ...options.rateLimit,
        })
      );
    }

    if (options.cors) {
      middlewares.push(
        this.getCors({
          name: `${options.name}-cors`,
          ...options.cors,
        })
      );
    }

    if (options.compression) {
      middlewares.push(
        this.getCompression({
          name: `${options.name}-compress`,
        })
      );
    }

    if (options.securityHeaders) {
      middlewares.push(
        this.getSecurityHeaders({
          name: `${options.name}-security`,
          contentTypeNosniff: true,
          referrerPolicy: 'strict-origin-when-cross-origin',
        })
      );
    }

    const chain: Record<string, unknown> = {
      chain: {
        middlewares: middlewares.map((m) => m.name),
      },
    };

    this.logger.debug(`Created API chain: ${options.name} with ${String(middlewares.length)} middlewares`);
    return { name: options.name, middlewares, chain };
  }

  /**
   * Create a web application middleware chain
   */
  getWebAppChain(options: WebAppChainOptions): MiddlewareChain {
    this.validateOptions(options, ['name']);

    const middlewares: MiddlewareConfig[] = [];

    if (options.httpsRedirect) {
      middlewares.push(this.getHttpsRedirect(`${options.name}-https`));
    }

    if (options.wwwRedirect) {
      const pattern = options.wwwRedirect.stripWww
        ? `^https?://www\\.${options.wwwRedirect.domain.replace('.', '\\.')}(.*)`
        : `^https?://${options.wwwRedirect.domain.replace('.', '\\.')}(.*)`;
      const replacement = options.wwwRedirect.stripWww
        ? `https://${options.wwwRedirect.domain}\${1}`
        : `https://www.${options.wwwRedirect.domain}\${1}`;

      middlewares.push(
        this.getRedirectRegex({
          name: `${options.name}-www`,
          regex: pattern,
          replacement,
          permanent: true,
        })
      );
    }

    if (options.securityHeaders) {
      middlewares.push(this.getStrictSecurityHeaders(`${options.name}-security`));
    }

    if (options.compression) {
      middlewares.push(
        this.getCompression({
          name: `${options.name}-compress`,
        })
      );
    }

    const chain: Record<string, unknown> = {
      chain: {
        middlewares: middlewares.map((m) => m.name),
      },
    };

    this.logger.debug(`Created web app chain: ${options.name} with ${String(middlewares.length)} middlewares`);
    return { name: options.name, middlewares, chain };
  }

  /**
   * Create an admin panel middleware chain
   */
  getAdminChain(options: AdminChainOptions): MiddlewareChain {
    this.validateOptions(options, ['name']);

    const middlewares: MiddlewareConfig[] = [];

    if (options.ipAllowList && options.ipAllowList.length > 0) {
      middlewares.push(
        this.getIPAllowList({
          name: `${options.name}-ip`,
          sourceRange: options.ipAllowList,
        })
      );
    }

    if (options.basicAuth) {
      middlewares.push(
        this.getBasicAuth({
          name: `${options.name}-auth`,
          users: options.basicAuth.users,
          realm: options.basicAuth.realm ?? 'Admin Area',
        })
      );
    }

    if (options.rateLimit) {
      middlewares.push(
        this.getRateLimiter({
          name: `${options.name}-rate-limit`,
          average: options.rateLimit.average,
          burst: options.rateLimit.burst,
        })
      );
    }

    if (options.securityHeaders) {
      middlewares.push(this.getStrictSecurityHeaders(`${options.name}-security`));
    }

    const chain: Record<string, unknown> = {
      chain: {
        middlewares: middlewares.map((m) => m.name),
      },
    };

    this.logger.debug(`Created admin chain: ${options.name} with ${String(middlewares.length)} middlewares`);
    return { name: options.name, middlewares, chain };
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  /**
   * Validate required options
   * Uses generic constraint to accept any object type while maintaining type safety
   */
  private validateOptions<T extends { name: string }>(
    options: T,
    requiredFields: (keyof T)[]
  ): void {
    const missingFields = requiredFields.filter(
      (field) => options[field] === undefined || options[field] === null
    );

    if (missingFields.length > 0) {
      const fieldNames = missingFields.map((f) => String(f)).join(', ');
      throw new MiddlewareError(
        `Missing required fields: ${fieldNames}`,
        options.name,
        undefined
      );
    }
  }
}
