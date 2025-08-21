// Mock for @/routes module - used when routes are not generated
import { vi } from 'vitest'
import React from 'react'

// Create a mock function that behaves like the actual route functions
const createRouteMock = (defaultPath: string) => {
    const routeFunction = vi.fn().mockImplementation((params = {}, search = {}) => {
        // Handle parameters in the path
        let path = defaultPath
        Object.entries(params).forEach(([key, value]) => {
            path = path.replace(`[${key}]`, String(value))
        })
        
        // Handle search parameters
        const searchParams = new URLSearchParams()
        Object.entries(search).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                searchParams.append(key, String(value))
            }
        })
        
        const searchString = searchParams.toString()
        return searchString ? `${path}?${searchString}` : path
    })

    // Add Link property for Next.js Link compatibility
    Object.defineProperty(routeFunction, 'Link', {
        value: vi.fn().mockImplementation(({ children, ...props }: { children: React.ReactNode } & Record<string, unknown>) => {
            return React.createElement('a', { ...props, href: defaultPath }, children)
        }),
        writable: true,
        enumerable: true,
        configurable: true
    })

    return routeFunction
}

// Export all the route functions that the app uses
export const Middlewareerrorenv = createRouteMock('/middleware/error/env')
export const MiddlewareerrorhealthCheck = createRouteMock('/middleware/error/healthCheck')
export const Autherror = createRouteMock('/auth/error')
export const Authme = createRouteMock('/auth/me')
export const Authsignin = createRouteMock('/auth/signin')
export const Authsignup = createRouteMock('/auth/signup')
export const Dashboard = createRouteMock('/dashboard')
export const DashboardProjects = createRouteMock('/dashboard/projects')
export const DashboardProjectsId = createRouteMock('/dashboard/projects/[id]')
export const Profile = createRouteMock('/profile')
export const Home = createRouteMock('/')

// API route functions
export const getApiServerHealth = vi.fn().mockReturnValue('/api/server/health')
export const getApiServerPing = vi.fn().mockReturnValue('/api/server/ping')