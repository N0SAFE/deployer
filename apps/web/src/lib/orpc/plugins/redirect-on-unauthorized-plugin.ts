import { AppLogger } from '@repo/logger'
import { StandardLinkOptions, StandardLinkPlugin } from '@orpc/client/standard'
import clientRedirect from '@/actions/redirect'
import { redirect, RedirectType, unstable_rethrow } from 'next/navigation'
import { AuthSignin } from '@/routes/index'

const pluginLogger = new AppLogger('web').scope('RedirectOnUnauthorized')

/**
 * Plugin that automatically redirects to login page on 401 Unauthorized errors
 *
 * Features:
 * - Server-side: Uses Next.js redirect()
 * - Client-side: Uses client-side navigation
 * - Respects noRedirectOnUnauthorized context flag
 * - Ignores AbortError (user cancelled requests)
 * - Logs redirect events for debugging
 *
 * @example
 * ```typescript
 * // Normal usage - will redirect on 401
 * await orpc.users.getProfile()
 *
 * // Disable redirect for manual error handling
 * await orpc.users.getProfile({}, {
 *   context: { noRedirectOnUnauthorized: true }
 * })
 * ```
 */
export class RedirectOnUnauthorizedPlugin<
    T extends {
        /**
         * If true, prevents automatic redirect on 401 errors
         * Useful for forms or components that want to handle auth errors themselves
         */
        noRedirectOnUnauthorized?: boolean
    },
> implements StandardLinkPlugin<T> {
    // Order controls plugin loading order (higher = loads earlier)
    order = 100

    init(link: StandardLinkOptions<T>): void {
        // Add error interceptor to handle 401 responses
        link.interceptors = link.interceptors ?? []

        link.interceptors.push(async (interceptorOptions) => {
            try {
                return await interceptorOptions.next(interceptorOptions)
            } catch (error) {
                // Ignore abort errors (user cancelled request)
                if (
                    (error as Error | undefined)?.name === 'AbortError' ||
                    (error &&
                        typeof error === 'object' &&
                        'code' in error &&
                        error.code === 'ABORT_ERR')
                ) {
                    throw error
                }

                // Check if redirect is disabled for this request
                if (interceptorOptions.context.noRedirectOnUnauthorized) {
                    throw error
                }

                // Check if this is a 401 Unauthorized error
                if (
                    error &&
                    typeof error === 'object' &&
                    'status' in error &&
                    error.status === 401
                ) {
                    pluginLogger.debug(
                        'ORPC Unauthorized - redirecting to login'
                    )
                    
                    console.log('ORPC Unauthorized - redirecting to login', {
                        error,
                        context: interceptorOptions.context,
                    })

                    // Client-side: build redirectTo from the real browser URL so
                    // the sign-in page can send the user back after login
                    if (typeof window !== 'undefined') {
                        const loginUrl = AuthSignin(
                            {},
                            {
                                redirectTo:
                                    window.location.pathname +
                                    window.location.search,
                            }
                        )
                        void clientRedirect(loginUrl)
                    } else {
                        // Server-side (Server Component / Server Action / Route
                        // Handler): recover the current URL from the request
                        // headers stamped by the WithHeaders middleware
                        // (x-pathname / x-search), so the sign-in page redirects
                        // the user back to the page they were on.
                        const redirectTo = await getServerRedirectTo()
                        const loginUrl = AuthSignin({}, { redirectTo })
                        redirect(loginUrl, RedirectType.replace)
                    }
                }

                // Re-throw the error if not handled
                throw error
            }
        })
    }
}

/**
 * Recovers the current request URL (pathname + search) inside a Server
 * Component / Server Action / Route Handler by reading the headers stamped
 * by the WithHeaders middleware.
 *
 * Falls back to `undefined` (sign-in without redirectTo) when the URL cannot
 * be determined — e.g. non-Next.js environments or requests that did not go
 * through the middleware.
 *
 * NOTE: mirrors the `cookie-headers-plugin` pattern of dynamically importing
 * `next/headers`, which keeps this shared (client + server) module safe to
 * bundle for the browser.
 */
async function getServerRedirectTo(): Promise<string | undefined> {
    try {
        const nh = await import('next/headers')
        const headersList = await nh.headers()
        const pathname = headersList.get('x-pathname')

        if (!pathname) {
            return undefined
        }

        return pathname + (headersList.get('x-search') ?? '')
    } catch (error) {
        // Re-throw Next.js internals (PPR bailout, static-gen bailout, redirects)
        // so they propagate correctly — catching them here would break builds.
        unstable_rethrow(error)

        return undefined
    }
}

/**
 * Factory function to create a RedirectOnUnauthorizedPlugin instance
 *
 * @example
 * ```typescript
 * const link = new OpenAPILink(appContract, {
 *   plugins: [
 *     createRedirectOnUnauthorizedPlugin(),
 *     // ... other plugins
 *   ]
 * })
 * ```
 */
export function createRedirectOnUnauthorizedPlugin() {
    return new RedirectOnUnauthorizedPlugin()
}

const redirectPluginDefault = {
    RedirectOnUnauthorizedPlugin,
}

export default redirectPluginDefault
