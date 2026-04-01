'use client'

/**
 * Client-side routing hooks for declarative routing.
 * 
 * These hooks provide type-safe access to route parameters,
 * search parameters, and programmatic navigation.
 * 
 * All hooks work with RouteBuilder instances to ensure type safety.
 */

import { useCallback, useMemo } from 'react'
import { useParams as useNextParams, useRouter, useSearchParams as useNextSearchParams } from 'next/navigation'
import { z } from 'zod'
import {
    createParser,
    parseAsArrayOf,
    parseAsBoolean,
    parseAsFloat,
    parseAsInteger,
    parseAsJson,
    parseAsNumberLiteral,
    parseAsString,
    parseAsStringLiteral,
    useQueryStates,
    type Options as NuqsOptions,
    type SingleParserBuilder,
} from 'nuqs'
import NProgress from 'nprogress'
import queryString from 'query-string'
import type { RouteBuilder } from './make-route'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for the usePush hook.
 */
type UsePushOptions<
    Params extends z.ZodType,
    Search extends z.ZodType,
> = {
    params?: z.input<Params>
    search?: z.input<Search>
}

/**
 * Return type for usePush hook.
 */
type UsePushReturn<
    Params extends z.ZodType,
    Search extends z.ZodType,
> = (options?: UsePushOptions<Params, Search>) => void

type ZodObjectSearchSchema = z.ZodObject<z.ZodRawShape>
type NuqsParserBuilder = SingleParserBuilder<unknown>

/**
 * Options accepted by the nuqs-backed search state hook.
 *
 * Maps to `useQueryStates` options (history, shallow, scroll, etc.)
 * and optionally url key remapping.
 */
export type SearchStateOptions = Partial<NuqsOptions> & {
    urlKeys?: Record<string, string>
}

/**
 * Partial update payload for route search state.
 *
 * Values can be set to `null` to clear individual query params.
 */
export type SearchPatch<Search extends ZodObjectSearchSchema> = Partial<{
    [K in keyof z.input<Search>]: z.input<Search>[K] | null
}>

/**
 * Updater signature for route search state.
 */
export type SearchStateUpdater<Search extends ZodObjectSearchSchema> = (
    value: SearchPatch<Search> | null,
    options?: NuqsOptions
) => Promise<URLSearchParams>

/**
 * Helper methods returned with nuqs-backed search state.
 */
export type SearchStateHelpers<Search extends ZodObjectSearchSchema> = {
    /**
     * Merge a partial payload into current search params.
     */
    searchUpdate: SearchStateUpdater<Search>
    /**
     * Replace search state in one call.
     *
     * Any key not present in `value` remains unchanged by nuqs,
     * so use `searchReset` first if a hard reset is needed.
     */
    searchReplace: (
        value: z.input<Search> | SearchPatch<Search> | null,
        options?: NuqsOptions
    ) => Promise<URLSearchParams>
    /**
     * Clear all managed search params.
     */
    searchReset: (options?: NuqsOptions) => Promise<URLSearchParams>
}

type SearchSchemaCarrier<Search extends ZodObjectSearchSchema> = {
    searchSchema: Search
}

/**
 * Helper to extract search params from a RouteBuilder.
 */
type InferSearch<T> = T extends RouteBuilder<z.ZodType, infer S>
    ? z.output<S>
    : never

/**
 * Helper to extract params from a RouteBuilder.
 */
type InferParams<T> = T extends RouteBuilder<infer P, z.ZodType>
    ? z.output<P>
    : never

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

function isZodSchema(value: unknown): value is z.ZodType {
    return isRecord(value) && typeof value.safeParse === 'function'
}

function getSchemaDef(schema: z.ZodType): Record<string, unknown> {
    return schema.def as unknown as Record<string, unknown>
}

function getSchemaType(schema: z.ZodType): string {
    const typeValue = getSchemaDef(schema).type
    return typeof typeValue === 'string' ? typeValue : ''
}

function getInnerSchema(schema: z.ZodType): z.ZodType | null {
    const innerType = getSchemaDef(schema).innerType
    return isZodSchema(innerType) ? innerType : null
}

function unwrapZodSchema(schema: z.ZodType): z.ZodType {
    const wrapperTypes = new Set([
        'optional',
        'nullable',
        'default',
        'prefault',
        'nonoptional',
        'catch',
    ])

    let current = schema
    let currentType = getSchemaType(current)

    while (wrapperTypes.has(currentType)) {
        const innerSchema = getInnerSchema(current)
        if (!innerSchema) {
            return current
        }
        current = innerSchema
        currentType = getSchemaType(current)
    }

    return current
}

function extractSchemaDefaultValue(schema: z.ZodType): unknown {
    const schemaType = getSchemaType(schema)
    const schemaDef = getSchemaDef(schema)

    if (schemaType === 'default' || schemaType === 'prefault') {
        const defaultValue = schemaDef.defaultValue
        return typeof defaultValue === 'function'
            ? (defaultValue as () => unknown)()
            : defaultValue
    }

    const innerSchema = getInnerSchema(schema)
    if (!innerSchema) {
        return undefined
    }

    return extractSchemaDefaultValue(innerSchema)
}

function extractObjectShape(
    schema: ZodObjectSearchSchema
): Record<string, z.ZodType> {
    const shapeCandidate = getSchemaDef(schema).shape

    const normalize = (value: unknown): Record<string, z.ZodType> => {
        if (!isRecord(value)) {
            return {}
        }

        const entries = Object.entries(value)
        const result: Record<string, z.ZodType> = {}
        for (const [key, maybeSchema] of entries) {
            if (isZodSchema(maybeSchema)) {
                result[key] = maybeSchema
            }
        }
        return result
    }

    if (typeof shapeCandidate === 'function') {
        return normalize((shapeCandidate as () => unknown)())
    }

    return normalize(shapeCandidate)
}

function isIntegerNumberSchema(schema: z.ZodType): boolean {
    const checks = getSchemaDef(schema).checks
    if (!Array.isArray(checks)) {
        return false
    }

    return checks.some((check) => {
        if (!isRecord(check)) {
            return false
        }

        if (typeof check.isInt === 'boolean') {
            return check.isInt
        }

        if (isRecord(check.def) && typeof check.def.format === 'string') {
            return /int/i.test(check.def.format)
        }

        return false
    })
}

function isEqualByValue(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) {
        return true
    }

    if (!isRecord(a) || !isRecord(b)) {
        return false
    }

    try {
        return JSON.stringify(a) === JSON.stringify(b)
    } catch {
        return false
    }
}

function createFallbackParser(schema: z.ZodType): NuqsParserBuilder {
    return createParser<unknown>({
        parse: (value: string) => {
            const candidates: unknown[] = [value]
            const trimmed = value.trim()

            if (trimmed === 'true') {
                candidates.push(true)
            } else if (trimmed === 'false') {
                candidates.push(false)
            }

            if (trimmed.length > 0) {
                const numberValue = Number(trimmed)
                if (!Number.isNaN(numberValue)) {
                    candidates.push(numberValue)
                }

                try {
                    candidates.push(JSON.parse(trimmed) as unknown)
                } catch {
                    // noop
                }
            }

            for (const candidate of candidates) {
                const parsed = schema.safeParse(candidate)
                if (parsed.success) {
                    return parsed.data
                }
            }

            return null
        },
        serialize: (value: unknown) => {
            const parsed = schema.safeParse(value)
            const nextValue = parsed.success ? parsed.data : value

            if (
                typeof nextValue === 'string' ||
                typeof nextValue === 'number' ||
                typeof nextValue === 'boolean' ||
                typeof nextValue === 'bigint'
            ) {
                return String(nextValue)
            }

            return JSON.stringify(nextValue)
        },
        eq: isEqualByValue,
    }) as NuqsParserBuilder
}

function createParserForSchema(
    schema: z.ZodType,
    includeDefault = true
): NuqsParserBuilder {
    const defaultValue = includeDefault
        ? extractSchemaDefaultValue(schema)
        : undefined
    const unwrappedSchema = unwrapZodSchema(schema)
    const schemaType = getSchemaType(unwrappedSchema)

    let parser: NuqsParserBuilder

    switch (schemaType) {
        case 'string':
            parser = parseAsString as NuqsParserBuilder
            break
        case 'number':
            parser = (
                isIntegerNumberSchema(unwrappedSchema)
                    ? parseAsInteger
                    : parseAsFloat
            ) as NuqsParserBuilder
            break
        case 'boolean':
            parser = parseAsBoolean as NuqsParserBuilder
            break
        case 'enum': {
            const entriesValue = getSchemaDef(unwrappedSchema).entries
            if (isRecord(entriesValue)) {
                const enumValues = Object.values(entriesValue).filter(
                    (value): value is string => typeof value === 'string'
                )

                if (enumValues.length > 0) {
                    parser = parseAsStringLiteral(
                        enumValues as readonly string[]
                    ) as NuqsParserBuilder
                    break
                }
            }

            parser = createFallbackParser(unwrappedSchema)
            break
        }
        case 'literal': {
            const literalValues = getSchemaDef(unwrappedSchema).values

            if (Array.isArray(literalValues) && literalValues.length > 0) {
                const stringValues = literalValues.filter(
                    (value): value is string => typeof value === 'string'
                )
                if (stringValues.length === literalValues.length) {
                    parser = parseAsStringLiteral(
                        stringValues as readonly string[]
                    ) as NuqsParserBuilder
                    break
                }

                const numberValues = literalValues.filter(
                    (value): value is number =>
                        typeof value === 'number' && Number.isFinite(value)
                )
                if (numberValues.length === literalValues.length) {
                    parser = parseAsNumberLiteral(
                        numberValues as readonly number[]
                    ) as NuqsParserBuilder
                    break
                }
            }

            parser = createFallbackParser(unwrappedSchema)
            break
        }
        case 'array': {
            const elementSchema = getSchemaDef(unwrappedSchema).element
            const elementParser = isZodSchema(elementSchema)
                ? createParserForSchema(elementSchema, false)
                : (parseAsString as NuqsParserBuilder)

            parser = parseAsArrayOf(elementParser) as NuqsParserBuilder
            break
        }
        case 'object':
            parser = parseAsJson((value: unknown) => {
                const parsed = unwrappedSchema.safeParse(value)
                return parsed.success ? parsed.data : null
            }) as NuqsParserBuilder
            break
        default:
            parser = createFallbackParser(unwrappedSchema)
            break
    }

    if (defaultValue !== undefined && defaultValue !== null) {
        return parser.withDefault(defaultValue as never) as NuqsParserBuilder
    }

    return parser
}

function buildNuqsParserMap(
    searchSchema: ZodObjectSearchSchema
): Record<string, NuqsParserBuilder> {
    const shape = extractObjectShape(searchSchema)
    const parserMap: Record<string, NuqsParserBuilder> = {}

    for (const [key, fieldSchema] of Object.entries(shape)) {
        parserMap[key] = createParserForSchema(fieldSchema)
    }

    return parserMap
}

function buildSchemaDefaults(
    searchSchema: ZodObjectSearchSchema
): Record<string, unknown> {
    const shape = extractObjectShape(searchSchema)
    const defaults: Record<string, unknown> = {}

    for (const [key, fieldSchema] of Object.entries(shape)) {
        const defaultValue = extractSchemaDefaultValue(fieldSchema)
        if (defaultValue !== undefined) {
            defaults[key] = defaultValue
        }
    }

    return defaults
}

function normalizeSearchState<Search extends ZodObjectSearchSchema>(
    searchSchema: Search,
    rawSearchState: Record<string, unknown>,
    defaultSearchState: Record<string, unknown>
): z.output<Search> {
    const mergedState: Record<string, unknown> = { ...defaultSearchState }

    for (const [key, value] of Object.entries(rawSearchState)) {
        if (value !== null && value !== undefined) {
            mergedState[key] = value
        }
    }

    const mergedResult = searchSchema.safeParse(mergedState)
    if (mergedResult.success) {
        return mergedResult.data
    }

    const rawResult = searchSchema.safeParse(rawSearchState)
    if (rawResult.success) {
        return rawResult.data
    }

    console.warn(
        'Failed to normalize search state from query params:',
        mergedResult.error
    )

    return mergedState as z.output<Search>
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook for programmatic navigation with type safety.
 * 
 * Uses NProgress to show loading indicator during navigation.
 * 
 * @example
 * ```tsx
 * import { usePush } from '@repo/declarative-routing/hooks'
 * import { ProductDetail } from '@/routes'
 * 
 * function MyComponent() {
 *   const push = usePush(ProductDetail)
 *   
 *   const handleClick = () => {
 *     push({
 *       params: { productId: '123' },
 *       search: { tab: 'reviews' }
 *     })
 *   }
 *   
 *   return <button onClick={handleClick}>View Product</button>
 * }
 * ```
 */
export function usePush<
    Params extends z.ZodType,
    Search extends z.ZodType,
>(
    route: RouteBuilder<Params, Search>
): UsePushReturn<Params, Search> {
    const router = useRouter()

    return useCallback(
        (options?: UsePushOptions<Params, Search>) => {
            const params = options?.params ?? {}
            const search = options?.search ?? {}
            
            // Build the URL using route's buildUrl function
            let url: string
            if (typeof route.buildUrl === 'function') {
                url = route.buildUrl(params as z.input<Params>, search as z.input<Search>)
            } else {
                // Fallback: construct URL manually
                let pathname = route.routePath
                
                // Replace path params
                for (const [key, value] of Object.entries(params)) {
                    pathname = pathname.replace(`[${key}]`, String(value))
                    pathname = pathname.replace(`[...${key}]`, String(value))
                }
                
                // Add search params
                const searchStr = queryString.stringify(search as Record<string, unknown>, {
                    skipNull: true,
                    skipEmptyString: true,
                })
                
                url = searchStr ? `${pathname}?${searchStr}` : pathname
            }

            NProgress.start()
            router.push(url)
        },
        [router, route]
    )
}

/**
 * Hook to get type-safe route parameters.
 * 
 * Parses the current route params using the route's param schema.
 * 
 * @example
 * ```tsx
 * import { useParams } from '@repo/declarative-routing/hooks'
 * import { ProductDetail } from '@/routes'
 * 
 * function ProductPage() {
 *   const params = useParams(ProductDetail)
 *   // params.productId is typed as string
 *   return <div>Product ID: {params.productId}</div>
 * }
 * ```
 */
export function useParams<Route extends RouteBuilder<z.ZodType, z.ZodType>>(
    route: Route
): InferParams<Route> {
    const rawParams = useNextParams()
    
    return useMemo(() => {
        if (route.paramsSchema === emptySchema) {
            return {} as InferParams<Route>
        }
        
        const result = route.paramsSchema.safeParse(rawParams)
        if (result.success) {
            return result.data as InferParams<Route>
        }
        
        // Return empty object on parse failure (better than throwing in render)
        console.warn('Failed to parse route params:', result.error)
        return {} as InferParams<Route>
    }, [rawParams, route.paramsSchema])
}

/**
 * Hook to get type-safe search parameters.
 * 
 * Parses the current search params using the route's search schema.
 * 
 * @example
 * ```tsx
 * import { useSearchParams } from '@repo/declarative-routing/hooks'
 * import { ProductList } from '@/routes'
 * 
 * function ProductListPage() {
 *   const search = useSearchParams(ProductList)
 *   // search.page is typed as number | undefined
 *   // search.category is typed as string | undefined
 *   return <div>Page: {search.page ?? 1}</div>
 * }
 * ```
 */
export function useSearchParams<Route extends RouteBuilder<z.ZodType, z.ZodType>>(
    route: Route
): InferSearch<Route> {
    const rawSearchParams = useNextSearchParams()
    
    return useMemo(() => {
        if (route.searchSchema === emptySchema) {
            return {} as InferSearch<Route>
        }
        
        // Convert URLSearchParams to plain object
        const searchObj: Record<string, string | string[]> = {}
        rawSearchParams.forEach((value, key) => {
            const existing = searchObj[key]
            if (existing) {
                if (Array.isArray(existing)) {
                    existing.push(value)
                } else {
                    searchObj[key] = [existing, value]
                }
            } else {
                searchObj[key] = value
            }
        })
        
        const result = route.searchSchema.safeParse(searchObj)
        if (result.success) {
            return result.data as InferSearch<Route>
        }
        
        // Return empty object on parse failure
        console.warn('Failed to parse search params:', result.error)
        return {} as InferSearch<Route>
    }, [rawSearchParams, route.searchSchema])
}

/**
 * Hook for nuqs-backed search state management for an entire route search schema.
 *
 * It derives nuqs parsers directly from the route's Zod search schema,
 * returns a typed search object, and exposes partial update helpers.
 *
 * @example
 * ```tsx
 * import { useSearchState } from '@repo/declarative-routing/hooks'
 * import { ProductList } from '@/routes'
 *
 * function ProductListPage() {
 *   const [search, searchUpdate, { searchReset }] = useSearchState(ProductList)
 *
 *   return (
 *     <button onClick={() => void searchUpdate({ page: (search.page ?? 1) + 1 })}>
 *       Next page
 *     </button>
 *   )
 * }
 * ```
 */
export function useSearchState<
    Search extends ZodObjectSearchSchema,
>(
    route: SearchSchemaCarrier<Search>,
    options?: SearchStateOptions
): readonly [z.output<Search>, SearchStateUpdater<Search>, SearchStateHelpers<Search>] {
    const parserMap = useMemo(
        () => buildNuqsParserMap(route.searchSchema),
        [route.searchSchema]
    )

    const defaultSearchState = useMemo(
        () => buildSchemaDefaults(route.searchSchema),
        [route.searchSchema]
    )

    const [rawSearchState, setRawSearchState] = useQueryStates(parserMap, options)

    const searchState = useMemo(
        () =>
            normalizeSearchState(
                route.searchSchema,
                rawSearchState as Record<string, unknown>,
                defaultSearchState
            ),
        [defaultSearchState, rawSearchState, route.searchSchema]
    )

    const searchUpdate = useCallback<SearchStateUpdater<Search>>(
        (value, updateOptions) => {
            if (value === null) {
                return setRawSearchState(null, updateOptions)
            }

            return setRawSearchState(
                (previousState) => ({
                    ...previousState,
                    ...value,
                }),
                updateOptions
            )
        },
        [setRawSearchState]
    )

    const searchReplace = useCallback<
        SearchStateHelpers<Search>['searchReplace']
    >(
        (value, updateOptions) =>
            setRawSearchState(
                value as Partial<Record<string, unknown>> | null,
                updateOptions
            ),
        [setRawSearchState]
    )

    const searchReset = useCallback<SearchStateHelpers<Search>['searchReset']>(
        (updateOptions) => setRawSearchState(null, updateOptions),
        [setRawSearchState]
    )

    const helpers = useMemo<SearchStateHelpers<Search>>(
        () => ({
            searchUpdate,
            searchReplace,
            searchReset,
        }),
        [searchReplace, searchReset, searchUpdate]
    )

    return [searchState, searchUpdate, helpers] as const
}

/**
 * Hook for managing a single search parameter with state-like API.
 * 
 * Returns the current value and a setter function that updates the URL.
 * 
 * @example
 * ```tsx
 * import { useSearchParamState } from '@repo/declarative-routing/hooks'
 * import { ProductList } from '@/routes'
 * 
 * function ProductListPage() {
 *   const [page, setPage] = useSearchParamState(ProductList, 'page')
 *   
 *   return (
 *     <div>
 *       <span>Page: {page ?? 1}</span>
 *       <button onClick={() => setPage((page ?? 0) + 1)}>Next</button>
 *     </div>
 *   )
 * }
 * ```
 */
export function useSearchParamState<
    Params extends z.ZodType,
    Search extends ZodObjectSearchSchema,
    K extends keyof z.output<Search>,
>(
    route: RouteBuilder<Params, Search>,
    key: K
): [
    z.output<Search>[K],
    (
        value: z.output<Search>[K] | null,
        options?: NuqsOptions
    ) => Promise<URLSearchParams>,
] {
    const [searchState, searchUpdate] = useSearchState(route)
    const value = searchState[key]

    const setValue = useCallback(
        (nextValue: z.output<Search>[K] | null, options?: NuqsOptions) => {
            const patch = {
                [key]: nextValue,
            } as SearchPatch<Search>

            return searchUpdate(patch, options)
        },
        [key, searchUpdate]
    )

    return [value, setValue]
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Empty Zod schema used as default for routes without params/search.
 */
export const emptySchema = z.object({})

// ============================================================================
// Re-exports
// ============================================================================

export type { RouteBuilder }
export { z }
