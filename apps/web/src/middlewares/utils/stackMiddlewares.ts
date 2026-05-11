// middlewares/stackMiddlewares
import { NextResponse } from 'next/server'
import { CustomNextMiddleware, MatcherType, Middleware } from './types'
import { matcherHandler } from './utils'
import { createContextFilterDebugLogger } from '@/lib/logging/context-filter-debug'

const debugMiddleware = createContextFilterDebugLogger('stackMiddlewares', 'middleware:[stackMiddlewares]')
const debugMiddlewareError = createContextFilterDebugLogger('stackMiddlewares', 'middleware:[stackMiddlewares]:error')

export function stackMiddlewares(
    functions: Middleware[] = [],
    config?: unknown,
    index = 0
): CustomNextMiddleware {
    const current = functions[index]
    if (current) {
        const next = stackMiddlewares(functions, config, index + 1)
        if (typeof current === 'function') {
            return async (req, _next) => {
                try {
                    debugMiddleware(`Executing function middleware at index ${String(index)}`, {
                        path: req.nextUrl.pathname,
                        index
                    })
                    return await current(next)(req, _next)
                } catch (error) {
                    debugMiddlewareError(`Function middleware at index ${String(index)} failed:`, {
                        error: error instanceof Error ? error.message : error,
                        stack: error instanceof Error ? error.stack : undefined,
                        path: req.nextUrl.pathname,
                        index
                    })
                    return new NextResponse('Internal Server Error', { status: 500 })
                }
            }
        }
        const { default: middleware, matcher, config: middlewareConfig } = current
        return async (req, _next) => {
            const middlewareName = middlewareConfig?.name ?? 'Unknown middleware'
            try {
                debugMiddleware(`Executing middleware: ${middlewareName}`, {
                    path: req.nextUrl.pathname,
                    index,
                    middlewareName,
                    hasMatcher: !!matcher
                })

                if (!matcher) {
                    const response = await middleware(next)(req, _next)
                    if (!response) {
                        debugMiddlewareError(`Middleware ${middlewareName} returned empty response without matcher; falling back to NextResponse.next()`, {
                            path: req.nextUrl.pathname,
                            middlewareName,
                            index
                        })
                        return NextResponse.next()
                    }
                    return response
                }

                if (Array.isArray(matcher)) {
                    const ctx = Array(matcher.length).fill({})
                    const matched = matcherHandler(
                        req.nextUrl.pathname,
                        matcher.map((m, i) => [m, () => i]) as [
                            matcher: MatcherType,
                            callback: () => number,
                        ][]
                    )
                    if (matched.hit) {
                        debugMiddleware(`Array matcher hit for ${middlewareName}`, {
                            path: req.nextUrl.pathname,
                            matchedIndex: matched.data
                        })
                        const response = await middleware(next)(req, _next, {
                            key: matched.data,
                            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                            ctx: ctx[matched.data],
                        })
                        if (!response) {
                            debugMiddlewareError(`Middleware ${middlewareName} returned empty response on array matcher hit; falling back to next middleware`, {
                                path: req.nextUrl.pathname,
                                middlewareName,
                                index,
                                matchedIndex: matched.data
                            })
                            return await next(req, _next)
                        }
                        return response
                    }
                } else if (typeof matcher === 'object') {
                    const ctx = Object.keys(matcher).reduce(
                        (acc, key) => ({ ...acc, [key]: {} }),
                        {}
                    ) as typeof matcher
                    const matched = matcherHandler(
                        req.nextUrl.pathname,
                        Object.keys(matcher).map((m) => [matcher[m], () => m]) as [
                            matcher: MatcherType,
                            callback: () => string,
                        ][]
                    )
                    if (matched.hit) {
                        debugMiddleware(`Object matcher hit for ${middlewareName}`, {
                            path: req.nextUrl.pathname,
                            matchedKey: matched.data
                        })
                        const response = await middleware(next)(req, _next, {
                            key: matched.data,
                            ctx: ctx[matched.data],
                        })
                        if (!response) {
                            debugMiddlewareError(`Middleware ${middlewareName} returned empty response on object matcher hit; falling back to next middleware`, {
                                path: req.nextUrl.pathname,
                                middlewareName,
                                index,
                                matchedKey: matched.data
                            })
                            return await next(req, _next)
                        }
                        return response
                    }
                }
                debugMiddleware(`No matcher hit for ${middlewareName}, proceeding to next`, {
                    path: req.nextUrl.pathname
                })
                return await next(req, _next)
            } catch (error) {
                debugMiddlewareError(`${middlewareName} at index ${String(index)} failed:`, {
                    error: error instanceof Error ? error.message : error,
                    stack: error instanceof Error ? error.stack : 'No stack trace available',
                    path: req.nextUrl.pathname,
                    middlewareName,
                    index
                })
                return new NextResponse('Internal Server Error', { status: 500 })
            }
        }
    }
    return () => {
        debugMiddleware('All middleware executed, returning NextResponse.next()')
        return NextResponse.next()
    }
}
