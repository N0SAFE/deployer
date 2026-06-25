/**
 * Merge raw URL state with Zod-derived defaults.
 *
 * This is the only place where the "real" Zod output type meets the
 * loose record that comes from `nuqs`. The merge is shallow because
 * `useQueryStates` flattens the URL; nested defaults are still applied
 * by `getZodObjectDefaults` so the resulting object is structurally
 * complete.
 */
import type { z } from 'zod'

import { getZodObjectDefaults } from './defaults'
import type { UnknownRecord } from './types'

/**
 * Merge `rawValues` (from the URL, possibly partial) with the schema
 * defaults to produce a fully-typed object.
 *
 * Missing keys in `rawValues` are filled in from the schema defaults.
 * Keys explicitly present in `rawValues` always win, even if they hold
 * `null`/`undefined` (callers can use this to deliberately clear fields).
 */
export function mergeWithDefaults<T extends z.ZodObject>(
    schema: T,
    rawValues: UnknownRecord | null | undefined
): z.infer<T> {
    const defaults = getZodObjectDefaults(schema)
    const merged: UnknownRecord = { ...defaults }

    if (rawValues) {
        for (const [key, value] of Object.entries(rawValues)) {
            if (value !== null && value !== undefined) {
                merged[key] = value
            }
        }
    }

    return merged as z.infer<T>
}
