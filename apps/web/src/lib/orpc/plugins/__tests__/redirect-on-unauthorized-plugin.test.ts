import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// --- Mocks (all `mock*`-prefixed so vi.mock factories can reference them) ---

const mockClientRedirect = vi.fn()
const mockRedirect = vi.fn()
const mockUnstableRethrow = vi.fn((error: unknown) => {
    // Mimic Next.js: internal errors (redirects / not-found / static-gen
    // bailout) must propagate, everything else falls through.
    if (
        error &&
        typeof error === 'object' &&
        'digest' in error &&
        typeof error.digest === 'string' &&
        (error.digest.startsWith('NEXT_REDIRECT') ||
            error.digest.startsWith('NEXT_NOT_FOUND'))
    ) {
        throw error
    }
})
const mockHeaders = vi.fn()
const mockAuthSignin = vi.fn(
    (_params: unknown, search?: { redirectTo?: string }) => {
        const base = '/auth/signin'
        if (!search?.redirectTo) return base
        return `${base}?redirectTo=${encodeURIComponent(search.redirectTo)}`
    },
)

vi.mock('@/actions/redirect', () => ({
    default: mockClientRedirect,
}))
vi.mock('next/navigation', () => ({
    redirect: mockRedirect,
    RedirectType: { replace: 'replace', push: 'push' },
    unstable_rethrow: mockUnstableRethrow,
}))
vi.mock('next/headers', () => ({
    headers: mockHeaders,
}))
vi.mock('@/routes/index', () => ({
    AuthSignin: mockAuthSignin,
}))

// --- Test helpers ---

type InterceptorOptions = {
    next: (options: unknown) => Promise<unknown>
    context: { noRedirectOnUnauthorized?: boolean }
}

function unauthorizedError(status = 401): Error & { status: number } {
    const error = new Error('Unauthorized') as Error & { status: number }
    error.status = status
    return error
}

async function getInterceptor(): Promise<(options: InterceptorOptions) => Promise<unknown>> {
    const { RedirectOnUnauthorizedPlugin } = await import(
        '../redirect-on-unauthorized-plugin'
    )
    const plugin = new RedirectOnUnauthorizedPlugin()
    const link = {
        interceptors: [] as Array<(options: InterceptorOptions) => Promise<unknown>>,
    }
    // @ts-expect-error test-only: minimal stand-in for StandardLinkOptions
    plugin.init(link)
    const interceptor = link.interceptors[0]
    if (!interceptor) throw new Error('expected the interceptor to be registered')
    return interceptor
}

const makeOptions = (
    overrides: Partial<InterceptorOptions> = {},
): InterceptorOptions => ({
    next: async () => {
        throw unauthorizedError()
    },
    context: {},
    ...overrides,
})

// --- Tests ---

describe('RedirectOnUnauthorizedPlugin', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('server-side: redirects to sign-in with redirectTo recovered from request headers', async () => {
        // Simulate a Node/Server Component environment (no `window`)
        vi.stubGlobal('window', undefined)

        mockHeaders.mockResolvedValue({
            get: (key: string) => {
                if (key === 'x-pathname') return '/dashboard'
                if (key === 'x-search') return '?tab=2'
                return null
            },
        })

        const interceptor = await getInterceptor()
        const error = unauthorizedError()

        await expect(interceptor(makeOptions({ next: async () => { throw error } }))).rejects.toBe(error)

        expect(mockHeaders).toHaveBeenCalled()
        expect(mockRedirect).toHaveBeenCalledWith(
            '/auth/signin?redirectTo=%2Fdashboard%3Ftab%3D2',
            'replace',
        )
        expect(mockClientRedirect).not.toHaveBeenCalled()
    })

    it('server-side: falls back to plain sign-in URL when headers are unavailable', async () => {
        vi.stubGlobal('window', undefined)

        mockHeaders.mockResolvedValue({
            get: () => null,
        })

        const interceptor = await getInterceptor()
        const error = unauthorizedError()

        await expect(interceptor(makeOptions({ next: async () => { throw error } }))).rejects.toBe(error)

        expect(mockRedirect).toHaveBeenCalledWith('/auth/signin', 'replace')
        expect(mockAuthSignin).toHaveBeenCalledWith({}, { redirectTo: undefined })
    })

    it('server-side: falls back to plain sign-in URL when headers() throws a non-internal error', async () => {
        vi.stubGlobal('window', undefined)

        mockHeaders.mockRejectedValue(new Error('headers called outside request scope'))

        const interceptor = await getInterceptor()
        const error = unauthorizedError()

        await expect(interceptor(makeOptions({ next: async () => { throw error } }))).rejects.toBe(error)

        expect(mockRedirect).toHaveBeenCalledWith('/auth/signin', 'replace')
    })

    it('client-side: uses window.location to build redirectTo', async () => {
        vi.stubGlobal('window', {
            location: { pathname: '/dashboard', search: '?tab=2' },
        })

        const interceptor = await getInterceptor()
        const error = unauthorizedError()

        await expect(interceptor(makeOptions({ next: async () => { throw error } }))).rejects.toBe(error)

        expect(mockClientRedirect).toHaveBeenCalledWith(
            '/auth/signin?redirectTo=%2Fdashboard%3Ftab%3D2',
        )
        expect(mockRedirect).not.toHaveBeenCalled()
        expect(mockHeaders).not.toHaveBeenCalled()
    })

    it('respects noRedirectOnUnauthorized and re-throws the error', async () => {
        vi.stubGlobal('window', undefined)

        const interceptor = await getInterceptor()
        const error = unauthorizedError()

        await expect(
            interceptor(
                makeOptions({
                    context: { noRedirectOnUnauthorized: true },
                    next: async () => { throw error },
                }),
            ),
        ).rejects.toBe(error)

        expect(mockRedirect).not.toHaveBeenCalled()
        expect(mockClientRedirect).not.toHaveBeenCalled()
    })

    it('ignores AbortError and re-throws it without redirecting', async () => {
        vi.stubGlobal('window', undefined)

        const interceptor = await getInterceptor()
        const abortError = new DOMException('The operation was aborted.', 'AbortError')

        await expect(
            interceptor(makeOptions({ next: async () => { throw abortError } })),
        ).rejects.toBe(abortError)

        expect(mockRedirect).not.toHaveBeenCalled()
        expect(mockClientRedirect).not.toHaveBeenCalled()
    })
})