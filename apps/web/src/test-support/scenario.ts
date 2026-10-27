import { vi, type Mock } from 'vitest'

/**
 * The data state every mocked domain hook is currently in.
 *
 * `loading`   — queries pending, no data
 * `error`     — queries rejected
 * `empty`     — queries succeeded with no rows
 * `populated` — queries succeeded with the fixtures' populated payload
 */
export type Scenario = 'loading' | 'error' | 'empty' | 'populated'

export const ERROR_MESSAGE = 'upstream exploded'

export type TestRole = 'superAdmin' | 'admin' | 'developer' | 'viewer'

export const scenario: {
	state: Scenario
	/** Force individual hooks (by name) into a different state than the page-wide one. */
	perHook: Record<string, Scenario>
	/** Exact data a hook resolves with (as a successful query), by hook name. */
	data: Record<string, unknown>
	role: TestRole | null
	params: Record<string, string>
	search: Record<string, string>
} = {
	state: 'loading',
	perHook: {},
	data: {},
	role: 'admin',
	params: {},
	search: {},
}

/** One `refetch` spy per hook name, so a spec can assert Retry reaches the right query. */
const refetchSpies = new Map<string, Mock>()
export function refetchSpy(hookName: string): Mock {
	let spy = refetchSpies.get(hookName)
	if (!spy) {
		spy = vi.fn()
		refetchSpies.set(hookName, spy)
	}
	return spy
}
export function allRefetchSpies(): Map<string, Mock> {
	return refetchSpies
}
export function resetScenario(): void {
	scenario.state = 'loading'
	scenario.perHook = {}
	scenario.data = {}
	scenario.role = 'admin'
	scenario.params = {}
	scenario.search = {}
	refetchSpies.clear()
}
