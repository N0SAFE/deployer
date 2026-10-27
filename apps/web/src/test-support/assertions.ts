import { expect } from 'vitest'
import { screen, within } from '@testing-library/react'

/**
 * Assertions for the page-state rules in UI-PRINCIPLES §1.
 * Each takes the render `container` so a failure message points at one page.
 */

const BROKEN_TEXT = /\[object Object\]|\bundefined\b|\bNaN\b/
const FILTER_WORDING = /match(es)?\s+(the\s+|these\s+|your\s+|current\s+)*filters?|no results match|clear filters/i
const ERROR_WORDING = /fail|error|couldn.?t|could not|unable|unavailable|can.?t|went wrong|not reachable|unreachable|problem|not found|does not exist/i
const EMPTY_CLAIM = /\bno [a-z][a-z -]{1,40} yet\b|nothing (here )?yet|\b0 (nodes|projects|services|deployments)\b/i
const LOADING_WORDING = /loading|connecting|checking|fetching|reading|waiting|resolving/i

export function expectNoBrokenText(container: HTMLElement): void {
	const text = container.textContent
	expect(text, 'rendered text must not contain [object Object] / undefined / NaN').not.toMatch(BROKEN_TEXT)
}

/** A skeleton, a labelled status region, a busy region or a "Loading…" line — never blank. */
export function expectLoadingState(container: HTMLElement): void {
	const hasSkeleton = container.querySelector('[data-slot="skeleton"], .animate-pulse, [aria-busy="true"]') !== null
	const hasStatus = container.querySelector('[role="status"], [role="progressbar"]') !== null
	const hasWords = LOADING_WORDING.test(container.textContent)
	expect(hasSkeleton || hasStatus || hasWords, 'loading state must render a skeleton or a labelled loading region, not a blank page').toBe(true)
	expect(container.textContent.trim().length > 0 || hasSkeleton, 'loading state must not be blank').toBe(true)
	expect(container.textContent, 'a page that is still loading must not claim it is empty').not.toMatch(EMPTY_CLAIM)
	expectNoBrokenText(container)
}

/** A readable message plus a Retry control. */
export function expectErrorState(container: HTMLElement, opts: { retry?: boolean } = {}): void {
	const retry = opts.retry ?? true
	const text = container.textContent
	expect(ERROR_WORDING.test(text), `error state must say what failed (got: ${text.slice(0, 200)})`).toBe(true)
	expect(text, 'a failed load is not a filtered list: it must not say "no results match these filters"').not.toMatch(FILTER_WORDING)
	if (retry) {
		const buttons = within(container).queryAllByRole('button', { name: /retry|try again|reload|refresh/i })
		expect(buttons.length, 'error state must offer a Retry control').toBeGreaterThan(0)
	}
	expectNoBrokenText(container)
}

/** An explanatory empty state with a next action, without the "filters" wording. */
export function expectEmptyState(container: HTMLElement, opts: { action?: RegExp; wording?: RegExp } = {}): void {
	const text = container.textContent
	expect(text, 'a list that is simply empty must not use the "no results match filters" wording').not.toMatch(FILTER_WORDING)
	expect(text.trim().length, 'empty state must not be blank').toBeGreaterThan(0)
	if (opts.wording) expect(text).toMatch(opts.wording)
	const actions = [...within(container).queryAllByRole('button'), ...within(container).queryAllByRole('link')]
	const names = actions.map((el) => el.textContent.trim()).filter(Boolean)
	if (opts.action) {
		expect(names.some((n) => opts.action?.test(n)), `empty state must offer a next action matching ${String(opts.action)}; found: ${names.join(' | ')}`).toBe(true)
	} else {
		expect(names.length, 'empty state must offer a next action (button or link)').toBeGreaterThan(0)
	}
	expectNoBrokenText(container)
}

/** The page is populated: some content, no error alert, no broken text. */
export function expectPopulated(container: HTMLElement): void {
	expect(container.textContent.trim().length).toBeGreaterThan(0)
	expect(within(container).queryAllByRole('alert'), 'a populated page must not show an error alert').toHaveLength(0)
	expectNoBrokenText(container)
}

export function queryControl(name: RegExp) {
	return screen.queryAllByRole('button', { name }).concat(screen.queryAllByRole('link', { name }))
}
