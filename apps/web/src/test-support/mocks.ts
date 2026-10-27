import { vi } from 'vitest'

/**
 * Side-effect module: importing it (FIRST, before any page) registers every mock a
 * dashboard page needs — typed routes, `next/navigation`, the auth client, and all
 * `@/domains/<name>/hooks` modules. Hoisting is per file, so the `vi.mock` calls
 * live here and a spec only does `import '@/test-support/mocks'`.
 *
 * The factories import test-support lazily: `vi.mock` is hoisted above static
 * imports, so a top-level import inside a factory would not be initialised yet.
 */

vi.mock('@/routes', async () => (await import('./routes')).routesModule())
vi.mock('@/lib/utils', async (importOriginal) => importOriginal())
vi.mock('next/navigation', async () => (await import('./session')).navigationModule())
vi.mock('@/lib/auth', async () => (await import('./session')).authModule())
// MapLibre needs WebGL, which jsdom does not have: render the map as a plain container.
vi.mock('@/components/ui/map', async () => (await import('./map-stub')).mapModule())
vi.mock('@/domains/node/node-context', async () => (await import('./domain-hooks')).nodeContextModule())

// The account module also exports pure formatters the cards import, so only its hooks are replaced.
vi.mock('@/domains/account/hooks', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>()
	const hooks = (await import('./domain-hooks')).domainHooks()
	return new Proxy(actual, {
		get: (target, prop): unknown => {
			if (typeof prop === 'string' && prop.startsWith('use')) return hooks[prop]
			const value: unknown = Reflect.get(target, prop)
			return value
		},
	})
})
vi.mock('@/domains/admin/hooks', async () => (await import('./domain-hooks')).domainHooks())
vi.mock('@/domains/analytics/hooks', async () => (await import('./domain-hooks')).domainHooks())
vi.mock('@/domains/bff/hooks', async () => (await import('./domain-hooks')).domainHooks())
vi.mock('@/domains/cluster/hooks', async () => (await import('./domain-hooks')).domainHooks())
vi.mock('@/domains/deployment/hooks', async () => (await import('./domain-hooks')).domainHooks())
vi.mock('@/domains/dns-providers/hooks', async () => (await import('./domain-hooks')).domainHooks())
vi.mock('@/domains/docker/hooks', async () => (await import('./domain-hooks')).domainHooks())
vi.mock('@/domains/domain/hooks', async () => (await import('./domain-hooks')).domainHooks())
vi.mock('@/domains/fleet/hooks', async () => (await import('./domain-hooks')).domainHooks())
vi.mock('@/domains/github-apps/hooks', async () => (await import('./domain-hooks')).domainHooks())
vi.mock('@/domains/gitlab/hooks', async () => (await import('./domain-hooks')).domainHooks())
vi.mock('@/domains/managed-web/hooks', async () => (await import('./domain-hooks')).domainHooks())
vi.mock('@/domains/mesh/hooks', async () => (await import('./domain-hooks')).domainHooks())
vi.mock('@/domains/project/hooks', async () => (await import('./domain-hooks')).domainHooks())
vi.mock('@/domains/provider-schema/hooks', async () => (await import('./domain-hooks')).domainHooks())
vi.mock('@/domains/push/hooks', async () => (await import('./domain-hooks')).domainHooks())
vi.mock('@/domains/reachability/hooks', async () => (await import('./domain-hooks')).domainHooks())
vi.mock('@/domains/service/hooks', async () => (await import('./domain-hooks')).domainHooks())
vi.mock('@/domains/setup/hooks', async () => (await import('./domain-hooks')).domainHooks())
vi.mock('@/domains/user/hooks', async () => (await import('./domain-hooks')).domainHooks())
vi.mock('@/domains/docker/use-docker-live', async () => (await import('./domain-hooks')).domainHooks())

// `vitest.setup.unit.ts` stubs the observers with arrow functions, which cannot be
// `new`-ed (Recharts' ResponsiveContainer does). Replace them with constructible stubs.
class ObserverStub {
	observe(): void {
		/* no-op */
	}
	unobserve(): void {
		/* no-op */
	}
	disconnect(): void {
		/* no-op */
	}
	takeRecords(): unknown[] {
		return []
	}
}
for (const name of ['ResizeObserver', 'IntersectionObserver']) {
	Object.defineProperty(globalThis, name, { value: ObserverStub, configurable: true, writable: true })
}
