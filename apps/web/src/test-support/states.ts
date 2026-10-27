import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { expectEmptyState, expectErrorState, expectLoadingState, expectNoBrokenText, expectPopulated, queryControl } from './assertions'
import { resetMutations } from './domain-hooks'
import { renderPage } from './render-page'
import { allRefetchSpies, resetScenario, scenario, type Scenario, type TestRole } from './scenario'

export interface PageStatesSpec {
	/** Builds the page element. Called once per test, after the scenario is set. */
	page: () => ReactElement
	/** Route params the page reads through `useParams()`. */
	params?: Record<string, string>
	/** Search params the page reads through `useSearchParams()`. */
	search?: Record<string, string>
	/** Next-action expectations for the empty state. */
	empty?: { action?: RegExp; wording?: RegExp }
	/** Skip the empty-state test (page has no list-shaped data). Give the reason. */
	skipEmpty?: string
	/** Skip the loading test (page renders without waiting on data). Give the reason. */
	skipLoading?: string
	/** Skip the error test (page has no data it can fail to load). Give the reason. */
	skipError?: string
	/**
	 * A state whose check currently fails because of a real bug in a file this task may not edit.
	 * The test is registered with `it.fails` (green while the bug exists, red the day it is fixed,
	 * which is the cue to delete the entry). Give the bug.
	 */
	knownBugs?: Partial<Record<Scenario, string>>
	/** Extra assertions per state, run after (or instead of, when skipped) the built-in ones. */
	checks?: Partial<Record<Scenario, (container: HTMLElement) => void>>
	/** Skip the populated test (fixtures not worth it). Give the reason. */
	skipPopulated?: string
	/** Error state offers Retry but it is a router refresh / reload, not a query refetch. */
	retryIsNotRefetch?: boolean
	/** Error state has no Retry control by design (give the reason). */
	noRetry?: string
	/** Controls that a non-admin must NOT see (and an admin must). */
	adminOnly?: RegExp
	/** Role used for the loading/error/empty/populated runs. Defaults to admin. */
	role?: TestRole | null
	/** Extra populated-state assertions. */
	populated?: (container: HTMLElement) => void
	/**
	 * Mixed states: a page-wide base state with some hooks forced into another
	 * (e.g. "projects exist but its domains query fails").
	 */
	variants?: PageVariant[]
}

export interface PageVariant {
	name: string
	/** Page-wide state; defaults to `populated`. */
	base?: Scenario
	/** Hooks forced into a different state, by hook name. */
	hooks: Record<string, Scenario>
	/** Exact data some hooks resolve with, by hook name (a successful query). */
	data?: Record<string, unknown>
	/** What the page must then look like. */
	expect: 'loading' | 'error' | 'empty'
	empty?: { action?: RegExp; wording?: RegExp }
	/** The error has no Retry by design (give the reason). */
	noRetry?: string
	/** Retry is not a refetch of a hook. */
	retryIsNotRefetch?: boolean
}

/** The Retry control: an explicit "Retry / Try again" wins over a generic "Refresh". */
function pickRetry(): HTMLElement | undefined {
	return (
		screen.queryAllByRole('button', { name: /retry|try again/i })[0] ??
		screen.queryAllByRole('button', { name: /reload|refresh/i })[0]
	)
}

function arrange(spec: PageStatesSpec, state: Scenario, role?: TestRole | null) {
	resetScenario()
	resetMutations()
	scenario.state = state
	scenario.role = role === undefined ? (spec.role === undefined ? 'admin' : spec.role) : role
	scenario.params = spec.params ?? {}
	scenario.search = spec.search ?? {}
}

async function mount(spec: PageStatesSpec) {
	const result = renderPage(spec.page())
	// Let effects and resolved-promise state updates settle.
	await act(async () => {
		await Promise.resolve()
	})
	return result
}

/**
 * Generates the loading / error / empty / populated (+ admin-only) tests for one page.
 * The calling spec must `vi.mock` the modules the page imports (see the specs).
 */
export function describePageStates(name: string, spec: PageStatesSpec): void {
	describe(name, () => {
		let restoreConsole: () => void = () => undefined
		beforeEach(() => {
			const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
			restoreConsole = () => {
				spy.mockRestore()
			}
		})
		afterEach(() => {
			cleanup()
			restoreConsole()
		})

		const testFor = (state: Scenario) => {
			const bug = spec.knownBugs?.[state]
			if (bug === undefined) return it
			return (title: string, fn: () => Promise<void>) => {
				it.fails(`${title} [KNOWN BUG: ${bug}]`, fn)
			}
		}

		testFor('loading')('loading: renders a skeleton or labelled loading region', async () => {
			arrange(spec, 'loading')
			const { container } = await mount(spec)
			if (spec.skipLoading === undefined) expectLoadingState(container)
			else expectNoBrokenText(container)
			spec.checks?.loading?.(container)
		})

		testFor('error')('error: shows a readable message and a Retry control that refetches', async () => {
			arrange(spec, 'error')
			const { container } = await mount(spec)
			spec.checks?.error?.(container)
			if (spec.skipError !== undefined) {
				expectNoBrokenText(container)
				return
			}
			expectErrorState(container, { retry: spec.noRetry === undefined })
			if (spec.noRetry === undefined && spec.retryIsNotRefetch !== true) {
				const retry = pickRetry()
				if (!retry) throw new Error('no retry button')
				fireEvent.click(retry)
				const called = [...allRefetchSpies().values()].some((spy) => spy.mock.calls.length > 0)
				expect(called, 'clicking Retry must refetch a query').toBe(true)
			}
		})

		if (spec.skipEmpty === undefined) {
			testFor('empty')('empty: explains what the list would hold and offers a next action', async () => {
				arrange(spec, 'empty')
				const { container } = await mount(spec)
				expectEmptyState(container, spec.empty)
				spec.checks?.empty?.(container)
			})
		}

		if (spec.skipPopulated === undefined) {
			testFor('populated')('populated: renders rows without error text or broken values', async () => {
				arrange(spec, 'populated')
				const { container } = await mount(spec)
				expectPopulated(container)
				spec.populated?.(container)
				spec.checks?.populated?.(container)
			})
		}

		for (const variant of spec.variants ?? []) {
			it(`variant — ${variant.name}`, async () => {
				arrange(spec, variant.base ?? 'populated')
				scenario.perHook = { ...variant.hooks }
				scenario.data = { ...variant.data }
				const { container } = await mount(spec)
				if (variant.expect === 'loading') expectLoadingState(container)
				else if (variant.expect === 'empty') expectEmptyState(container, variant.empty)
				else {
					expectErrorState(container, { retry: variant.noRetry === undefined })
					if (variant.noRetry === undefined && variant.retryIsNotRefetch !== true) {
						const retry = pickRetry()
						if (!retry) throw new Error('no retry button')
						fireEvent.click(retry)
						expect([...allRefetchSpies().values()].some((spy) => spy.mock.calls.length > 0), 'clicking Retry must refetch a query').toBe(true)
					}
				}
			})
		}

		if (spec.adminOnly) {
			const control = spec.adminOnly
			it('admin-only controls: present for an admin, absent for a viewer', async () => {
				arrange(spec, 'populated', 'admin')
				await mount(spec)
				expect(queryControl(control).length, `admin should see ${String(control)}`).toBeGreaterThan(0)
				cleanup()
				arrange(spec, 'populated', 'viewer')
				const { container } = await mount(spec)
				expect(queryControl(control), `viewer must not see ${String(control)}`).toHaveLength(0)
				expectNoBrokenText(container)
			})
		}
	})
}
