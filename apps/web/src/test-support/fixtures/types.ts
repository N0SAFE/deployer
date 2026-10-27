import type { Scenario } from '../scenario'

/**
 * What one domain hook returns in each data state.
 *
 * `empty` / `populated` are the DATA a successful query resolves with (a value,
 * or a function of the hook's arguments). Loading and error need no data.
 * `raw` replaces the whole result for hooks that do not return a query (e.g. a
 * composite hook), so it receives the scenario and answers for it.
 */
export interface HookFixture {
	empty: unknown
	populated?: unknown
	raw?: (state: Scenario, args: unknown[]) => unknown
}

export type FixtureMap = Record<string, HookFixture>

/** Fixed clock for every fixture: a node "seen a minute ago" is live, one from a week ago is stale. */
export const NOW_ISO = new Date().toISOString()
export const minutesAgo = (n: number): string => new Date(Date.now() - n * 60_000).toISOString()
export const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString()

/** The `{ data, meta }` envelope list contracts resolve with. */
export function listOf<T>(rows: T[]): { data: T[]; meta: { total: number; limit: number; offset: number; page: number; pageSize: number; totalPages: number; hasNext: boolean; hasPrev: boolean } } {
	return { data: rows, meta: { total: rows.length, limit: 50, offset: 0, page: 1, pageSize: 50, totalPages: rows.length === 0 ? 0 : 1, hasNext: false, hasPrev: false } }
}
