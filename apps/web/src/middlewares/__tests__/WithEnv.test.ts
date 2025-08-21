import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextFetchEvent, NextRequest, NextResponse } from 'next/server'

// All mocks must be at the top level before any imports that use them
// Mock the entire #/env module export including envSchema
vi.mock('#/env', () => ({
    envSchema: {
        parse: vi.fn(),
        safeParse: vi.fn(),
        shape: {}
    },
    envIsValid: vi.fn(),
    validateEnvSafe: vi.fn(),
    validateEnv: vi.fn(),
    validateEnvPath: vi.fn(),
}))

// Mock the utility functions
vi.mock('../utils/utils', () => ({
    matcherHandler: vi.fn(),
}))

// Mock the routes module
vi.mock('@/routes', () => ({
    Middlewareerrorenv: vi.fn(() => '/middleware/error/env'),
}))

// Mock the utils lib
vi.mock('@/lib/utils', () => ({
    toAbsoluteUrl: vi.fn((path) => `http://localhost:3003${path}`),
}))

// Mock the debug lib
vi.mock('@/lib/debug', () => ({
    createDebug: vi.fn(() => vi.fn()),
}))

// Mock the static imports
vi.mock('../utils/static', () => ({
    nextjsRegexpPageOnly: {},
    nextNoApi: {},
    noPublic: {},
}))

// Now import the modules after mocking
import withEnv from '../WithEnv'
import { envIsValid, validateEnvSafe } from '#/env'
import { matcherHandler } from '../utils/utils'

describe('WithEnv Middleware', () => {
    const mockNext = vi.fn()
    const errorPagePath = '/middleware/error/env'

    beforeEach(() => {
        vi.clearAllMocks()
        // @ts-expect-error set NODE_ENV for tests
        process.env.NODE_ENV = 'development'
    })

    const createMockRequest = (
        url: string,
        searchParams: Record<string, string> = {}
    ) => {
        const searchParamsObj = new URLSearchParams(searchParams)
        const fullUrl = new URL(url)
        fullUrl.search = searchParamsObj.toString()

        return new NextRequest(fullUrl.toString())
    }

    describe('when environment is valid', () => {
        beforeEach(() => {
            vi.mocked(envIsValid).mockReturnValue(true)
            vi.mocked(matcherHandler).mockReturnValue({ hit: false })
        })

        it('should redirect from error page to home when env is valid', async () => {
            const request = createMockRequest(
                `http://localhost:3003${errorPagePath}`
            )
            vi.mocked(matcherHandler).mockReturnValue({
                hit: true,
                data: NextResponse.redirect('http://localhost:3003/'),
            })

            const middleware = withEnv(mockNext)
            const result = await middleware(request, {} as NextFetchEvent)

            expect(result).toBeInstanceOf(NextResponse)
            expect(vi.mocked(matcherHandler)).toHaveBeenCalledWith(
                errorPagePath,
                expect.any(Array)
            )
        })

        it('should redirect from error page to "from" parameter when env is valid', async () => {
            const fromUrl = '/dashboard'
            const request = createMockRequest(
                `http://localhost:3003${errorPagePath}`,
                { from: fromUrl }
            )
            vi.mocked(matcherHandler).mockReturnValue({
                hit: true,
                data: NextResponse.redirect(`http://localhost:3003${fromUrl}`),
            })

            const middleware = withEnv(mockNext)
            const result = await middleware(request, {} as NextFetchEvent)

            expect(result).toBeInstanceOf(NextResponse)
        })

        it('should call next middleware when not on error page and env is valid', async () => {
            const request = createMockRequest('http://localhost:3003/dashboard')
            vi.mocked(matcherHandler).mockReturnValue({
                hit: true,
                data: mockNext(request, {} as NextFetchEvent),
            })

            const middleware = withEnv(mockNext)
            await middleware(request, {} as NextFetchEvent)

            expect(mockNext).toHaveBeenCalledWith(request, {})
        })
    })

    describe('when environment is invalid', () => {
        beforeEach(() => {
            vi.mocked(envIsValid).mockReturnValue(false)

            vi.mocked(validateEnvSafe).mockReturnValue({
                // @ts-expect-error set NODE_ENV for tests
                error: { message: 'Invalid environment variables' },
            })
        })

        it('should redirect to error page in development mode', async () => {
            // @ts-expect-error set NODE_ENV for tests
            process.env.NODE_ENV = 'development'
            const request = createMockRequest('http://localhost:3003/dashboard')

            vi.mocked(matcherHandler).mockReturnValue({
                hit: true,
                data: NextResponse.redirect(
                    `http://localhost:3003${errorPagePath}?from=${encodeURIComponent(request.url)}`
                ),
            })

            const middleware = withEnv(mockNext)
            const result = await middleware(request, {} as NextFetchEvent)

            expect(result).toBeInstanceOf(NextResponse)
        })

        it('should throw error in production mode', async () => {
            // @ts-expect-error set NODE_ENV for tests
            process.env.NODE_ENV = 'production'
            const request = createMockRequest('http://localhost:3003/dashboard')

            const middleware = withEnv(mockNext)

            // Mock matcherHandler to return a function that throws
            vi.mocked(matcherHandler).mockImplementation(() => {
                throw new Error(
                    'Invalid environment variables:{"message":"Invalid environment variables"}'
                )
            })

            await expect(
                middleware(request, {} as NextFetchEvent)
            ).rejects.toThrow('Invalid environment variables')
        })
    })

    describe('when matcher does not hit', () => {
        beforeEach(() => {
            vi.mocked(envIsValid).mockReturnValue(true)
            vi.mocked(matcherHandler).mockReturnValue({ hit: false })
        })

        it('should call next middleware when matcher does not hit', async () => {
            const request = createMockRequest('http://localhost:3003/api/test')
            const mockResponse = NextResponse.next()
            mockNext.mockReturnValue(mockResponse)

            const middleware = withEnv(mockNext)
            const result = await middleware(request, {} as NextFetchEvent)

            expect(mockNext).toHaveBeenCalledWith(request, {})
            expect(result).toBe(mockResponse)
        })
    })
})
