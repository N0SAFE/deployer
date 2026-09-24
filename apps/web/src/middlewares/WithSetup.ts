import {
    NextFetchEvent,
    NextProxy,
    NextRequest,
    NextResponse,
} from 'next/server'
import { ConfigFactory, Matcher, MiddlewareFactory } from './utils/types'
import { nextjsRegexpPageOnly, nextNoApi } from './utils/static'
import { orpc } from '@/lib/orpc'
import { setupDestinationUrl } from '@/lib/setup-url'
import { createContextFilterDebugLogger } from '@/lib/logging/context-filter-debug'

const debugSetup = createContextFilterDebugLogger(
    'WithSetup',
    'middleware:[WithSetup]'
)

const SETUP_STATUS_TIMEOUT_MS = 3000

/**
 * The setup route itself (and anything under it).
 *
 * The gate must NOT redirect these: the web app serves its own `/setup`, so a
 * redirect here would send `/setup` to `/setup` and loop forever in the
 * browser. Only OTHER routes get bounced into onboarding.
 */
const setupRoutePattern = /^\/setup(\/.*)?$/

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => {
            globalThis.setTimeout(() => {
                reject(
                    new Error(
                        `Setup status check timed out after ${String(timeoutMs)}ms`
                    )
                )
            }, timeoutMs)
        }),
    ])
}

const withSetup: MiddlewareFactory = (next: NextProxy) => {
    return async (request: NextRequest, _next: NextFetchEvent) => {
        try {
            debugSetup('call setup state route')
            const state = await withTimeout(
                orpc.setup.getState.call(
                    {},
                    {
                        context: { cookie: request.cookies.toString() },
                    }
                ),
                SETUP_STATUS_TIMEOUT_MS
            )

            debugSetup('setup state', state)

            if (state.needsSetup) {
                // Already on the setup route — let it render. Without this the
                // gate redirects /setup to /setup and the browser loops.
                if (setupRoutePattern.test(request.nextUrl.pathname)) {
                    return await next(request, _next)
                }

                const redirectTo =
                    request.nextUrl.pathname + request.nextUrl.search
                // `setupDestinationUrl` returns a RELATIVE path (`/setup?...`)
                // because setup is a same-deployment destination. It is
                // resolved against the request's own origin here, which is the
                // origin the browser just reached — by definition reachable.
                //
                // NOTE: this must never be built from `API_URL`; that is the
                // private Docker address (`http://nextjs-nestjs-api-dev:3005`)
                // and putting it in a Location header is what produced
                // ERR_NAME_NOT_RESOLVED in the browser.
                const destination = new URL(
                    setupDestinationUrl({ redirectTo }),
                    request.url
                )
                debugSetup('Setup required, redirecting request', {
                    from: request.nextUrl.pathname,
                    to: destination.toString(),
                })
                return NextResponse.redirect(destination)
            }
        } catch (error) {
            debugSetup(
                'Failed/timed out checking setup status, skipping setup gate',
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                }
            )
        }

        return next(request, _next)
    }
}

export default withSetup

export const matcher: Matcher = [
    {
        and: [nextjsRegexpPageOnly, nextNoApi],
    },
]

export const config: ConfigFactory = {
    name: 'withSetup',
    matcher: true,
}
