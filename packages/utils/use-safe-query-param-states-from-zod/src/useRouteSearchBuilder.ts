/**
 * Convenience wrapper that combines the Zod-driven search state hook
 * with a `RouteBuilder` and exposes navigation helpers (`push`,
 * `replace`, `reset`, `buildUrl`).
 *
 * The goal is to keep the public surface tiny while giving consumers
 * everything they need to read, write, and navigate URL search state
 * in a single call.
 */
import { useRouter, usePathname } from 'next/navigation'
import { useCallback, useMemo } from 'react'
import type { z } from 'zod'

import { mergeWithDefaults } from './merge'
import { useSafeQueryParamStatesFromZod } from './useSafeQueryParamStatesFromZod'
import type { UnknownRecord, UseSafeQueryParamStatesOptions } from './types'

/**
 * Minimal shape of a route builder the helpers understand. The
 * declarative-routing `RouteBuilder` satisfies this without further
 * changes.
 */
export interface RouteBuilderLike<TSearch extends z.ZodObject> {
    searchSchema: TSearch
    /**
     * Optional URL builder. When omitted, helpers fall back to
     * `pathname + queryString`.
     */
    buildUrl?: (search: Partial<z.infer<TSearch>>) => string
}

export interface UseRouteSearchBuilderOptions
    extends UseSafeQueryParamStatesOptions {
    /**
     * Override the base path used by `buildRelativeUrl` when the route
     * builder does not provide one. Defaults to the current pathname.
     */
    basePath?: string
}

export interface UseRouteSearchBuilderReturn<TSearch extends z.ZodObject> {
    state: z.infer<TSearch>
    setState: ReturnType<
        typeof useSafeQueryParamStatesFromZod<TSearch>
    >[1]
    buildUrl: (patch?: Partial<z.infer<TSearch>>) => string
    buildRelativeUrl: (patch?: Partial<z.infer<TSearch>>) => string
    navigate: (
        patch?: Partial<z.infer<TSearch>>,
        options?: { replace?: boolean; scroll?: boolean }
    ) => void
    replace: (
        patch?: Partial<z.infer<TSearch>>,
        options?: { scroll?: boolean }
    ) => void
    push: (
        patch?: Partial<z.infer<TSearch>>,
        options?: { scroll?: boolean }
    ) => void
    reset: () => void
    merge: (patch: Partial<z.infer<TSearch>>) => void
}

function serializeSearch(search: UnknownRecord): string {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(search)) {
        if (value === null || value === undefined) continue
        if (Array.isArray(value)) {
            for (const item of value) {
                if (item === null || item === undefined) continue
                params.append(key, String(item))
            }
        } else if (typeof value === 'object') {
            params.set(key, JSON.stringify(value))
        } else {
            params.set(key, String(value))
        }
    }
    return params.toString()
}

/**
 * Read/write/search-navigate a route's URL search state from a single
 * hook. Returns both the reactive state and a `buildUrl` helper for
 * programmatic links.
 */
export function useRouteSearchBuilder<TSearch extends z.ZodObject>(
    route: RouteBuilderLike<TSearch>,
    options?: UseRouteSearchBuilderOptions
): UseRouteSearchBuilderReturn<TSearch> {
    const router = useRouter()
    const pathname = usePathname()
    const basePath = options?.basePath ?? pathname

    const [state, setState] = useSafeQueryParamStatesFromZod<TSearch>(
        route.searchSchema,
        options
    )

    const buildUrl = useCallback(
        (patch?: Partial<z.infer<TSearch>>) => {
            if (route.buildUrl) {
                return route.buildUrl(patch ?? {})
            }
            const merged = mergeWithDefaults(
                route.searchSchema,
                patch ? { ...(state as UnknownRecord), ...patch } : (state as UnknownRecord)
            )
            const query = serializeSearch(merged as UnknownRecord)
            return query ? `${basePath}?${query}` : basePath
        },
        [route, state, basePath]
    )

    const buildRelativeUrl = useCallback(
        (patch?: Partial<z.infer<TSearch>>) => {
            const merged = mergeWithDefaults(
                route.searchSchema,
                patch ? { ...(state as UnknownRecord), ...patch } : (state as UnknownRecord)
            )
            const query = serializeSearch(merged as UnknownRecord)
            return query ? `?${query}` : ''
        },
        [route, state]
    )

    const navigate = useCallback(
        (
            patch?: Partial<z.infer<TSearch>>,
            navOptions?: { replace?: boolean; scroll?: boolean }
        ) => {
            const href = buildUrl(patch)
            if (navOptions?.replace) {
                router.replace(href, { scroll: navOptions.scroll })
            } else {
                router.push(href, { scroll: navOptions?.scroll })
            }
        },
        [buildUrl, router]
    )

    const push = useCallback(
        (patch?: Partial<z.infer<TSearch>>, navOptions?: { scroll?: boolean }) =>
            navigate(patch, { ...navOptions, replace: false }),
        [navigate]
    )

    const replace = useCallback(
        (patch?: Partial<z.infer<TSearch>>, navOptions?: { scroll?: boolean }) =>
            navigate(patch, { ...navOptions, replace: true }),
        [navigate]
    )

    const reset = useCallback(() => setState(null), [setState])
    const merge = useCallback(
        (patch: Partial<z.infer<TSearch>>) => setState(patch),
        [setState]
    )

    return useMemo(
        () => ({
            state,
            setState,
            buildUrl,
            buildRelativeUrl,
            navigate,
            replace,
            push,
            reset,
            merge,
        }),
        [state, setState, buildUrl, buildRelativeUrl, navigate, replace, push, reset, merge]
    )
}
