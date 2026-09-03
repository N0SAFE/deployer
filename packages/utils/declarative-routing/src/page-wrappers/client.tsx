'use client'

/**
 * Client-side page wrapper utilities
 *
 * This file provides the client implementations that:
 * 1. Read URL params and search state via Next.js's router hooks
 *    (no `React.use()` of Promise props — those are kept for backward
 *    compatibility on the server, but on the client we now go
 *    straight to the live URL via `useSafeQueryParamStatesFromZod`).
 * 2. Validate the raw values with the provided Zod schemas.
 * 3. Use the `useSession` hook from the configured client auth adapter.
 */

import React, { Suspense } from 'react'
import { useParams as useNextParams, useRouter } from 'next/navigation'
import queryString from 'query-string'
import { z } from 'zod'

import { useSafeQueryParamStatesFromZod } from '@repo/use-safe-query-param-states-from-zod'

import type {
} from "../types";
import { isRecord, isObjectLike } from "@repo/type-guards";
import type {
    Session,
    ClientAuthAdapter,
    ClientSessionProps,
    SessionOptions,
    SchemasConfig,
    UnwrappedPageProps,
    BasePageProps,
    RouteNavigationInput,
    RouteNavigationOptions,
    RouteRuntimeConfig,
    PageRouteHelpers,
    RouteSearchPatch,
} from '../types'

// ============================================================================
// Configuration - Must be set before using session wrappers
// ============================================================================

let clientAuthAdapter: ClientAuthAdapter | null = null

/**
 * Configure the client-side auth adapter.
 * Must be called before using client session wrappers.
 */

/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys. Used in place of `as Record<string, unknown>`
 * to avoid the runtime lie.
 */
export function configureClientAuth(adapter: ClientAuthAdapter): void {
    clientAuthAdapter = adapter
}

function getClientAuthAdapter(): ClientAuthAdapter {
    if (!clientAuthAdapter) {
        throw new Error(
            'Client auth adapter not configured. Call configureClientAuth() before using client session wrappers.'
        )
    }
    return clientAuthAdapter
}

// ============================================================================
// Types for Next.js page props (Promise-based)
// ============================================================================

type NextPagePropsInternal<
    Params extends z.ZodType = z.ZodType,
    Search extends z.ZodType = z.ZodType,
> = {
    params: Promise<z.output<Params>>
    searchParams: Promise<z.output<Search>>
}

// ============================================================================
// Helper Functions
// ============================================================================

function asPageComponent<T>(component: React.ComponentType<T>): React.ComponentType<T> {
    return component
}

function extractAdditionalProps<T extends object>(
    props: T
): Omit<T, 'params' | 'searchParams' | 'children' | 'route'> {
    const { params, searchParams, children, route, ...rest } = props as T & {
        params?: unknown
        searchParams?: unknown
        children?: unknown
        route?: unknown
    }
    void params
    void searchParams
    void children
    void route
    return rest
}

function normalizeRecord(value: unknown): Record<string, unknown> {
    if (typeof value === 'object' && value !== null) {
        return value as Record<string, unknown>
    }
    return {}
}

function isZodObjectSchema(
    schema: z.ZodType
): schema is z.ZodObject<z.ZodRawShape> {
    return (
        typeof schema === 'object' &&
        schema !== null &&
        'shape' in schema &&
        typeof (schema as { shape?: unknown }).shape === 'object' &&
        (schema as { shape?: unknown }).shape !== null
    )
}

function fallbackBuildUrl(
    path: string,
    search?: Record<string, unknown>
): string {
    const query = queryString.stringify(search ?? {}, {
        skipNull: true,
        skipEmptyString: true,
    })
    return query ? `${path}?${query}` : path
}

// ============================================================================
// Route helpers
// ============================================================================

/**
 * Client-side route helpers. Reads the live URL state via
 * `useSafeQueryParamStatesFromZod` (and Next.js's `useParams`) and
 * exposes typed setters to update either the URL path parameters
 * (via `router.push`/`router.replace`ad) or the search/query string
 * (via the nuqs-backed setter).
 */
function useClientRouteHelpers<
    Params extends z.ZodType,
    Search extends z.ZodType,
>(
    schemas: SchemasConfig<Params, Search>,
    runtime: RouteRuntimeConfig<Params, Search> | undefined,
    router: ReturnType<typeof useRouter>
): {
    params: z.output<Params>
    search: z.output<Search>
    route: PageRouteHelpers<Params, Search>
} {
    // Live URL path parameters (Next.js).
    const rawNextParams = useNextParams()
    const parsedParams = schemas.params.safeParse(rawNextParams)
    const params: z.output<Params> = parsedParams.success
        ? parsedParams.data
        : schemas.params.parse({})

    // Live URL search state (nuqs-backed, fully reactive).
    const searchSchema = schemas.search
    const [search, setSearchParamsRaw] = ((): [
        z.output<Search>,
        (value: z.input<Search> | null) => void,
    ] => {
        if (isZodObjectSchema(searchSchema)) {
            const [state, setter] = useSafeQueryParamStatesFromZod(searchSchema)
            return [
                state,
                setter as unknown as (value: z.input<Search> | null) => void,
            ]
        }
        // Fallback for non-object schemas: read from URL on demand.
        const fallback = searchSchema.parse(
            normalizeRecord(rawNextParams)
        )
        return [fallback, () => undefined]
    })()

    const buildUrl = React.useCallback(
        (nextParams?: z.input<Params>, nextSearch?: z.input<Search>) => {
            if (runtime?.buildUrl) {
                return runtime.buildUrl(nextParams, nextSearch)
            }
            const pathname =
                runtime?.routePath ??
                (typeof window !== 'undefined' ? window.location.pathname : '')
            return fallbackBuildUrl(pathname, normalizeRecord(nextSearch))
        },
        [runtime]
    )

    const push = React.useCallback(
        (
            input?: RouteNavigationInput<Params, Search>,
            options?: RouteNavigationOptions
        ) => {
            const href = buildUrl(
                (input?.params ?? (params as z.input<Params>)),
                (input?.search ?? (search as z.input<Search>))
            )
            router.push(href, { scroll: options?.scroll })
            return href
        },
        [buildUrl, params, router, search]
    )

    const replace = React.useCallback(
        (
            input?: RouteNavigationInput<Params, Search>,
            options?: RouteNavigationOptions
        ) => {
            const href = buildUrl(
                (input?.params ?? (params as z.input<Params>)),
                (input?.search ?? (search as z.input<Search>))
            )
            router.replace(href, { scroll: options?.scroll })
            return href
        },
        [buildUrl, params, router, search]
    )

    const setParams = React.useCallback(
        (
            value: z.input<Params> | null,
            options?: RouteNavigationOptions
        ): Promise<string> => {
            const nextParams =
                value ?? (schemas.params.parse({}) as z.input<Params>)
            const href = buildUrl(nextParams, search as z.input<Search>)
            router.replace(href, { scroll: options?.scroll })
            return Promise.resolve(href)
        },
        [buildUrl, router, schemas.params, search]
    )

    const searchUpdate = React.useCallback(
        (patch: RouteSearchPatch<Search> | null) => {
            const next: Record<string, unknown> = { ...normalizeRecord(search) }
            if (patch && typeof patch === 'object') {
                for (const [key, val] of Object.entries(patch)) {
                    if (val === null || val === undefined) {
                        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                        delete next[key]
                    } else {
                        next[key] = val
                    }
                }
            }
            setSearchParamsRaw(next as z.input<Search>)
            const href = buildUrl(params as z.input<Params>, next as z.input<Search>)
            return Promise.resolve(href)
        },
        [buildUrl, params, search, setSearchParamsRaw]
    )

    const searchReplace = React.useCallback(
        (value: z.input<Search> | null) => {
            setSearchParamsRaw(value)
            const href = buildUrl(
                params as z.input<Params>,
                (value ?? ({} as z.input<Search>))
            )
            return Promise.resolve(href)
        },
        [buildUrl, params, setSearchParamsRaw]
    )

    const searchReset = React.useCallback(() => {
        setSearchParamsRaw(null)
        const href = buildUrl(params as z.input<Params>, {} as z.input<Search>)
        return Promise.resolve(href)
    }, [buildUrl, params, setSearchParamsRaw])

    const setSearchParams = React.useCallback(
        (value: z.input<Search> | null) => {
            setSearchParamsRaw(value)
        },
        [setSearchParamsRaw]
    )

    const route = React.useMemo<PageRouteHelpers<Params, Search>>(
        () => ({
            routePath: runtime?.routePath,
            routeName: runtime?.routeName,
            params,
            search,
            urlBuilder: buildUrl,
            buildUrl,
            push,
            replace,
            setParams,
            setSearchParams,
            setSearch: searchReplace,
            searchUpdate,
            searchReplace,
            searchReset,
        }),
        [
            buildUrl,
            params,
            push,
            replace,
            runtime?.routeName,
            runtime?.routePath,
            search,
            searchReplace,
            searchReset,
            searchUpdate,
            setParams,
            setSearchParams,
        ]
    )

    return { params, search, route }
}

// ============================================================================
// Page Wrappers
// ============================================================================

/**
 * Creates a client page wrapper that validates params/search and exposes
 * reactive setters through the `route` helper.
 *
 * The inner component uses `useSafeQueryParamStatesFromZod` directly so
 * the wrapper participates in the live URL state (no extra navigation
 * for query updates).
 */
export function createPage<
    Params extends z.ZodType,
    Search extends z.ZodType,
    AdditionalProps extends object = object,
>(
    schemas: SchemasConfig<Params, Search>,
    Component: React.ComponentType<UnwrappedPageProps<Params, Search> & AdditionalProps>,
    runtime?: RouteRuntimeConfig<Params, Search>
): React.ComponentType<NextPagePropsInternal<Params, Search> & BasePageProps & AdditionalProps> {
    type WrapperProps = NextPagePropsInternal<Params, Search> & BasePageProps & AdditionalProps

    function InnerComponent(props: WrapperProps): React.ReactNode {
        const router = useRouter()
        const { params, search, route } = useClientRouteHelpers<Params, Search>(
            schemas,
            runtime,
            router
        )
        const additionalProps = extractAdditionalProps(props)

        const componentProps: UnwrappedPageProps<Params, Search> & AdditionalProps = {
            ...(additionalProps as AdditionalProps),
            params,
            searchParams: search,
            route,
        }

        return <Component {...componentProps} />
    }

    function WrappedComponent(props: WrapperProps): React.ReactNode {
        return (
            <Suspense fallback={null}>
                <InnerComponent {...props} />
            </Suspense>
        )
    }

    const displayName = (Component as { displayName?: string; name?: string }).displayName
        ?? (Component as { name?: string }).name
        ?? 'Component'
    WrappedComponent.displayName = `ClientPage(${displayName})`

    return asPageComponent<WrapperProps>(WrappedComponent)
}

/**
 * Helper to wrap a page component with type-safe params/search unwrapping.
 * This is the HOC pattern version of createPage.
 */
export function withPage<
    Params extends z.ZodType,
    Search extends z.ZodType,
>(
    paramsSchema: Params,
    searchSchema: Search
) {
    return function wrapper<AdditionalProps extends object = object>(
        Component: React.ComponentType<UnwrappedPageProps<Params, Search> & AdditionalProps>
    ): React.ComponentType<NextPagePropsInternal<Params, Search> & BasePageProps & AdditionalProps> {
        return createPage({ params: paramsSchema, search: searchSchema }, Component) as React.ComponentType<NextPagePropsInternal<Params, Search> & BasePageProps & AdditionalProps>
    }
}

// ============================================================================
// Session Page Wrappers
// ============================================================================

/**
 * Creates a client-side session-aware page wrapper.
 */
export function createSessionPage<
    Params extends z.ZodType,
    Search extends z.ZodType,
    AdditionalProps extends object = object,
    S extends Session = Session,
>(
    schemas: SchemasConfig<Params, Search>,
    Component: React.ComponentType<
        UnwrappedPageProps<Params, Search> &
        AdditionalProps &
        ClientSessionProps<S>
    >,
    _options?: SessionOptions,
    runtime?: RouteRuntimeConfig<Params, Search>
): React.ComponentType<NextPagePropsInternal<Params, Search> & BasePageProps & Omit<AdditionalProps, keyof ClientSessionProps<S>>> {
    void _options

    type WrapperProps = NextPagePropsInternal<Params, Search> & BasePageProps & Omit<AdditionalProps, keyof ClientSessionProps<S>>

    function InnerComponent(props: WrapperProps): React.ReactNode {
        const authAdapter = getClientAuthAdapter()
        const sessionHook = authAdapter.useSession()
        const router = useRouter()
        const { params, search, route } = useClientRouteHelpers<Params, Search>(
            schemas,
            runtime,
            router
        )
        const additionalProps = extractAdditionalProps(props)

        const componentProps = {
            ...(additionalProps as AdditionalProps),
            params,
            searchParams: search,
            route,
            session: sessionHook.data ?? null,
            isLoading: sessionHook.isPending === true,
            refetch: () => { void sessionHook.refetch() },
        } as UnwrappedPageProps<Params, Search> & AdditionalProps & ClientSessionProps<S>

        return <Component {...componentProps} />
    }

    function WrappedComponent(props: WrapperProps): React.ReactNode {
        return (
            <Suspense fallback={null}>
                <InnerComponent {...props} />
            </Suspense>
        )
    }

    const displayName = (Component as { displayName?: string; name?: string }).displayName
        ?? (Component as { name?: string }).name
        ?? 'Component'
    WrappedComponent.displayName = `ClientSessionPage(${displayName})`

    return asPageComponent<WrapperProps>(WrappedComponent)
}

// ============================================================================
// HOC for Session Wrapping
// ============================================================================

/**
 * Higher-Order Component that wraps a component with session access.
 */
export function withClientSession<
    P extends ClientSessionProps<S>,
    S extends Session = Session,
>(
    WrappedComponent: React.ComponentType<P>
): React.ComponentType<Omit<P, keyof ClientSessionProps<S>>> {
    function WithSessionComponent(props: Omit<P, keyof ClientSessionProps<S>>): React.ReactNode {
        const authAdapter = getClientAuthAdapter()
        const sessionHook = authAdapter.useSession()

        const enhancedProps = {
            ...props,
            session: sessionHook.data ?? null,
            isLoading: sessionHook.isPending === true,
            refetch: () => { void sessionHook.refetch() },
        } as P

        return <WrappedComponent {...enhancedProps} />
    }

    const displayName = (WrappedComponent as { displayName?: string; name?: string }).displayName
        ?? (WrappedComponent as { name?: string }).name
        ?? 'Component'
    WithSessionComponent.displayName = `WithClientSession(${displayName})`

    return WithSessionComponent
}

// ============================================================================
// Factory Pattern
// ============================================================================

export type CreatePageWrappersConfig<S extends Session = Session> = {
    auth: ClientAuthAdapter
    _sessionType?: S
}

export function createPageWrappers<S extends Session = Session>(
    config: CreatePageWrappersConfig<S>
) {
    configureClientAuth(config.auth)

    return {
        createPage,
        createSessionPage: <
            Params extends z.ZodType,
            Search extends z.ZodType,
            AdditionalProps extends object = object,
        >(
            schemas: SchemasConfig<Params, Search>,
            Component: React.ComponentType<
                UnwrappedPageProps<Params, Search> &
                AdditionalProps &
                ClientSessionProps<S>
            >,
            options?: SessionOptions,
            runtime?: RouteRuntimeConfig<Params, Search>
        ) => createSessionPage<Params, Search, AdditionalProps, S>(
            schemas,
            Component,
            options,
            runtime
        ),
    }
}

// Re-export types
export type { z }
export type {
    Session,
    ClientAuthAdapter,
    ClientSessionProps,
    SessionOptions,
    SchemasConfig,
    UnwrappedPageProps,
    BasePageProps,
    RouteRuntimeConfig,
} from '../types'
