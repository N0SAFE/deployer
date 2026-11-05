import { Context, Effect } from 'effect'

import {
    MiddlewareConfigurationInvalid,
    MiddlewareOptionsInvalid,
} from '../errors'

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
} from '../interfaces'

// Re-export CorsMiddlewareOptions as CorsOptions for backward compatibility
export type CorsOptions = CorsMiddlewareOptions

/** What a builder can refuse with. */
export type MiddlewareFailure =
    MiddlewareOptionsInvalid | MiddlewareConfigurationInvalid

/** Validate required options (`name` is always present on the options types). */
const validateOptions = <T extends { name: string }>(
    options: T,
    requiredFields: (keyof T)[]
): Effect.Effect<void, MiddlewareOptionsInvalid> => {
    const missingFields = requiredFields
        .filter(
            (field) => options[field] === undefined || options[field] === null
        )
        .map(String)
    return missingFields.length > 0
        ? Effect.fail(
              new MiddlewareOptionsInvalid({
                  middlewareName: options.name,
                  missingFields,
              })
          )
        : Effect.void
}

/**
 * TraefikMiddlewareLibraryService
 *
 * Pre-built, customizable middleware configurations for Traefik: rate limiting, CORS, security headers, authentication,
 * redirects, path rewriting and chains. Pure and stateless; a missing required option fails with `MiddlewareOptionsInvalid`.
 *
 * ```ts
 * const rateLimiter = yield* library.getRateLimiter({ name: 'api-limit', average: 100, burst: 50 });
 * builder.addMiddleware(rateLimiter.name, rateLimiter.config);
 * ```
 */
export type TraefikMiddlewareLibraryShape = {
    readonly getRateLimiter: (
        options: RateLimiterOptions
    ) => Effect.Effect<MiddlewareConfig, MiddlewareFailure>
    readonly getCors: (
        options: CorsOptions
    ) => Effect.Effect<MiddlewareConfig, MiddlewareFailure>
    readonly getSecurityHeaders: (
        options: SecurityHeadersOptions
    ) => Effect.Effect<MiddlewareConfig, MiddlewareFailure>
    readonly getStrictSecurityHeaders: (
        name?: string
    ) => Effect.Effect<MiddlewareConfig, MiddlewareFailure>
    readonly getCompression: (
        options: CompressionOptions
    ) => Effect.Effect<MiddlewareConfig, MiddlewareFailure>
    readonly getBasicAuth: (
        options: BasicAuthOptions
    ) => Effect.Effect<MiddlewareConfig, MiddlewareFailure>
    readonly getForwardAuth: (
        options: ForwardAuthOptions
    ) => Effect.Effect<MiddlewareConfig, MiddlewareFailure>
    readonly getRetry: (
        options: RetryOptions
    ) => Effect.Effect<MiddlewareConfig, MiddlewareFailure>
    readonly getCircuitBreaker: (
        options: CircuitBreakerOptions
    ) => Effect.Effect<MiddlewareConfig, MiddlewareFailure>
    readonly getStripPrefix: (
        options: StripPrefixOptions
    ) => Effect.Effect<MiddlewareConfig, MiddlewareFailure>
    readonly getAddPrefix: (
        options: AddPrefixOptions
    ) => Effect.Effect<MiddlewareConfig, MiddlewareFailure>
    readonly getReplacePath: (
        options: ReplacePathOptions
    ) => Effect.Effect<MiddlewareConfig, MiddlewareFailure>
    readonly getReplacePathRegex: (
        options: ReplacePathRegexOptions
    ) => Effect.Effect<MiddlewareConfig, MiddlewareFailure>
    readonly getRedirectScheme: (
        options: RedirectSchemeOptions
    ) => Effect.Effect<MiddlewareConfig, MiddlewareFailure>
    readonly getRedirectRegex: (
        options: RedirectRegexOptions
    ) => Effect.Effect<MiddlewareConfig, MiddlewareFailure>
    readonly getHttpsRedirect: (
        name?: string
    ) => Effect.Effect<MiddlewareConfig, MiddlewareFailure>
    readonly getIPAllowList: (
        options: IPAllowListOptions
    ) => Effect.Effect<MiddlewareConfig, MiddlewareFailure>
    readonly getHeaders: (
        options: HeadersOptions
    ) => Effect.Effect<MiddlewareConfig, MiddlewareFailure>
    readonly getBuffering: (
        options: BufferingOptions
    ) => Effect.Effect<MiddlewareConfig, MiddlewareFailure>
    readonly getApiChain: (
        options: ApiChainOptions
    ) => Effect.Effect<MiddlewareChain, MiddlewareFailure>
    readonly getWebAppChain: (
        options: WebAppChainOptions
    ) => Effect.Effect<MiddlewareChain, MiddlewareFailure>
    readonly getAdminChain: (
        options: AdminChainOptions
    ) => Effect.Effect<MiddlewareChain, MiddlewareFailure>
}

export function makeTraefikMiddlewareLibrary(): TraefikMiddlewareLibraryShape {
    /**
     * Create a rate limiter middleware configuration
     */
    const getRateLimiter = (
        options: RateLimiterOptions
    ): Effect.Effect<MiddlewareConfig, MiddlewareFailure> =>
        Effect.gen(function* () {
            yield* validateOptions(options, ['name', 'average'])

            const config: Record<string, unknown> = {
                rateLimit: {
                    average: options.average,
                    burst: options.burst ?? Math.ceil(options.average * 1.5),
                    ...(options.period && { period: options.period }),
                    ...(options.sourceCriterion && {
                        sourceCriterion: options.sourceCriterion,
                    }),
                },
            }

            yield* Effect.logDebug(`Created rate limiter: ${options.name}`)
            return { name: options.name, config }
        })

    /**
     * Create a CORS middleware configuration
     */
    const getCors = (
        options: CorsOptions
    ): Effect.Effect<MiddlewareConfig, MiddlewareFailure> =>
        Effect.gen(function* () {
            yield* validateOptions(options, ['name', 'allowOrigins'])

            const config: Record<string, unknown> = {
                headers: {
                    accessControlAllowOriginList: options.allowOrigins,
                    accessControlAllowMethods: options.allowMethods ?? [
                        'GET',
                        'POST',
                        'PUT',
                        'DELETE',
                        'OPTIONS',
                    ],
                    accessControlAllowHeaders: options.allowHeaders ?? [
                        'Content-Type',
                        'Authorization',
                    ],
                    ...(options.exposeHeaders && {
                        accessControlExposeHeaders: options.exposeHeaders,
                    }),
                    ...(options.maxAge !== undefined && {
                        accessControlMaxAge: options.maxAge,
                    }),
                    ...(options.allowCredentials !== undefined && {
                        accessControlAllowCredentials: options.allowCredentials,
                    }),
                    addVaryHeader: true,
                },
            }

            yield* Effect.logDebug(`Created CORS middleware: ${options.name}`)
            return { name: options.name, config }
        })

    /**
     * Create a security headers middleware configuration
     */
    const getSecurityHeaders = (
        options: SecurityHeadersOptions
    ): Effect.Effect<MiddlewareConfig, MiddlewareFailure> =>
        Effect.gen(function* () {
            yield* validateOptions(options, ['name'])

            // Use interface for typed headers object
            type TraefikSecurityHeaders = {
                stsSeconds?: number
                stsIncludeSubdomains?: boolean
                stsPreload?: boolean
                contentTypeNosniff?: boolean
                frameDeny?: boolean
                browserXssFilter?: boolean
                contentSecurityPolicy?: string
                referrerPolicy?: string
                permissionsPolicy?: string
            }

            const headers: TraefikSecurityHeaders = {}

            // HSTS
            if (options.strictTransportSecurity) {
                headers.stsSeconds = options.strictTransportSecurity.maxAge
                if (options.strictTransportSecurity.includeSubDomains) {
                    headers.stsIncludeSubdomains = true
                }
                if (options.strictTransportSecurity.preload) {
                    headers.stsPreload = true
                }
            }

            // Other security headers
            if (options.contentTypeNosniff !== false) {
                headers.contentTypeNosniff = true
            }
            if (options.frameOptions) {
                headers.frameDeny = options.frameOptions === 'DENY'
            }
            if (options.xssProtection) {
                headers.browserXssFilter =
                    options.xssProtection === '1; mode=block'
            }
            if (options.contentSecurityPolicy) {
                headers.contentSecurityPolicy = options.contentSecurityPolicy
            }
            if (options.referrerPolicy) {
                headers.referrerPolicy = options.referrerPolicy
            }
            if (options.permissionsPolicy) {
                headers.permissionsPolicy = options.permissionsPolicy
            }

            const config: Record<string, unknown> = { headers }

            yield* Effect.logDebug(
                `Created security headers middleware: ${options.name}`
            )
            return { name: options.name, config }
        })

    /**
     * Get pre-configured strict security headers
     */
    const getStrictSecurityHeaders = (
        name = 'strict-security'
    ): Effect.Effect<MiddlewareConfig, MiddlewareFailure> =>
        Effect.gen(function* () {
            return yield* getSecurityHeaders({
                name,
                contentSecurityPolicy:
                    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; object-src 'none'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
                strictTransportSecurity: {
                    maxAge: 31536000,
                    includeSubDomains: true,
                    preload: true,
                },
                contentTypeNosniff: true,
                frameOptions: 'DENY',
                xssProtection: '1; mode=block',
                referrerPolicy: 'strict-origin-when-cross-origin',
            })
        })

    /**
     * Create a compression middleware configuration
     */
    const getCompression = (
        options: CompressionOptions
    ): Effect.Effect<MiddlewareConfig, MiddlewareFailure> =>
        Effect.gen(function* () {
            yield* validateOptions(options, ['name'])

            const config: Record<string, unknown> = {
                compress: {
                    ...(options.excludedContentTypes && {
                        excludedContentTypes: options.excludedContentTypes,
                    }),
                    ...(options.minResponseBodyBytes !== undefined && {
                        minResponseBodyBytes: options.minResponseBodyBytes,
                    }),
                },
            }

            yield* Effect.logDebug(
                `Created compression middleware: ${options.name}`
            )
            return { name: options.name, config }
        })

    /**
     * Create a basic auth middleware configuration
     */
    const getBasicAuth = (
        options: BasicAuthOptions
    ): Effect.Effect<MiddlewareConfig, MiddlewareFailure> =>
        Effect.gen(function* () {
            yield* validateOptions(options, ['name', 'users'])

            if (options.users.length === 0) {
                return yield* new MiddlewareConfigurationInvalid({
                    middlewareName: options.name,
                    middlewareType: 'basicAuth',
                    validationErrors: ['At least one user is required'],
                })
            }

            const config: Record<string, unknown> = {
                basicAuth: {
                    users: options.users,
                    ...(options.realm && { realm: options.realm }),
                    ...(options.removeHeader !== undefined && {
                        removeHeader: options.removeHeader,
                    }),
                    ...(options.headerField && {
                        headerField: options.headerField,
                    }),
                },
            }

            yield* Effect.logDebug(
                `Created basic auth middleware: ${options.name}`
            )
            return { name: options.name, config }
        })

    /**
     * Create a forward auth middleware configuration
     */
    const getForwardAuth = (
        options: ForwardAuthOptions
    ): Effect.Effect<MiddlewareConfig, MiddlewareFailure> =>
        Effect.gen(function* () {
            yield* validateOptions(options, ['name', 'address'])

            const config: Record<string, unknown> = {
                forwardAuth: {
                    address: options.address,
                    ...(options.trustForwardHeader !== undefined && {
                        trustForwardHeader: options.trustForwardHeader,
                    }),
                    ...(options.authResponseHeaders && {
                        authResponseHeaders: options.authResponseHeaders,
                    }),
                    ...(options.authResponseHeadersRegex && {
                        authResponseHeadersRegex:
                            options.authResponseHeadersRegex,
                    }),
                    ...(options.authRequestHeaders && {
                        authRequestHeaders: options.authRequestHeaders,
                    }),
                    ...(options.tls && { tls: options.tls }),
                },
            }

            yield* Effect.logDebug(
                `Created forward auth middleware: ${options.name}`
            )
            return { name: options.name, config }
        })

    /**
     * Create a retry middleware configuration
     */
    const getRetry = (
        options: RetryOptions
    ): Effect.Effect<MiddlewareConfig, MiddlewareFailure> =>
        Effect.gen(function* () {
            yield* validateOptions(options, ['name', 'attempts'])

            if (options.attempts < 1) {
                return yield* new MiddlewareConfigurationInvalid({
                    middlewareName: options.name,
                    middlewareType: 'retry',
                    validationErrors: ['Attempts must be at least 1'],
                })
            }

            const config: Record<string, unknown> = {
                retry: {
                    attempts: options.attempts,
                    ...(options.initialInterval && {
                        initialInterval: options.initialInterval,
                    }),
                },
            }

            yield* Effect.logDebug(`Created retry middleware: ${options.name}`)
            return { name: options.name, config }
        })

    /**
     * Create a circuit breaker middleware configuration
     */
    const getCircuitBreaker = (
        options: CircuitBreakerOptions
    ): Effect.Effect<MiddlewareConfig, MiddlewareFailure> =>
        Effect.gen(function* () {
            yield* validateOptions(options, ['name', 'expression'])

            const config: Record<string, unknown> = {
                circuitBreaker: {
                    expression: options.expression,
                    ...(options.checkPeriod && {
                        checkPeriod: options.checkPeriod,
                    }),
                    ...(options.fallbackDuration && {
                        fallbackDuration: options.fallbackDuration,
                    }),
                    ...(options.recoveryDuration && {
                        recoveryDuration: options.recoveryDuration,
                    }),
                },
            }

            yield* Effect.logDebug(
                `Created circuit breaker middleware: ${options.name}`
            )
            return { name: options.name, config }
        })

    /**
     * Create a strip prefix middleware configuration
     */
    const getStripPrefix = (
        options: StripPrefixOptions
    ): Effect.Effect<MiddlewareConfig, MiddlewareFailure> =>
        Effect.gen(function* () {
            yield* validateOptions(options, ['name', 'prefixes'])

            const config: Record<string, unknown> = {
                stripPrefix: {
                    prefixes: options.prefixes,
                    ...(options.forceSlash !== undefined && {
                        forceSlash: options.forceSlash,
                    }),
                },
            }

            yield* Effect.logDebug(
                `Created strip prefix middleware: ${options.name}`
            )
            return { name: options.name, config }
        })

    /**
     * Create an add prefix middleware configuration
     */
    const getAddPrefix = (
        options: AddPrefixOptions
    ): Effect.Effect<MiddlewareConfig, MiddlewareFailure> =>
        Effect.gen(function* () {
            yield* validateOptions(options, ['name', 'prefix'])

            const config: Record<string, unknown> = {
                addPrefix: {
                    prefix: options.prefix,
                },
            }

            yield* Effect.logDebug(
                `Created add prefix middleware: ${options.name}`
            )
            return { name: options.name, config }
        })

    /**
     * Create a replace path middleware configuration
     */
    const getReplacePath = (
        options: ReplacePathOptions
    ): Effect.Effect<MiddlewareConfig, MiddlewareFailure> =>
        Effect.gen(function* () {
            yield* validateOptions(options, ['name', 'path'])

            const config: Record<string, unknown> = {
                replacePath: {
                    path: options.path,
                },
            }

            yield* Effect.logDebug(
                `Created replace path middleware: ${options.name}`
            )
            return { name: options.name, config }
        })

    /**
     * Create a replace path regex middleware configuration
     */
    const getReplacePathRegex = (
        options: ReplacePathRegexOptions
    ): Effect.Effect<MiddlewareConfig, MiddlewareFailure> =>
        Effect.gen(function* () {
            yield* validateOptions(options, ['name', 'regex', 'replacement'])

            const config: Record<string, unknown> = {
                replacePathRegex: {
                    regex: options.regex,
                    replacement: options.replacement,
                },
            }

            yield* Effect.logDebug(
                `Created replace path regex middleware: ${options.name}`
            )
            return { name: options.name, config }
        })

    /**
     * Create a redirect scheme middleware configuration
     */
    const getRedirectScheme = (
        options: RedirectSchemeOptions
    ): Effect.Effect<MiddlewareConfig, MiddlewareFailure> =>
        Effect.gen(function* () {
            yield* validateOptions(options, ['name', 'scheme'])

            const config: Record<string, unknown> = {
                redirectScheme: {
                    scheme: options.scheme,
                    ...(options.permanent !== undefined && {
                        permanent: options.permanent,
                    }),
                    ...(options.port && { port: options.port }),
                },
            }

            yield* Effect.logDebug(
                `Created redirect scheme middleware: ${options.name}`
            )
            return { name: options.name, config }
        })

    /**
     * Create a redirect regex middleware configuration
     */
    const getRedirectRegex = (
        options: RedirectRegexOptions
    ): Effect.Effect<MiddlewareConfig, MiddlewareFailure> =>
        Effect.gen(function* () {
            yield* validateOptions(options, ['name', 'regex', 'replacement'])

            const config: Record<string, unknown> = {
                redirectRegex: {
                    regex: options.regex,
                    replacement: options.replacement,
                    ...(options.permanent !== undefined && {
                        permanent: options.permanent,
                    }),
                },
            }

            yield* Effect.logDebug(
                `Created redirect regex middleware: ${options.name}`
            )
            return { name: options.name, config }
        })

    /**
     * Get pre-configured HTTPS redirect middleware
     */
    const getHttpsRedirect = (
        name = 'https-redirect'
    ): Effect.Effect<MiddlewareConfig, MiddlewareFailure> =>
        Effect.gen(function* () {
            return yield* getRedirectScheme({
                name,
                scheme: 'https',
                permanent: true,
            })
        })

    /**
     * Create an IP allow list middleware configuration
     */
    const getIPAllowList = (
        options: IPAllowListOptions
    ): Effect.Effect<MiddlewareConfig, MiddlewareFailure> =>
        Effect.gen(function* () {
            yield* validateOptions(options, ['name', 'sourceRange'])

            const config: Record<string, unknown> = {
                ipAllowList: {
                    sourceRange: options.sourceRange,
                    ...(options.ipStrategy && {
                        ipStrategy: options.ipStrategy,
                    }),
                },
            }

            yield* Effect.logDebug(
                `Created IP allow list middleware: ${options.name}`
            )
            return { name: options.name, config }
        })

    /**
     * Create a custom headers middleware configuration
     */
    const getHeaders = (
        options: HeadersOptions
    ): Effect.Effect<MiddlewareConfig, MiddlewareFailure> =>
        Effect.gen(function* () {
            yield* validateOptions(options, ['name'])

            const headersConfig: Record<string, unknown> = {}

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
            ]

            for (const key of headerKeys) {
                if (options[key] !== undefined) {
                    headersConfig[key] = options[key]
                }
            }

            const config: Record<string, unknown> = { headers: headersConfig }

            yield* Effect.logDebug(
                `Created headers middleware: ${options.name}`
            )
            return { name: options.name, config }
        })

    /**
     * Create a buffering middleware configuration
     */
    const getBuffering = (
        options: BufferingOptions
    ): Effect.Effect<MiddlewareConfig, MiddlewareFailure> =>
        Effect.gen(function* () {
            yield* validateOptions(options, ['name'])

            const config: Record<string, unknown> = {
                buffering: {
                    ...(options.maxRequestBodyBytes !== undefined && {
                        maxRequestBodyBytes: options.maxRequestBodyBytes,
                    }),
                    ...(options.memRequestBodyBytes !== undefined && {
                        memRequestBodyBytes: options.memRequestBodyBytes,
                    }),
                    ...(options.maxResponseBodyBytes !== undefined && {
                        maxResponseBodyBytes: options.maxResponseBodyBytes,
                    }),
                    ...(options.memResponseBodyBytes !== undefined && {
                        memResponseBodyBytes: options.memResponseBodyBytes,
                    }),
                    ...(options.retryExpression && {
                        retryExpression: options.retryExpression,
                    }),
                },
            }

            yield* Effect.logDebug(
                `Created buffering middleware: ${options.name}`
            )
            return { name: options.name, config }
        })

    /**
     * Create an API middleware chain
     */
    const getApiChain = (
        options: ApiChainOptions
    ): Effect.Effect<MiddlewareChain, MiddlewareFailure> =>
        Effect.gen(function* () {
            yield* validateOptions(options, ['name'])

            const middlewares: MiddlewareConfig[] = []

            if (options.rateLimit) {
                middlewares.push(
                    yield* getRateLimiter({
                        name: `${options.name}-rate-limit`,
                        ...options.rateLimit,
                    })
                )
            }

            if (options.cors) {
                middlewares.push(
                    yield* getCors({
                        name: `${options.name}-cors`,
                        ...options.cors,
                    })
                )
            }

            if (options.compression) {
                middlewares.push(
                    yield* getCompression({
                        name: `${options.name}-compress`,
                    })
                )
            }

            if (options.securityHeaders) {
                middlewares.push(
                    yield* getSecurityHeaders({
                        name: `${options.name}-security`,
                        contentTypeNosniff: true,
                        referrerPolicy: 'strict-origin-when-cross-origin',
                    })
                )
            }

            const chain: Record<string, unknown> = {
                chain: {
                    middlewares: middlewares.map((m) => m.name),
                },
            }

            yield* Effect.logDebug(
                `Created API chain: ${options.name} with ${String(middlewares.length)} middlewares`
            )
            return { name: options.name, middlewares, chain }
        })

    /**
     * Create a web application middleware chain
     */
    const getWebAppChain = (
        options: WebAppChainOptions
    ): Effect.Effect<MiddlewareChain, MiddlewareFailure> =>
        Effect.gen(function* () {
            yield* validateOptions(options, ['name'])

            const middlewares: MiddlewareConfig[] = []

            if (options.httpsRedirect) {
                middlewares.push(
                    yield* getHttpsRedirect(`${options.name}-https`)
                )
            }

            if (options.wwwRedirect) {
                const pattern = options.wwwRedirect.stripWww
                    ? `^https?://www\\.${options.wwwRedirect.domain.replace('.', '\\.')}(.*)`
                    : `^https?://${options.wwwRedirect.domain.replace('.', '\\.')}(.*)`
                const replacement = options.wwwRedirect.stripWww
                    ? `https://${options.wwwRedirect.domain}\${1}`
                    : `https://www.${options.wwwRedirect.domain}\${1}`

                middlewares.push(
                    yield* getRedirectRegex({
                        name: `${options.name}-www`,
                        regex: pattern,
                        replacement,
                        permanent: true,
                    })
                )
            }

            if (options.securityHeaders) {
                middlewares.push(
                    yield* getStrictSecurityHeaders(`${options.name}-security`)
                )
            }

            if (options.compression) {
                middlewares.push(
                    yield* getCompression({
                        name: `${options.name}-compress`,
                    })
                )
            }

            const chain: Record<string, unknown> = {
                chain: {
                    middlewares: middlewares.map((m) => m.name),
                },
            }

            yield* Effect.logDebug(
                `Created web app chain: ${options.name} with ${String(middlewares.length)} middlewares`
            )
            return { name: options.name, middlewares, chain }
        })

    /**
     * Create an admin panel middleware chain
     */
    const getAdminChain = (
        options: AdminChainOptions
    ): Effect.Effect<MiddlewareChain, MiddlewareFailure> =>
        Effect.gen(function* () {
            yield* validateOptions(options, ['name'])

            const middlewares: MiddlewareConfig[] = []

            if (options.ipAllowList && options.ipAllowList.length > 0) {
                middlewares.push(
                    yield* getIPAllowList({
                        name: `${options.name}-ip`,
                        sourceRange: options.ipAllowList,
                    })
                )
            }

            if (options.basicAuth) {
                middlewares.push(
                    yield* getBasicAuth({
                        name: `${options.name}-auth`,
                        users: options.basicAuth.users,
                        realm: options.basicAuth.realm ?? 'Admin Area',
                    })
                )
            }

            if (options.rateLimit) {
                middlewares.push(
                    yield* getRateLimiter({
                        name: `${options.name}-rate-limit`,
                        average: options.rateLimit.average,
                        burst: options.rateLimit.burst,
                    })
                )
            }

            if (options.securityHeaders) {
                middlewares.push(
                    yield* getStrictSecurityHeaders(`${options.name}-security`)
                )
            }

            const chain: Record<string, unknown> = {
                chain: {
                    middlewares: middlewares.map((m) => m.name),
                },
            }

            yield* Effect.logDebug(
                `Created admin chain: ${options.name} with ${String(middlewares.length)} middlewares`
            )
            return { name: options.name, middlewares, chain }
        })

    return {
        getRateLimiter,
        getCors,
        getSecurityHeaders,
        getStrictSecurityHeaders,
        getCompression,
        getBasicAuth,
        getForwardAuth,
        getRetry,
        getCircuitBreaker,
        getStripPrefix,
        getAddPrefix,
        getReplacePath,
        getReplacePathRegex,
        getRedirectScheme,
        getRedirectRegex,
        getHttpsRedirect,
        getIPAllowList,
        getHeaders,
        getBuffering,
        getApiChain,
        getWebAppChain,
        getAdminChain,
    }
}

export class TraefikMiddlewareLibraryService extends Context.Service<
    TraefikMiddlewareLibraryService,
    TraefikMiddlewareLibraryShape
>()('shared/TraefikMiddlewareLibraryService') {
    static readonly live: TraefikMiddlewareLibraryShape =
        makeTraefikMiddlewareLibrary()
}
