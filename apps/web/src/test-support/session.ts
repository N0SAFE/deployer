import { scenario, type TestRole } from './scenario'

/**
 * A Better Auth session as `useSession()` returns it, for the role the current
 * scenario selects. `role: null` is "no session at all".
 *
 * Wire it with:
 *   vi.mock('@/lib/auth', async () => (await import('@/test-support')).authModule())
 */
export function sessionFor(role: TestRole | null) {
	if (role === null) return { data: null, isPending: false, error: null, refetch: () => Promise.resolve() }
	return {
		data: {
			session: { id: 'sess-1', userId: 'user-1', token: 't', expiresAt: new Date(Date.now() + 3_600_000) },
			user: { id: 'user-1', name: 'Test Operator', email: 'operator@example.test', role, image: null, emailVerified: true },
		},
		isPending: false,
		error: null,
		refetch: () => Promise.resolve(),
	}
}

export function authModule() {
	return {
		useSession: () => sessionFor(scenario.role),
		signOut: () => Promise.resolve(),
		authClient: {
			signOut: () => Promise.resolve(),
			listSessions: () => Promise.resolve({ data: [], error: null }),
			useSession: () => sessionFor(scenario.role),
		},
	}
}

/** `next/navigation` with the current scenario's `params`/`search`. */
export function navigationModule() {
	const router = {
		push: () => undefined,
		replace: () => undefined,
		prefetch: () => undefined,
		back: () => undefined,
		forward: () => undefined,
		refresh: () => undefined,
	}
	return {
		useRouter: () => router,
		usePathname: () => '/dashboard',
		useParams: () => scenario.params,
		useSearchParams: () => new URLSearchParams(scenario.search),
		redirect: () => undefined,
		notFound: () => undefined,
	}
}
