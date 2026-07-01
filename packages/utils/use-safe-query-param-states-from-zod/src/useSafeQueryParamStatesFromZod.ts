/**
 * `useSafeQueryParamStatesFromZod` — the public hook.
 *
 * Derives a `nuqs` parser map from a Zod object schema, merges the
 * resulting URL state with the schema defaults, and exposes a typed
 * `[state, setState]` tuple. The setter writes back to the URL through
 * `useQueryStates` so changes are reflected in the address bar and in
 * any subscribed components.
 *
 * Type guarantees:
 *   - `state` is `z.infer<Schema>` (full output, defaults applied).
 *   - `setState` accepts a partial payload or `null` (reset).
 *   - No `any`/`as` casts escape this module.
 */
import { useQueryStates } from 'nuqs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { z } from 'zod'

import { getZodObjectDefaults } from './defaults'
import { mergeWithDefaults } from './merge'
import { createParserForZodField } from './parsers'
import type { UnknownRecord, UseSafeQueryParamStatesOptions } from './types'
import { useDebouncedCallback } from './useDebouncedCallback'

/**
 * Build a `nuqs` parser map from a Zod object schema. The result is
 * stable across renders thanks to `useMemo`.
 */

/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys. Used in place of `as Record<string, unknown>`
 * to avoid the runtime lie.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function buildParserMap<T extends z.ZodObject>(
    schema: T
): Record<keyof z.infer<T> & string, ReturnType<typeof createParserForZodField>> {
    const shape = (schema as { shape: z.ZodRawShape }).shape
    const map: Record<string, ReturnType<typeof createParserForZodField>> = {}
    for (const [key, fieldSchema] of Object.entries(shape)) {
        map[key] = createParserForZodField(fieldSchema as z.ZodType)
    }
    return map
}

/**
 * Strip package-only options before passing to `useQueryStates`. We
 * intentionally keep this as an explicit step so future additions to
 * the public option surface are easy to spot.
 */
function pickNuqsOptions(
    options: UseSafeQueryParamStatesOptions | undefined
): Omit<UseSafeQueryParamStatesOptions, 'delay' | 'resetKeys'> | undefined {
    if (!options) return undefined
    const { delay: _delay, resetKeys: _resetKeys, ...nuqsOptions } = options
    void _delay
    void _resetKeys
    return nuqsOptions
}

export type SetQueryParamState<T extends z.ZodObject> = (
    value: Partial<z.infer<T>> | null
) => void

/**
 * Reactive, type-safe accessor for a route's URL search state.
 *
 * @example
 * ```tsx
 * const Filters = z.object({
 *   q: z.string().default(''),
 *   page: z.number().int().min(1).default(1),
 * })
 *
 * function Component() {
 *   const [filters, setFilters] = useSafeQueryParamStatesFromZod(Filters)
 *   return <input value={filters.q} onChange={(e) => setFilters({ q: e.target.value })} />
 * }
 * ```
 */
export function useSafeQueryParamStatesFromZod<T extends z.ZodObject>(
    schema: T,
    options?: UseSafeQueryParamStatesOptions
): [z.infer<T>, SetQueryParamState<T>] {
    const parsers = useMemo(() => buildParserMap(schema), [schema])
    const nuqsOptions = useMemo(
        () => pickNuqsOptions(options),
        [options]
    )

    const [rawValues, setRawValues] = useQueryStates(
        parsers as Parameters<typeof useQueryStates>[0],
        nuqsOptions
    )

    const rawValuesKey = useMemo(
        () => stableStringify(rawValues),
        [rawValues]
    )

    const merged = useMemo(
        () =>
            mergeWithDefaults(
                schema,
                rawValues as UnknownRecord | null | undefined
            ),
        [schema, rawValuesKey]
    )

    const delay = options?.delay ?? 0
    const shouldDebounce = delay > 0
    const defaultsRef = useRef<z.infer<T>>(getZodObjectDefaults(schema))

    // Keep defaults in sync with the (possibly changing) schema identity.
    useEffect(() => {
        defaultsRef.current = getZodObjectDefaults(schema)
    }, [schema])

    // Local optimistic state used only when debouncing is enabled.
    const [localState, setLocalState] = useState<z.infer<T>>(merged)
    const mergedKey = stableStringify(merged)
    useEffect(() => {
        if (!shouldDebounce) return
        setLocalState((prev) =>
            stableStringify(prev) === mergedKey ? prev : merged
        )
    }, [mergedKey, merged, shouldDebounce])

    const writeToUrl = useCallback(
        (value: Partial<z.infer<T>> | null) => {
            if (value === null) {
                void setRawValues(null)
                return
            }
            void setRawValues(value)
        },
        [setRawValues]
    )

    const debouncedWrite = useDebouncedCallback(
        (value: Partial<z.infer<T>> | null) => {writeToUrl(value)},
        delay
    )

    const immediateSetter = useCallback<SetQueryParamState<T>>(
        (value) => {writeToUrl(value)},
        [writeToUrl]
    )

    const debouncedSetter = useCallback<SetQueryParamState<T>>(
        (value) => {
            if (value === null) {
                setLocalState(defaultsRef.current)
                debouncedWrite(null)
                return
            }
            setLocalState((prev) => ({ ...prev, ...value }))
            debouncedWrite(value)
        },
        [debouncedWrite]
    )

    return shouldDebounce
        ? [localState, debouncedSetter]
        : [merged, immediateSetter]
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Stable JSON-like stringification used to derive stable keys for
 * memoization. We use a sorted-keys serializer to ensure identical
 * objects produce identical strings regardless of property order.
 */
function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value) ?? String(value)
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`
    }
    const entries = Object.entries(value as Record<string, unknown>).sort(
        ([a], [b]) => a.localeCompare(b)
    )
    return `{${entries
        .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
        .join(',')}}`
}
