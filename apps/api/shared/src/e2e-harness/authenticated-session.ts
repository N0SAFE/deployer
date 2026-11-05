import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { provisionUserAccount } from '@deployer/auth/server'

import type { SharedApiRuntimeContext } from './shared-api-runtime'

/**
 * A REAL signed-in caller for an e2e spec: a user created through Better Auth, given a
 * platform role, signed in, and reduced to the `Cookie` header a request carries.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Until now the e2e suites asserted only that anonymous callers are refused. The first full
 * boot found five delegated routes answering `500` to a signed-in admin, and nothing in CI
 * could have caught it, because no spec ever made an authorised call and read the answer.
 * This is the missing half: a caller who is allowed in.
 *
 * The account is provisioned through Better Auth's internal adapter with the role written at creation: arranging
 * a fixture must not depend on the rules (or the public sign-up endpoint) of the domain under test.
 */
export type AuthenticatedSession = {
    readonly userId: string
    readonly email: string
    /** The value of the `Cookie` request header. */
    readonly cookie: string
}

export async function createAuthenticatedSession(
    context: SharedApiRuntimeContext,
    options: { role?: 'superAdmin' | 'admin' | 'operator' | 'viewer' } = {}
): Promise<AuthenticatedSession> {
    const email = `e2e-${randomUUID()}@e2e.deployer.test`
    const password = `e2e-${randomUUID()}`

    // Public sign-up is disabled (AUTH-001), so the fixture provisions the account directly, with the role written at
    // creation: a spec must not depend on the flow it is testing, and an e2e caller is a real, signed-in user.
    const userId = await provisionUserAccount(context.betterAuth, {
        email,
        name: 'E2E Caller',
        password,
        role: options.role ?? 'admin',
    })

    const response = await context.betterAuth.api.signInEmail({
        body: { email, password },
        asResponse: true,
    })
    const cookie = response.headers
        .getSetCookie()
        .map((entry) => entry.split(';')[0])
        .filter((pair): pair is string => pair !== undefined && pair.length > 0)
        .join('; ')
    if (cookie.length === 0) {
        throw new Error('signInEmail returned no session cookie')
    }

    return { userId, email, cookie }
}
