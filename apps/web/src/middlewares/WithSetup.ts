/**
 * Setup Detection Middleware
 * 
 * Checks if initial setup is required (no users exist) and redirects to /setup page
 * This middleware runs before authentication to allow setup on fresh installations
 */

import { NextResponse, NextMiddleware, NextRequest, NextFetchEvent } from 'next/server'
import type { MiddlewareFactory, Matcher } from './utils/types'
import { createORPCClientWithCookies, orpc } from '@/lib/orpc'
import { matcherHandler } from './utils/utils'
import { nextjsRegexpPageOnly, nextNoApi } from './utils/static'
import { createDebug } from '@/lib/debug'

const debugSetup = createDebug('middleware/setup')
const debugSetupError = createDebug('middleware/setup/error')

const setupPagePath = '/setup'

// Simple in-memory cache with TTL
let setupStatusCache: {
  needsSetup: boolean | null
  timestamp: number
} = {
  needsSetup: null,
  timestamp: 0,
}

const CACHE_TTL = 30 * 1000 // 30 seconds

async function checkSetupStatus(): Promise<boolean> {
  // Check cache first
  const now = Date.now()
  if (setupStatusCache.needsSetup !== null && now - setupStatusCache.timestamp < CACHE_TTL) {
    debugSetup('Using cached setup status', { needsSetup: setupStatusCache.needsSetup })
    return setupStatusCache.needsSetup
  }

  try {
    debugSetup('Checking setup status via ORPC')

    // Create an abort controller with timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 3000)

    try {
      const data = await orpc.setup.checkSetupStatus.call(
        {},
        {
          context: {
            noRedirectOnUnauthorized: true as const, // Don't redirect on 401 during setup check
          },
          signal: controller.signal,
        }
      )
      clearTimeout(timeoutId)

      const needsSetup = data.needsSetup || false

      // Update cache
      setupStatusCache = {
        needsSetup,
        timestamp: now,
      }

      debugSetup('Setup status checked successfully', { needsSetup, hasUsers: data.hasUsers })
      return needsSetup
    } finally {
      clearTimeout(timeoutId)
    }
  } catch (error) {
    debugSetupError('Error checking setup status', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
    })
    // On error, assume setup not needed to avoid blocking
    return false
  }
}

const withSetup: MiddlewareFactory = (next: NextMiddleware) => {
  return async (request: NextRequest, _next: NextFetchEvent) => {
    debugSetup('Setup middleware invoked', {
      path: request.nextUrl.pathname,
    })

    const matcher = matcherHandler(request.nextUrl.pathname, [
      [
        setupPagePath,
        async () => {
          debugSetup('User is on setup page, verifying setup is still needed')
          const needsSetup = await checkSetupStatus()
          
          if (!needsSetup) {
            // Setup already completed, redirect to dashboard
            const redirectUrl = new URL('/dashboard', request.url)
            debugSetup('Setup already completed, redirecting to dashboard', {
              from: setupPagePath,
              to: redirectUrl.href,
            })
            return NextResponse.redirect(redirectUrl)
          }
          
          debugSetup('Setup still needed, allowing access to setup page')
          return next(request, _next)
        },
      ],
      [
        { not: setupPagePath },
        async () => {
          debugSetup('User is not on setup page, checking if setup is needed')
          const needsSetup = await checkSetupStatus()
          
          if (needsSetup) {
            // Redirect to setup page
            const redirectUrl = new URL(setupPagePath, request.url)
            debugSetup('Setup required, redirecting to setup page', {
              from: request.nextUrl.pathname,
              to: redirectUrl.href,
            })
            return NextResponse.redirect(redirectUrl)
          }
          
          debugSetup('Setup not needed, proceeding to next middleware')
          return next(request, _next)
        },
      ],
    ])

    if (matcher.hit) {
      debugSetup('Matcher hit, returning matched response')
      return matcher.data
    }

    debugSetup('No matcher hit, proceeding to next middleware')
    return next(request, _next)
  }
}

export default withSetup

export const matcher: Matcher = [
  {
    and: [nextjsRegexpPageOnly, nextNoApi],
  },
]
