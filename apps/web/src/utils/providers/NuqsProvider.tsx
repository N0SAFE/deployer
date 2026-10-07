'use client'

/**
 * nuqs adapter for the Next.js App Router that performs no `usePathname()` read.
 *
 * ## Why this exists instead of `nuqs/adapters/next/app`
 *
 * The stock adapter calls `useRouter()`, `usePathname()` and `useSearchParams()`
 * inside `useNuqsNextAppRouterAdapter()` — the hook that builds the context value
 * every `useQueryState` / `useQueryStates` consumer reads. Because that hook runs
 * while the provider itself renders, its reads sit above every boundary an
 * application can declare, including the `<Suspense>` the stock adapter puts
 * around its own `NavigationSpy` sibling.
 *
 * With Cache Components enabled, `usePathname()` suspends during the prerender of
 * any route whose dynamic params are not statically known, and Next.js reports
 * `CLIENT_HOOK_DYNAMIC` once per such route. The `<Suspense>` recipe cannot
 * suppress it: Next.js only honours a boundary it can see in the component
 * stack, and React does not populate component stacks on the production server
 * prerender path.
 *
 * Next.js gates the two hooks differently, which is what makes this fix possible:
 *
 * | Hook | Behaviour during a client prerender |
 * |---|---|
 * | `usePathname()` | suspends **only** when `fallbackRouteParams.size > 0`, and is reported |
 * | `useSearchParams()` | suspends unconditionally, but is **not** reported |
 *
 * So dropping the `usePathname()` read removes the diagnostic while keeping
 * `useSearchParams()` intact — which is what preserves the existing prerender
 * behaviour: the search-params read still produces the same dynamic hole, so
 * routes stay `◐ (Partial Prerender)` and query state still streams exactly as
 * before.
 *
 * ## What is preserved
 *
 * | Concern | How |
 * |---|---|
 * | SSR / hydration query state | `useSearchParams()`, unchanged from the stock adapter |
 * | `shallow: true` updates | `history.pushState` / `replaceState` (no Next.js re-render) |
 * | `shallow: false` updates | `router.replace(url, { scroll: false })`, as stock |
 * | Back/forward navigation | Next.js router state, as stock |
 * | `pathname` | Left `undefined` — nuqs falls back to `location.pathname`, what `usePathname()` returns client-side |
 */

import { startTransition, useCallback, useOptimistic, type ReactElement, type ReactNode } from 'react'
import { ReadonlyURLSearchParams, useRouter, useSearchParams } from 'next/navigation'
import {
  renderQueryString,
  unstable_createAdapterProvider,
  type unstable_AdapterInterface,
  type unstable_UpdateUrlFunction,
} from 'nuqs/adapters/custom'

/**
 * nuqs issues three History calls per URL update; the rate limiter uses this to
 * size its window. Mirrors the stock adapter's constant.
 */
const NUM_HISTORY_CALLS_PER_UPDATE = 3

function renderURL(search: URLSearchParams): string {
  const { origin, pathname, hash } = location
  return origin + pathname + renderQueryString(search) + hash
}

function useNuqsAppRouterAdapter(): unstable_AdapterInterface {
  const router = useRouter()
  // The one read kept from the stock adapter. Next.js reports URL reads through
  // the `usePathname()` gate above, so this no longer produces diagnostics.
  //
  // `useOptimistic` mirrors the stock adapter: a `shallow: false` update also
  // triggers a router navigation, which is async, so the query state is applied
  // optimistically first to keep the UI in step with the URL.
  //
  // Next.js types `useSearchParams()` as `ReadonlyURLSearchParams`, so the
  // optimistic state must carry the same type; the new value has to be an
  // instance of it rather than a bare `URLSearchParams`.
  const [searchParams, setSearchParams] = useOptimistic(useSearchParams())

  const updateUrl = useCallback<unstable_UpdateUrlFunction>(
    (search, options) => {
      startTransition(() => {
        if (!options.shallow) {
          setSearchParams(new ReadonlyURLSearchParams(search))
        }

        const url = renderURL(search)
        // Argument 2 is the (ignored) document title. Argument 1 carries the
        // existing router state through, so a shallow URL rewrite does not
        // clobber the App Router's history entry. Called on `history` directly
        // (not detached) so the receiver is correct and the lint rule for
        // unbound methods stays satisfied.
        if (options.history === 'push') {
          history.pushState(history.state, '', url)
        } else {
          history.replaceState(history.state, '', url)
        }

        if (options.scroll) window.scrollTo(0, 0)
        if (!options.shallow) router.replace(url, { scroll: false })
      })
    },
    [router, setSearchParams]
  )

  return {
    searchParams,
    updateUrl,
    rateLimitFactor: NUM_HISTORY_CALLS_PER_UPDATE,
    autoResetQueueOnUpdate: false,
  }
}

const AdapterProvider = unstable_createAdapterProvider(useNuqsAppRouterAdapter)

export function NuqsAdapter({ children }: { children: ReactNode }): ReactElement {
  return <AdapterProvider>{children}</AdapterProvider>
}

export default NuqsAdapter
