/**
 * @repo/use-safe-query-param-states-from-zod
 *
 * Type-safe, reactive access to a route's URL search state.
 *
 * The package re-exports:
 *  - `useSafeQueryParamStatesFromZod` — the core hook.
 *  - `useRouteSearchBuilder` — drop-in helper for routes.
 *  - `createParserForZodField` / `getZodObjectDefaults` / `mergeWithDefaults`
 *    — building blocks used by the hook, also exposed for advanced
 *    consumers.
 *
 * For backwards compatibility, the legacy names
 * `useSafeQueryStatesFromZod` and `QueryStateFromZodOptions` are also
 * re-exported.
 */
import { useSafeQueryParamStatesFromZod } from './useSafeQueryParamStatesFromZod'
import type { UseSafeQueryParamStatesOptions } from './types'

export {
    useSafeQueryParamStatesFromZod,
    type SetQueryParamState,
} from './useSafeQueryParamStatesFromZod'

export {
    useRouteSearchBuilder,
    type RouteBuilderLike,
    type UseRouteSearchBuilderOptions,
    type UseRouteSearchBuilderReturn,
} from './useRouteSearchBuilder'

export { createParserForZodField } from './parsers'
export { getZodObjectDefaults, getZodObjectShallowDefaults } from './defaults'
export { mergeWithDefaults } from './merge'
export { useDebouncedCallback } from './useDebouncedCallback'

export {
    getZodKind,
    getZodDefault,
    isZodInteger,
    unwrapZodSchema,
} from './schema'

export type {
    UseSafeQueryParamStatesOptions,
    ZodRawShapeSchema,
    UnknownRecord,
} from './types'

/**
 * Backwards-compatible aliases. The original `useSafeQueryStatesFromZod`
 * name and `QueryStateFromZodOptions` type are kept so existing
 * consumers keep working without code changes.
 */
export { useSafeQueryParamStatesFromZod as useSafeQueryStatesFromZod }
export type { UseSafeQueryParamStatesOptions as QueryStateFromZodOptions }
