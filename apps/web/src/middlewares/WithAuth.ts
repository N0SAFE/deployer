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
import { validateEnvSafe } from '#/env'
import { toAbsoluteUrl } from '@/lib/utils'
import { Authsignin } from '@/routes/index'
import { createDebug } from '@/lib/debug'
import { getServerSession } from '@/lib/auth/actions'

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

        // Get session using Better Auth directly
        let session: typeof $Infer.Session | null = null
        let sessionError: Error | unknown = null
        const startTime = Date.now()

        try {
            debugAuth('Getting session using Better Auth')
            
            // Use the existing getServerSession helper that properly handles Better Auth
            const sessionResult = await getServerSession(request.headers)
            
            const duration = Date.now() - startTime
            debugAuth(`Better Auth session retrieval completed in ${duration}ms`)
            
            // Better Auth returns a result object that needs to be checked
            if (sessionResult && typeof sessionResult === 'object') {
                // Check if it's an error response
                if ('error' in sessionResult && sessionResult.error) {
                    throw new Error(`Better Auth error: ${sessionResult.error}`)
                }
                
                // Check if it has session data
                if ('data' in sessionResult && sessionResult.data) {
                    session = sessionResult.data as typeof $Infer.Session
                } else if ('user' in sessionResult && 'session' in sessionResult) {
                    // Direct session object
                    session = sessionResult as typeof $Infer.Session
                }
            }
            
            debugAuth('Session processed:', {
                hasSession: !!session,
                hasUser: !!(session?.user)
            })
            
        } catch (error) {
            console.error('Error getting session from Better Auth:', error)
            sessionError = error
            const duration = Date.now() - startTime
            debugAuthError('Error getting session from Better Auth:', {
                error: error instanceof Error ? error.message : error,
                stack: error instanceof Error ? error.stack : undefined,
                duration: `${duration}ms`,
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
