/**
 * Guards the invariant that motivated this app's own nuqs adapter.
 *
 * `apps/web/src/utils/providers/NuqsProvider.tsx` replaces
 * `nuqs/adapters/next/app` because the stock adapter reads `usePathname()`
 * inside the hook that builds the adapter context value. That read happens
 * while the root layout renders, so it sits above every route boundary, and
 * Next.js reported `CLIENT_HOOK_DYNAMIC` once for each of the 22 dynamic-param
 * dashboard routes during prerender.
 *
 * The fix is only correct while BOTH of these hold:
 *
 *  1. The adapter module never calls `usePathname()`.
 *  2. The adapter is the one mounted in the root layout.
 *
 * A future edit that reaches for `usePathname()` (or reverts the import to the
 * stock adapter) would silently reintroduce 22 build diagnostics, because the
 * build still succeeds while logging them. These assertions make that failure
 * loud at unit-test speed instead of during a full production build.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const WEB_SRC = join(import.meta.dirname, '..', '..')
const ADAPTER = join(import.meta.dirname, 'NuqsProvider.tsx')
const ROOT_LAYOUT = join(WEB_SRC, 'app/layout.tsx')

function read(path: string): string {
    return readFileSync(path, 'utf-8')
}

describe('nuqs adapter — no root-layout URL-data reads', () => {
    it('does not read usePathname()', () => {
        const src = read(ADAPTER)
        // Strip comments so the doc block explaining why `usePathname()` is
        // avoided does not itself trip the assertion.
        const code = src
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '')

        expect(code).not.toContain('usePathname')
    })

    it('keeps useSearchParams() (the read that preserves prerender behaviour)', () => {
        const code = read(ADAPTER).replace(/\/\*[\s\S]*?\*\//g, '')
        expect(code).toContain('useSearchParams')
    })

    it('is the adapter mounted in the root layout', () => {
        const src = read(ROOT_LAYOUT)
        expect(src).toContain("from '@/utils/providers/NuqsProvider'")
        // The stock adapter must not come back — it reintroduces the diagnostics.
        expect(src).not.toContain("from 'nuqs/adapters/next/app'")
    })
})
