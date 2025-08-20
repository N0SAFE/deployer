import {
    NextFetchEvent,
    NextMiddleware,
    NextRequest,
    NextResponse,
} from 'next/server'
import { ConfigFactory, Matcher, MiddlewareFactory } from './utils/types'
import { nextjsRegexpPageOnly, nextNoApi } from './utils/static'
import { $Infer } from '@/lib/auth'
import { matcherHandler } from './utils/utils'
import { envSchema, validateEnvSafe } from '#/env'
import { toAbsoluteUrl } from '@/lib/utils'
import { Authsignin } from '@/routes/index'
import { createDebug } from '@/lib/debug'

const debugAuth = createDebug('middleware/auth')
const debugAuthError = createDebug('middleware/auth/error')

const env = validateEnvSafe(process.env).data

const showcaseRegexpAndChildren = /^\/showcase(\/.*)?$/
const dashboardRegexpAndChildren = /^\/dashboard(\/.*)?$/

const withAuth: MiddlewareFactory = (next: NextMiddleware) => {
    if (!env) {
        debugAuthError('Environment variables are not valid')
        throw new Error('env is not valid')
    }
    return async (request: NextRequest, _next: NextFetchEvent) => {
        debugAuth(`Checking authentication for ${request.nextUrl.pathname}`, {
            path: request.nextUrl.pathname
        })

        // Get session using Better Auth with proper timeout
        let session: typeof $Infer.Session | null = null
        let sessionError: Error | unknown = null
        const startTime = Date.now()

        try {
            const apiUrl = envSchema.shape.API_URL.parse(process.env.API_URL)
            const sessionUrl = `${apiUrl}/api/auth/get-session`

            console.log(`Fetching session from: ${sessionUrl}`)

            debugAuth(`Making fetch request to ${sessionUrl}`)
            debugAuth(`Request headers - Cookie: ${request.headers.get('cookie') ? 'present' : 'missing'}`)
            
            const TIMEOUT_MS = 3000 // 3 second timeout
            
            // Use regular fetch with proper timeout handling
            const controller = new AbortController()
            const timeoutId = setTimeout(() => {
                debugAuth('Aborting request due to timeout')
                controller.abort()
            }, TIMEOUT_MS)
            
            const fetchResponse = await fetch(sessionUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Cookie': request.headers.get('cookie') || '',
                },
                signal: controller.signal,
            })
            
            clearTimeout(timeoutId)
            
            if (!fetchResponse.ok) {
                throw new Error(`HTTP ${fetchResponse.status}: ${fetchResponse.statusText}`)
            }
            
            const response = await fetchResponse.json()
                
            const duration = Date.now() - startTime
            debugAuth(`betterFetch completed in ${duration}ms`)
            debugAuth(`Response received:`, { hasResponse: !!response })
                
            // Check if the response has the expected structure
            if (response && typeof response === 'object' && 'data' in response) {
                session = response.data as typeof $Infer.Session
            } else if (response && typeof response === 'object' && 'user' in response && 'session' in response) {
                session = response as typeof $Infer.Session
            } else {
                debugAuth('Response does not have expected session structure:', { response })
            }
        } catch (error) {
            console.error('Error fetching session:', error)
            sessionError = error
            const duration = Date.now() - startTime
            debugAuthError('Error fetching session:', {
                error: error instanceof Error ? error.message : error,
                stack: error instanceof Error ? error.stack : undefined,
                internalUrl: `http://localhost:${process.env.NEXT_PUBLIC_APP_PORT || '3000'}`,
                duration: `${duration}ms`,
                hasRedirectLoop: error instanceof Error && error.message.includes('redirect'),
                hasTimeout: error instanceof Error && (error.message.includes('timeout') || error.message.includes('abort')),
                hasNetworkError: error instanceof Error && error.message.includes('fetch'),
                errorType: error instanceof Error ? error.constructor.name : typeof error,
            })
        }

        const isAuth = !!session

        debugAuth(`Session result - isAuth: ${isAuth}, hasError: ${!!sessionError}`, {
            path: request.nextUrl.pathname,
            isAuth,
            hasError: !!sessionError
        })

        if (isAuth) {
            const matcher = matcherHandler(request.nextUrl.pathname, [
                {
                    and: [showcaseRegexpAndChildren, '/me/customer'],
                },
                () => {
                    // in this route we can check if the user is authenticated with the customer role
                    // if (session?.user?.role === 'customer') {
                    //     return next(request, _next)
                    // }
                    // return NextResponse.redirect(
                    //     process.env.NEXT_PUBLIC_APP_URL!.replace(/\/$/, '') +
                    //         '/auth/login' +
                    //         '?' +
                    //         encodeURIComponent(
                    //             'callbackUrl=' +
                    //                 request.nextUrl.pathname +
                    //                 (request.nextUrl.search ?? '')
                    //         )
                    // )
                },
            ])
            if (matcher.hit) {
                return matcher.data // return the Response associated
            }
            return next(request, _next) // call the next middleware because the route is good
        } else {
            // User is not authenticated, redirect to login for protected routes
            debugAuth(`Redirecting unauthenticated user from ${request.nextUrl.pathname} to signin`)
            return NextResponse.redirect(
                toAbsoluteUrl(
                    Authsignin(
                        {},
                        {
                            callbackUrl:
                                request.nextUrl.pathname +
                                (request.nextUrl.search ?? ''),
                        }
                    )
                )
            )
        }
    }
}

export default withAuth

export const matcher: Matcher = [
    {
        and: [
            nextNoApi,
            nextjsRegexpPageOnly,
            {
                or: [
                    showcaseRegexpAndChildren,
                    dashboardRegexpAndChildren,
                    '/settings',
                    '/profile',
                ],
            },
        ],
    },
]

export const config: ConfigFactory = {
    name: 'withAuth',
    matcher: true,
}
