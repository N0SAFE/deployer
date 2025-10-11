/**
 * Organization Selection Middleware
 * 
 * Checks if authenticated users have an active organization selected
 * Redirects to /organization/select if no organization is active
 * This middleware runs after authentication
 */

import { NextResponse, NextMiddleware, NextRequest, NextFetchEvent } from 'next/server'
import type { MiddlewareFactory, Matcher } from './utils/types'
import { matcherHandler } from './utils/utils'
import { nextjsRegexpPageOnly, nextNoApi } from './utils/static'
import { createDebug } from '@/lib/debug'
import { getSessionCookie } from 'better-auth/cookies'

const debugOrg = createDebug('middleware/organization')
const debugOrgError = createDebug('middleware/organization/error')

const orgSelectPath = '/organization/select'
const dashboardRegexpAndChildren = /^\/dashboard(\/.*)?$/
const profileRegexpAndChildren = /^\/profile(\/.*)?$/

// Simple in-memory cache with TTL
const orgStatusCache: Map<string, {
  hasActiveOrg: boolean | null
  timestamp: number
}> = new Map()

const CACHE_TTL = 10 * 1000 // 10 seconds

async function checkActiveOrganization(sessionToken: string): Promise<boolean> {
  // Check cache first
  const now = Date.now()
  const cached = orgStatusCache.get(sessionToken)
  
  if (cached && cached.hasActiveOrg !== null && now - cached.timestamp < CACHE_TTL) {
    debugOrg('Using cached organization status', { hasActiveOrg: cached.hasActiveOrg })
    return cached.hasActiveOrg
  }

  try {
    debugOrg('Checking active organization via Better Auth session')

    // Call the Better Auth API to get session with organization info
    const apiUrl = process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'
    const response = await fetch(`${apiUrl}/api/auth/get-session`, {
      headers: {
        'Cookie': `better-auth.session_token=${sessionToken}`,
      },
    })

    if (!response.ok) {
      debugOrgError('Failed to fetch session', { status: response.status })
      return false
    }

    const session = await response.json()
    const hasActiveOrg = !!session?.session?.activeOrganizationId

    // Update cache
    orgStatusCache.set(sessionToken, {
      hasActiveOrg,
      timestamp: now,
    })

    debugOrg('Organization status checked successfully', { hasActiveOrg })
    return hasActiveOrg
  } catch (error) {
    debugOrgError('Error checking organization status', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
    })
    // On error, allow through to avoid blocking
    return true
  }
}

const withOrganization: MiddlewareFactory = (next: NextMiddleware) => {
  return async (request: NextRequest, _next: NextFetchEvent) => {
    debugOrg('Organization middleware invoked', {
      path: request.nextUrl.pathname,
    })

    // Get session token
    const sessionCookie = getSessionCookie(request)
    
    if (!sessionCookie) {
      debugOrg('No session found, skipping organization check')
      return next(request, _next)
    }

    const matcher = matcherHandler(request.nextUrl.pathname, [
      [
        orgSelectPath,
        async () => {
          debugOrg('User is on organization select page')
          // Allow access to organization select page
          return next(request, _next)
        },
      ],
      [
        {
          or: [dashboardRegexpAndChildren, profileRegexpAndChildren],
        },
        async () => {
          debugOrg('User is on protected route, checking for active organization')
          const hasActiveOrg = await checkActiveOrganization(sessionCookie)
          
          if (!hasActiveOrg) {
            // Redirect to organization select page
            const redirectUrl = new URL(orgSelectPath, request.url)
            debugOrg('No active organization, redirecting to select page', {
              from: request.nextUrl.pathname,
              to: redirectUrl.href,
            })
            return NextResponse.redirect(redirectUrl)
          }
          
          debugOrg('Active organization found, proceeding to next middleware')
          return next(request, _next)
        },
      ],
    ])

    if (matcher.hit) {
      debugOrg('Matcher hit, returning matched response')
      return matcher.data
    }

    debugOrg('No matcher hit, proceeding to next middleware')
    return next(request, _next)
  }
}

export default withOrganization

export const matcher: Matcher = [
  {
    and: [nextjsRegexpPageOnly, nextNoApi],
  },
]
