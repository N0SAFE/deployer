import { vi, type Mock } from 'vitest'
import { HOOK_FIXTURES, type HookFixture } from './fixtures'
import { idleMutation, errorQuery, loadingQuery, successQuery, type MutationStub } from './query-results'
import { ERROR_MESSAGE, refetchSpy, scenario } from './scenario'

/**
 * A mock for a `@/domains/<name>/hooks` module.
 *
 * Every `use*` export is answered by the current `scenario`:
 *  - names that look like mutations (`useCreateX`, `useDeleteX`, …) return an
 *    idle mutation (stable per name, so a spec can inspect `mutate`);
 *  - everything else is a query whose result comes from `HOOK_FIXTURES`;
 *  - a hook with no fixture THROWS, so a page that starts calling a new hook
 *    fails loudly instead of rendering against a silently-empty result.
 *
 * Usage (the factory must be async because it imports test-support lazily,
 * and `vi.mock` is hoisted above static imports):
 *
 *   vi.mock('@/domains/cluster/hooks', async () => (await import('@/test-support')).domainHooks())
 */

export type HookImpl = (...args: never[]) => unknown

/** Verbs that mark a hook as a mutation. */
const MUTATION_NAME =
	/^use(?:Create|Update|Delete|Remove|Add|Verify|Retry|Cancel|Rollback|Promote|Trigger|Resolve|Set|Refresh|Upsert|Invite|Revoke|Connect|Disconnect|Reconcile|Lookup|Plan|Regenerate|Teardown|Check|Provision|Toggle|Clone|Generate|Download|Test|Save|Restart|Stop|Start|Redeploy|Deploy|Rotate|Mesh(?:TrustStrictModeSet|TrustStrictRollback|TrustKeyringRotate|UpdateNodeConfig|RegenerateNodeConfigSecret|TestNodeConfigDb)|Cloudflare(?:Create|Delete)|GitHub(?:Create|Install|Manifest)|Docker(?:Write|Delete|Rename|Create|Run|Open|Send|Close)|Admin(?:Ban|Unban|SetRole|CreateUser|UpdateUser|RemoveUser))(?![a-z])/

/** Named like a mutation but consumed as a query. */
const QUERY_NAMES = new Set(['useCheckDomainGate'])
/** Mutations whose name does not start with a verb. */
const MUTATION_NAMES = new Set(['useDomainReachabilityCheck'])

export function isMutationName(name: string): boolean {
	if (QUERY_NAMES.has(name)) return false
	if (MUTATION_NAMES.has(name)) return true
	if (name === 'useGitHubManifestInit' || name === 'useGitHubSelfCheck') return true
	return MUTATION_NAME.test(name)
}

const mutations = new Map<string, MutationStub>()
export function mutationFor(name: string): MutationStub {
	let m = mutations.get(name)
	if (!m) {
		m = idleMutation()
		mutations.set(name, m)
	}
	return m
}
export function resetMutations(): void {
	mutations.clear()
}

function resolveFixture(name: string, args: unknown[]): unknown {
	if (name in scenario.data) return successQuery(scenario.data[name], refetchSpy(name))
	const fixture: HookFixture | undefined = HOOK_FIXTURES[name]
	if (!fixture) {
		throw new Error(
			`test-support: no fixture for domain hook "${name}". Add it to src/test-support/fixtures/ (or pass an override to domainHooks()).`,
		)
	}
	const state = scenario.perHook[name] ?? scenario.state
	if (fixture.raw) return fixture.raw(state, args)
	const pick = (v: unknown): unknown => (typeof v === 'function' ? (v as (...a: unknown[]) => unknown)(...args) : v)
	const refetch: Mock = refetchSpy(name)
	switch (state) {
		case 'loading':
			return loadingQuery(refetch)
		case 'error':
			return errorQuery(ERROR_MESSAGE, refetch)
		case 'empty':
			return successQuery(pick(fixture.empty), refetch)
		case 'populated':
			return successQuery(pick('populated' in fixture ? fixture.populated : fixture.empty), refetch)
	}
}

export function domainHooks(overrides: Record<string, HookImpl> = {}): Record<string, unknown> {
	const fns = new Map<string, unknown>()
	const target: Record<string, unknown> = {}
	return new Proxy(target, {
		has: () => true,
		get(_target, prop) {
			if (typeof prop !== 'string' || prop === 'then' || prop === '__esModule' || prop === 'default') return undefined
			let fn = fns.get(prop)
			if (!fn) {
				const override = overrides[prop]
				fn = vi.fn((...args: unknown[]) => {
					if (override) return (override as (...a: unknown[]) => unknown)(...args)
					if (isMutationName(prop)) return mutationFor(prop)
					return resolveFixture(prop, args)
				})
				fns.set(prop, fn)
			}
			return fn
		},
	})
}

/** `useNodeScope()` without a provider: mesh-wide scope, no node selected. */
export function nodeContextModule() {
	const scope = { nodeId: null, setNodeId: () => undefined, isNodeSelected: false, localNodeId: 'node-1' }
	return {
		NodeScopeProvider: ({ children }: { children: unknown }) => children,
		useNodeScope: () => scope,
	}
}
