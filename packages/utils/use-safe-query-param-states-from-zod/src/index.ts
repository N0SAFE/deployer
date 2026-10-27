/**
 * @deployer/use-safe-query-param-states-from-zod
 *
 * Type-safe, reactive access to a route's URL search state.
 *
 * The package exports:
 *  - `useSafeQueryParamStatesFromZod` — the core hook.
 *  - `useRouteSearchBuilder` — drop-in helper for routes.
 *  - `createParserForZodField` / `getZodObjectDefaults` / `mergeWithDefaults`
 *    — building blocks used by the hook, also exposed for advanced
 *    consumers.
 */
export {
    useSafeQueryParamStatesFromZod,
    type SetQueryParamState,
} from '@deployer/use-safe-query-param-states-from-zod/useSafeQueryParamStatesFromZod'

export {
    useRouteSearchBuilder,
    type RouteBuilderLike,
    type UseRouteSearchBuilderOptions,
    type UseRouteSearchBuilderReturn,
} from '@deployer/use-safe-query-param-states-from-zod/useRouteSearchBuilder'

export { createParserForZodField } from '@deployer/use-safe-query-param-states-from-zod/parsers'
export { getZodObjectDefaults, getZodObjectShallowDefaults } from '@deployer/use-safe-query-param-states-from-zod/defaults'
export { mergeWithDefaults } from '@deployer/use-safe-query-param-states-from-zod/merge'
export { useDebouncedCallback } from '@deployer/use-safe-query-param-states-from-zod/useDebouncedCallback'

export {
    getZodKind,
    getZodDefault,
    isZodInteger,
    unwrapZodSchema,
} from '@deployer/use-safe-query-param-states-from-zod/schema'

export type {
    UseSafeQueryParamStatesOptions,
    ZodRawShapeSchema,
    UnknownRecord,
} from '@deployer/use-safe-query-param-states-from-zod/types'
