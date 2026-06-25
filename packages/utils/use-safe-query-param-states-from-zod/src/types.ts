/**
 * Public type surface for `@repo/use-safe-query-param-states-from-zod`.
 *
 * The module re-exports the strongly-typed `Options` from `nuqs` so consumers
 * do not have to import the `nuqs` types directly. It also exposes a small
 * set of package-only type helpers used by the parsers/defaults modules.
 */
import type { Options as NuqsOptions } from 'nuqs'
import type { z } from 'zod'

/**
 * Options accepted by `useSafeQueryParamStatesFromZod`.
 *
 * Mirrors the `nuqs` `Options` type 1:1 and adds an optional `delay` (in
 * milliseconds) used to debounce setter updates, plus an optional
 * `resetKeys` debug hint surfaced to warning messages.
 */
export type UseSafeQueryParamStatesOptions = NuqsOptions & {
    /** Debounce delay (ms) for the returned setter. `0` (default) = no debounce. */
    delay?: number
    /** Internal: log a warning when these keys are written via the setter. */
    resetKeys?: readonly string[]
}

/**
 * Strictly-typed object shape of a Zod object schema (`ZodRawShape`).
 *
 * `ZodObject` has a `shape` property typed as `ZodRawShape`, so this alias
 * keeps the inference across the parsers/defaults modules symmetric.
 */
export type ZodRawShapeSchema = z.ZodObject<z.ZodRawShape>

/**
 * A loose `Record`-shaped type used as the intermediate layer between
 * `nuqs` and Zod validation. We avoid `any` here on purpose: the value is
 * always either a Zod-validated object or a partial raw representation.
 */
export type UnknownRecord = Record<string, unknown>
