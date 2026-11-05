import { describe, it, expect, beforeEach, vi } from 'vitest'

import { AuthUtils, AuthUtilsEmpty } from './auth-utils'
import { requireAuth, publicAccess } from './middlewares'

import type { MiddlewareDone, MiddlewareOptions } from '@orpc/server'

/**
 * Helper to create middleware options with proper ORPC signature
 */
function createMiddlewareOptions(
    context: any,
    nextFn: any
): MiddlewareOptions<any, any, any> {
    return {
        context,
        path: [],
        procedure: {} as any,
        signal: undefined,
        lastEventId: undefined,
        next: nextFn,
        errors: {},
    }
}

/**
 * Helper to create the short-circuit callback.
 *
 * oRPC v2 REMOVED the `MiddlewareOutputFn` type and replaced the third
 * middleware argument with `MiddlewareDone`: a CALLABLE INTERFACE
 * (`done({ output })`) that returns a `MiddlewareResult`, rather than a plain
 * function taking the output value.
 *
 * The mock returns the same `{ output }` result the middleware chain expects,
 * typed through `MiddlewareDone` so it is accepted where the middleware
 * signature requires it.
 */
function createOutputFn(): MiddlewareDone<unknown> {
    return vi.fn((options: { output: unknown }) => ({
        output: options.output,
        context: {},
    })) as unknown as MiddlewareDone<unknown>
}

describe('ORPC Auth Middlewares', () => {
    let mockSession: any
    let mockContext: any

    beforeEach(() => {
        mockSession = {
            session: {
                id: 'session-123',
                userId: 'user-123',
                expiresAt: new Date('2025-12-31'),
                token: 'token-123',
                ipAddress: '127.0.0.1',
                userAgent: 'test-agent',
                createdAt: new Date('2024-01-01'),
                updatedAt: new Date('2024-01-01'),
            },
            user: {
                id: 'user-123',
                email: 'test@example.com',
                name: 'Test User',
                role: 'admin',
                emailVerified: true,
                image: null,
                createdAt: new Date('2024-01-01'),
                updatedAt: new Date('2024-01-01'),
                banned: false,
            },
        }

        mockContext = {
            request: {} as Request,
            auth: new AuthUtils(mockSession),
        }
    })

    describe('requireAuth', () => {
        it('should return ORPC middleware function', () => {
            const middleware = requireAuth()

            expect(middleware).toBeDefined()
            expect(typeof middleware).toBe('function')
        })
    })

    describe('publicAccess', () => {
        it('should always pass for authenticated users', async () => {
            const middleware = publicAccess()
            const nextFn = vi
                .fn()
                .mockImplementation(() =>
                    Promise.resolve({ output: 'success', context: {} })
                )

            const options = createMiddlewareOptions(mockContext, nextFn)
            await middleware(options, {}, createOutputFn())

            expect(nextFn).toHaveBeenCalled()
        })

        it('should always pass for unauthenticated users', async () => {
            const unauthContext = {
                ...mockContext,
                auth: new AuthUtilsEmpty(),
            }
            const middleware = publicAccess()
            const nextFn = vi
                .fn()
                .mockImplementation(() =>
                    Promise.resolve({ output: 'success', context: {} })
                )

            const options = createMiddlewareOptions(unauthContext, nextFn)
            await middleware(options, {}, createOutputFn())

            expect(nextFn).toHaveBeenCalled()
        })

        it('should do nothing and just pass through', async () => {
            const middleware = publicAccess()
            const nextFn = vi
                .fn()
                .mockImplementation(() =>
                    Promise.resolve({ output: 'test-output', context: {} })
                )

            const options = createMiddlewareOptions(mockContext, nextFn)
            await middleware(options, { test: 'data' }, createOutputFn())

            expect(nextFn).toHaveBeenCalled()
        })
    })
})
