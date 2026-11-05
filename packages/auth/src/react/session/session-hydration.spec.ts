import { QueryClient, dehydrate } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

/**
 * The session cache MUST be seeded even when `shouldFetch` is false.
 *
 * Regression guard for the MainNavigation hydration mismatch: `SessionHydration`
 * skipped `setQueryData` when no session cookie existed, so the dehydrated state
 * carried no `session` entry. `useSession()` then treated it as "not fetched"
 * (Better Auth fallback, `isPending: true` → skeleton) on the server, while the
 * client resolved to `data: null` (Sign In link) — React threw a hydration error
 * on `/`.
 *
 * `@tanstack/react-query` is a devDependency here only for this assertion; the
 * component under test is a server component and cannot be rendered in jsdom, so
 * the invariant it depends on is asserted against QueryClient directly.
 */
const SESSION_QUERY_KEY = ['session'] as const

/** Mirrors the write `SessionHydration` performs. */
const seed = (session: unknown): QueryClient => {
    const client = new QueryClient()
    client.setQueryData(SESSION_QUERY_KEY, session, { updatedAt: 0 })
    return client
}

describe('session hydration cache write', () => {
    it('records null as a KNOWN value, not as an absent entry', () => {
        const client = seed(null)
        expect(client.getQueryData(SESSION_QUERY_KEY)).toBeNull()
        expect(client.getQueryState(SESSION_QUERY_KEY)).toBeDefined()
    })

    it('survives dehydration, so the client sees the same known-null', () => {
        const state = dehydrate(seed(null))
        const entry = state.queries.find(
            (query) =>
                JSON.stringify(query.queryKey) ===
                JSON.stringify(SESSION_QUERY_KEY)
        )
        expect(entry).toBeDefined()
        expect(entry?.state.data).toBeNull()
    })

    it('does not stamp the write with the current time (prerender-safe)', () => {
        // A `Date.now()` here is a prerender-time read and trips
        // `blocking-prerender-current-time`; the session query is staleTime: Infinity,
        // so the timestamp carries no meaning.
        const state = seed(null).getQueryState(SESSION_QUERY_KEY)
        expect(state?.dataUpdatedAt).toBe(0)
    })

    it('keeps a real session distinguishable from the known-null', () => {
        const session = { user: { id: 'u1' } }
        expect(seed(session).getQueryData(SESSION_QUERY_KEY)).toEqual(session)
    })
})
