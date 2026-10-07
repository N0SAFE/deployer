import { NextResponse } from 'next/server'
import { getAuthUrl } from '@/lib/api-url'

/**
 * Agent Auth discovery document.
 *
 * Agents look here first: `/.well-known/agent-configuration` is the fixed
 * location from the Agent Auth protocol, and it is what tells an agent how to
 * request capabilities from this platform — provider identity, supported modes,
 * approval methods, and the absolute execute URL it should call.
 *
 * Served from the app root rather than the API because the well-known path is
 * origin-scoped: an agent given `https://deploy.example.com` must find it there,
 * not behind an `/api` prefix.
 *
 * ## Why this proxies instead of calling an auth instance
 *
 * The web app has no server-side Better Auth instance — it reads sessions from
 * the shared cookie (`lib/auth/cookie-session.ts`) and otherwise talks to the
 * API over HTTP. `getAgentConfiguration` is a server API method, so this route
 * forwards to the API's auth handler rather than constructing a second auth
 * instance whose configuration could drift from the API's.
 *
 * Deliberately not statically generated: the document embeds the runtime issuer
 * and absolute endpoint URLs, which differ per deployment.
 */
export async function GET() {
    try {
        const response = await fetch(getAuthUrl('agent-configuration'), {
            method: 'GET',
            headers: { accept: 'application/json' },
            cache: 'no-store',
        })

        if (!response.ok) {
            // The plugin only answers when agent auth is configured. A 404 is
            // the honest translation: the endpoint does not exist here. Anything
            // else is the API failing, which the caller should see as a gateway
            // problem rather than a missing capability.
            return NextResponse.json(
                { error: 'Agent Auth is not configured on this deployment' },
                { status: response.status === 404 ? 404 : 502 },
            )
        }

        const configuration: unknown = await response.json()
        return NextResponse.json(configuration)
    } catch (error) {
        return NextResponse.json(
            {
                error: 'Could not reach the API to read the agent configuration',
                detail: error instanceof Error ? error.message : undefined,
            },
            { status: 502 },
        )
    }
}
