import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextFetchEvent, NextRequest, NextResponse } from 'next/server'

describe('WithHeaders Middleware', () => {
    const mockCreateContextFilterDebugLogger = vi.fn(() => vi.fn())

    beforeEach(() => {
        vi.clearAllMocks()

        vi.doMock('@/lib/logging/context-filter-debug', () => ({
            createContextFilterDebugLogger: mockCreateContextFilterDebugLogger,
        }))
    })

    const createMockRequest = (url: string) => new NextRequest(url)

    it('stamps x-pathname on the response and forwards URL headers to server components', async () => {
        const { withHeaders } = await import('../WithHeaders')

        const inner = vi.fn(async () => NextResponse.next())
        const middleware = withHeaders(inner)

        const request = createMockRequest('http://localhost:3003/dashboard?tab=2')
        const result = await middleware(request, {} as NextFetchEvent)

        if (!result) throw new Error('expected a middleware response')
        expect(result).toBeInstanceOf(NextResponse)

        // Response header (existing behavior)
        expect(result.headers.get('x-pathname')).toBe('/dashboard')
        // Middleware continuation marker preserved
        expect(result.headers.get('x-middleware-next')).toBe('1')
        // Request headers forwarded so Server Components can read them via headers()
        expect(result.headers.get('x-middleware-request-x-pathname')).toBe('/dashboard')
        expect(result.headers.get('x-middleware-request-x-search')).toBe('?tab=2')
        const overridden = result.headers.get('x-middleware-override-headers') ?? ''
        expect(overridden.split(',')).toContain('x-pathname')
        expect(overridden.split(',')).toContain('x-search')

        expect(inner).toHaveBeenCalledWith(request, {})
    })

    it('preserves pass-through responses without a query string', async () => {
        const { withHeaders } = await import('../WithHeaders')

        const inner = vi.fn(async () => NextResponse.next())
        const middleware = withHeaders(inner)

        const request = createMockRequest('http://localhost:3003/settings')
        const result = await middleware(request, {} as NextFetchEvent)

        if (!result) throw new Error('expected a middleware response')
        expect(result.headers.get('x-middleware-request-x-pathname')).toBe('/settings')
        expect(result.headers.get('x-middleware-request-x-search')).toBe('')
        expect(result.headers.get('x-pathname')).toBe('/settings')
    })

    it('keeps redirect responses untouched (no request-header forwarding)', async () => {
        const { withHeaders } = await import('../WithHeaders')

        const inner = vi.fn(async () =>
            NextResponse.redirect('http://localhost:3003/auth/signin?redirectTo=%2Fdashboard'),
        )
        const middleware = withHeaders(inner)

        const request = createMockRequest('http://localhost:3003/dashboard')
        const result = await middleware(request, {} as NextFetchEvent)

        if (!result) throw new Error('expected a middleware response')
        expect(result.status).toBe(307)
        expect(result.headers.get('location')).toBe(
            'http://localhost:3003/auth/signin?redirectTo=%2Fdashboard',
        )
        // Response header is still decorated on redirects (existing behavior)
        expect(result.headers.get('x-pathname')).toBe('/dashboard')
        // But no request override is applied — nothing renders after a redirect
        expect(result.headers.get('x-middleware-request-x-pathname')).toBeNull()
        expect(result.headers.get('x-middleware-override-headers')).toBeNull()
    })

    it('preserves response headers set by inner middlewares when forwarding', async () => {
        const { withHeaders } = await import('../WithHeaders')

        const innerRes = NextResponse.next()
        innerRes.headers.set('x-custom-from-inner', 'yes')
        const inner = vi.fn(async () => innerRes)
        const middleware = withHeaders(inner)

        const request = createMockRequest('http://localhost:3003/settings')
        const result = await middleware(request, {} as NextFetchEvent)

        if (!result) throw new Error('expected a middleware response')
        expect(result.headers.get('x-custom-from-inner')).toBe('yes')
        // Fresh request forwarding is still present
        expect(result.headers.get('x-middleware-request-x-pathname')).toBe('/settings')
    })
})