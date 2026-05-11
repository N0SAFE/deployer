import {
    NextFetchEvent,
    NextProxy,
    NextRequest,
    NextResponse,
} from 'next/server'
import { Matcher, MiddlewareFactory } from './utils/types'
import { validateEnvPath } from '#/env'
import { nextjsRegexpPageOnly, nextNoApi } from './utils/static'
import { orpc } from '@/lib/orpc'
import { toAbsoluteUrl } from '@/lib/utils'
import { InternalMiddlewareErrorHealthCheck } from '@/routes'
import { createContextFilterDebugLogger } from '@/lib/logging/context-filter-debug'

const debugHealthCheck = createContextFilterDebugLogger('WithHealthCheck', 'middleware:[WithHealthCheck]')
const debugHealthCheckError = createContextFilterDebugLogger('WithHealthCheck', 'middleware:[WithHealthCheck]:error')

const NODE_ENV = validateEnvPath(process.env.NODE_ENV, 'NODE_ENV')
const errorPageRenderingPath = '/middleware/error/healthCheck'
const HEALTH_CHECK_TIMEOUT_MS = 3000

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => {
            globalThis.setTimeout(() => {
                reject(new Error(`Health check timed out after ${String(timeoutMs)}ms`))
            }, timeoutMs)
        }),
    ])
}

const withHealthCheck: MiddlewareFactory = (next: NextProxy) => {
    return async (request: NextRequest, _next: NextFetchEvent) => {
        debugHealthCheck('Health check middleware initiated', {
            path: request.nextUrl.pathname,
            environment: NODE_ENV,
        })

        if (NODE_ENV === 'development') {
            try {
                debugHealthCheck(
                    'Checking API health via ORPC in development mode'
                )
                try {
                    const data = await withTimeout(
                        orpc.health.check.call(
                            {},
                            {
                                context: { cookie: request.cookies.toString() },
                            }
                        ),
                        HEALTH_CHECK_TIMEOUT_MS
                    )
                    debugHealthCheck('Health check response received', { data })

                    if (!(data.status === 'ok')) {
                        if (
                            request.nextUrl.pathname === errorPageRenderingPath
                        ) {
                            debugHealthCheck(
                                'Already on error page, proceeding'
                            )
                            return NextResponse.next()
                        } else {
                            const errorUrl = toAbsoluteUrl(
                                InternalMiddlewareErrorHealthCheck(
                                    {},
                                    {
                                        json: JSON.stringify(data),
                                        from: request.url,
                                    }
                                )
                            )
                            debugHealthCheckError(
                                'API health check failed, redirecting to error page',
                                {
                                    from: request.url,
                                    to: errorUrl,
                                    healthData: data,
                                }
                            )
                            return NextResponse.redirect(errorUrl)
                        }
                    }
                } catch (e: unknown) {
                    const errorData = {
                        status: 'error',
                        message: (e as Error).message || 'Unknown error',
                        timestamp: new Date().toISOString(),
                    }
                    debugHealthCheckError('Health check error caught', {
                        error: e,
                        errorData,
                    })

                    // Fail open in development to avoid freezing all client navigations
                    // when API health endpoint is slow/unavailable.
                    if (request.nextUrl.pathname !== errorPageRenderingPath) {
                        debugHealthCheck(
                            'Fail-open: continuing request despite health check error to prevent navigation stall'
                        )
                        return await next(request, _next)
                    }

                    if (request.nextUrl.pathname === errorPageRenderingPath) {
                        debugHealthCheck('Already on error page, proceeding')
                        return NextResponse.next()
                    } else {
                        const errorUrl = toAbsoluteUrl(
                            InternalMiddlewareErrorHealthCheck(
                                {},
                                {
                                    json: JSON.stringify(errorData),
                                    from: request.url,
                                }
                            )
                        )
                        debugHealthCheckError(
                            'Redirecting to error page due to health check exception',
                            {
                                from: request.url,
                                to: errorUrl,
                            }
                        )
                        return NextResponse.redirect(errorUrl)
                    }
                }
            } catch {
                debugHealthCheckError(
                    'Unexpected error in health check middleware'
                )
                if (request.nextUrl.pathname === errorPageRenderingPath) {
                    debugHealthCheck('Already on error page, proceeding')
                    return NextResponse.next()
                } else {
                    const errorUrl = toAbsoluteUrl(
                        InternalMiddlewareErrorHealthCheck(
                            {},
                            {
                                from: request.url,
                            }
                        )
                    )
                    debugHealthCheckError(
                        'Redirecting to error page due to unexpected error',
                        {
                            from: request.url,
                            to: errorUrl,
                        }
                    )
                    return NextResponse.redirect(errorUrl)
                }
            }
        }

        if (request.nextUrl.pathname === errorPageRenderingPath) {
            const redirectUrl =
                request.nextUrl.searchParams.get('from') ??
                request.nextUrl.origin + '/'
            debugHealthCheck(
                'Redirecting from health check error page to origin',
                {
                    from: errorPageRenderingPath,
                    to: redirectUrl,
                }
            )
            return NextResponse.redirect(redirectUrl)
        }

        debugHealthCheck('Health check passed, proceeding to next middleware')
        return await next(request, _next)
    }
}

export default withHealthCheck

export const matcher: Matcher = [
    {
        and: [nextjsRegexpPageOnly, nextNoApi],
    },
]
