import '@testing-library/jest-dom'
import { beforeEach, vi } from 'vitest'
import React from 'react'

// Setup for Next.js components testing
beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks()
})

// Mock Next.js router
vi.mock('next/router', () => ({
    useRouter() {
        return {
            route: '/',
            pathname: '/',
            query: {},
            asPath: '/',
            push: vi.fn(),
            pop: vi.fn(),
            reload: vi.fn(),
            back: vi.fn(),
            prefetch: vi.fn(),
            beforePopState: vi.fn(),
            events: {
                on: vi.fn(),
                off: vi.fn(),
                emit: vi.fn(),
            },
            isFallback: false,
        }
    },
}))

// Mock Next.js navigation
vi.mock('next/navigation', () => ({
    useRouter() {
        return {
            push: vi.fn(),
            replace: vi.fn(),
            prefetch: vi.fn(),
            back: vi.fn(),
            forward: vi.fn(),
            refresh: vi.fn(),
        }
    },
    useSearchParams() {
        return new URLSearchParams()
    },
    usePathname() {
        return '/'
    },
}))

// Mock Next.js Image component
vi.mock('next/image', () => ({
    default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => {
        return React.createElement('img', props)
    },
}))

// Mock Next.js Link component
vi.mock('next/link', () => ({
    default: ({ children, ...props }: { children: React.ReactNode } & Record<string, unknown>) => {
        return React.createElement('a', props, children)
    },
}))

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(), // deprecated
        removeListener: vi.fn(), // deprecated
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })),
})

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
}))

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
}))

// Mock environment variables using vi.stubEnv
vi.stubEnv('NODE_ENV', 'test')
vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:3001')

// Mock the #/env module (generated at runtime)
vi.mock('#/env', () => ({
    envSchema: {
        parse: vi.fn().mockReturnValue({
            NODE_ENV: 'test',
            NEXT_PUBLIC_API_URL: 'http://localhost:3001',
            NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
            API_URL: 'http://localhost:3001',
            NEXT_PUBLIC_DEBUG: { patterns: [], enableAll: false },
        }),
        safeParse: vi.fn().mockReturnValue({
            success: true,
            data: {
                NODE_ENV: 'test',
                NEXT_PUBLIC_API_URL: 'http://localhost:3001',
                NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
                API_URL: 'http://localhost:3001',
                NEXT_PUBLIC_DEBUG: { patterns: [], enableAll: false },
            },
        }),
        shape: {
            NODE_ENV: {
                parse: vi.fn().mockReturnValue('test'),
            },
            NEXT_PUBLIC_API_URL: {
                parse: vi.fn().mockReturnValue('http://localhost:3001'),
            },
            NEXT_PUBLIC_APP_URL: {
                parse: vi.fn().mockReturnValue('http://localhost:3000'),
            },
            API_URL: {
                parse: vi.fn().mockReturnValue('http://localhost:3001'),
            },
            NEXT_PUBLIC_DEBUG: {
                parse: vi.fn().mockReturnValue({ patterns: [], enableAll: false }),
            },
        },
    },
    validateEnvSafe: vi.fn().mockReturnValue({
        success: true,
        data: {
            NODE_ENV: 'test',
            NEXT_PUBLIC_API_URL: 'http://localhost:3001',
            NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
            API_URL: 'http://localhost:3001',
            NEXT_PUBLIC_DEBUG: { patterns: [], enableAll: false },
        },
    }),
    envIsValid: vi.fn().mockReturnValue(true),
    validateEnv: vi.fn().mockReturnValue({
        NODE_ENV: 'test',
        NEXT_PUBLIC_API_URL: 'http://localhost:3001',
        NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
        API_URL: 'http://localhost:3001',
        NEXT_PUBLIC_DEBUG: { patterns: [], enableAll: false },
    }),
    validateEnvPath: vi.fn().mockImplementation((input, path) => {
        const mockEnv: Record<string, string> = {
            NODE_ENV: 'test',
            NEXT_PUBLIC_API_URL: 'http://localhost:3001',
            NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
            API_URL: 'http://localhost:3001',
            NEXT_PUBLIC_DEBUG: '{ patterns: [], enableAll: false }',
        }
        return mockEnv[path] || input
    }),
}))

// Mock the @/routes module (declarative routes generated at runtime)
vi.mock('@/routes', () => ({
    Middlewareerrorenv: vi.fn().mockReturnValue('/middleware/error/env'),
    Authsignin: vi.fn().mockReturnValue('/auth/signin'),
    Dashboard: vi.fn().mockReturnValue('/dashboard'),
    DashboardProjects: vi.fn().mockReturnValue('/dashboard/projects'),
    DashboardProjectsId: vi.fn().mockReturnValue('/dashboard/projects/:id'),
    Home: vi.fn().mockReturnValue('/'),
    // Add more route mocks as needed
}))

// Mock @/routes/index for specific imports
vi.mock('@/routes/index', () => ({
    Middlewareerrorenv: vi.fn().mockReturnValue('/middleware/error/env'),
    Authsignin: vi.fn().mockReturnValue('/auth/signin'),
    Dashboard: vi.fn().mockReturnValue('/dashboard'),
    DashboardProjects: vi.fn().mockReturnValue('/dashboard/projects'),
    DashboardProjectsId: vi.fn().mockReturnValue('/dashboard/projects/:id'),
    Home: vi.fn().mockReturnValue('/'),
    // Add more route mocks as needed
}))

// Mock @/routes/hooks for route hooks
vi.mock('@/routes/hooks', () => ({
    useSearchParams: vi.fn().mockReturnValue(new URLSearchParams()),
    usePush: vi.fn().mockReturnValue(vi.fn()),
    useParams: vi.fn().mockReturnValue({}),
}))
