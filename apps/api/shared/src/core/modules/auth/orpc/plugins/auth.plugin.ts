import { fromNodeHeaders } from 'better-auth/node'
import { Effect } from 'effect'

import { logger } from '@deployer/logger'

import { AuthUtils, type UserSession } from '../auth-utils'

import type { Auth } from '../../../../../auth'
import type { SessionResolverShape } from '../session-resolver'
import type { ORPCAuthContext } from '../types'
import type {
    StandardHandlerPlugin,
    StandardHandlerOptions,
} from '@orpc/server/standard'
import type { IncomingHttpHeaders } from 'http'

/**
 * Converts headers to web standard Headers.
 * Handles both Node.js IncomingHttpHeaders and web standard Headers.
 */
function toWebHeaders(
    headers:
        | Headers
        | IncomingHttpHeaders
        | Record<string, string | string[] | undefined>
): Headers {
    // If already a Headers object, return it directly
    if (headers instanceof Headers) {
        return headers
    }
    // Otherwise, convert from Node.js style headers
    return fromNodeHeaders(headers)
}

/**
 * Context type for the auth plugin
 * This will be merged into the ORPC context
 */
export type AuthPluginContext = {
    auth: ORPCAuthContext
    request: Request
}

/**
 * Options for creating the auth plugin
 */
export type AuthPluginOptions = {
    /** The Better Auth instance, for the utilities built on the session */
    auth: Auth
    /** Finds the request's session */
    sessions: SessionResolverShape
}

/**
 * Auth plugin for ORPC that automatically populates the auth context
 * with session data from Better Auth
 *
 * @example
 * ```ts
 * import { AuthPlugin } from './auth.plugin';
 *
 * ORPCModule.forRootAsync({
 *   useFactory: (request: Request, authCore: AuthCoreService) => {
 *     const authPlugin = new AuthPlugin({ auth: authService.instance as Auth });
 *     return {
 *       context: { request, auth: new AuthUtilsEmpty() },
 *       plugins: [authPlugin],
 *     };
 *   },
 *   inject: [REQUEST, AuthCoreService],
 * })
 * ```
 */
export class AuthPlugin<
    TContext extends AuthPluginContext,
> implements StandardHandlerPlugin<TContext> {
    readonly order = -100 // Run early to ensure auth context is available to other plugins/middlewares

    /** v2 `OrderablePlugin` requires a unique name for ordering/identification. */
    readonly name = 'auth'

    private readonly auth: Auth
    private readonly sessions: SessionResolverShape

    constructor(options: AuthPluginOptions) {
        this.auth = options.auth
        this.sessions = options.sessions
    }

    init(
        options: StandardHandlerOptions<TContext>
    ): StandardHandlerOptions<TContext> {
        const sessions = this.sessions

        // v2 contract: `init` RETURNS the transformed options (`OrderablePlugin`),
        // it does not mutate them in place. Appending keeps any interceptors that
        // previous plugins already registered.
        const routingInterceptors = options.routingInterceptors ?? []

        routingInterceptors.push(async (interceptorOptions) => {
            // eslint-disable-next-line @typescript-eslint/unbound-method
            const { context, request, next } = interceptorOptions

            // The session comes from the resolver (Better Auth does the check); a failed lookup means "no session".
            const webHeaders = toWebHeaders(request.headers)
            const sessionData: UserSession | null = await Effect.runPromise(
                sessions.resolve(webHeaders).pipe(
                    Effect.catch((error) =>
                        Effect.sync(() => {
                            logger.error(
                                'Auth Plugin: Error extracting session',
                                { error }
                            )
                            return null
                        })
                    )
                )
            )

            // Create auth utilities with session AND headers for plugin utilities
            const authUtils = new AuthUtils(sessionData)

            // Continue with enriched context
            return next({
                ...interceptorOptions,
                context: {
                    ...context,
                    auth: authUtils,
                },
            })
        })

        return { ...options, routingInterceptors }
    }
}
