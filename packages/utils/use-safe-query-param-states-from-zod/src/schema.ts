/**
 * Schema introspection helpers used to derive parser/defaults from a
 * Zod schema. All helpers are typed so that consumers do not need to
 * sprinkle `any` casts around the implementation.
 */
import type { z } from 'zod'
import { isRecord, isObjectLike } from "@repo/type-guards"

/** Possible Zod type discriminants we care about. */
type ZodKind =
    | 'string'
    | 'number'
    | 'boolean'
    | 'enum'
    | 'literal'
    | 'array'
    | 'object'
    | 'default'
    | 'optional'
    | 'effects'
    | 'union'
    | 'nativeenum'
    | 'unknown'

/**
 * Extract a `def`-like object from a Zod schema.
 *
 * `ZodType.def` is the canonical internal description of a Zod schema
 * (added in Zod v4). Older versions exposed it under `_def`. We check
 * both for forward-compatibility without resorting to `any`.
 */

/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys.
 */
function getSchemaDef(schema: z.ZodType): Record<string, unknown> {
    const def = (schema as { def?: unknown }).def
    if (def && typeof def === 'object') {
        return isRecord(def) ? def : {}
    }
    const legacy = (schema as { _def?: unknown })._def
    if (legacy && typeof legacy === 'object') {
        return isRecord(legacy) ? legacy : {}
    }
    return {}
}

/**
 * Best-effort detection of the underlying Zod type kind.
 *
 * The implementation only relies on the schema's `type` (Zod v4) and
 * falls back to the legacy `typeName` property when needed. It returns
 * `'unknown'` when it cannot determine the kind, which downstream code
 * handles by defaulting to a string parser.
 */
export function getZodKind(schema: z.ZodType): ZodKind {
    const def = getSchemaDef(schema)
    const directType = def.type
    if (typeof directType === 'string') {
        return mapTypeString(directType)
    }
    const legacyType = def.typeName
    if (typeof legacyType === 'string') {
        return mapTypeString(legacyType.replace(/^Zod/, '').toLowerCase())
    }
    return 'unknown'
}

function mapTypeString(value: string): ZodKind {
    const normalized = value.toLowerCase().replace(/^zod/, '')
    if (
        normalized === 'string' ||
        normalized === 'number' ||
        normalized === 'boolean' ||
        normalized === 'enum' ||
        normalized === 'literal' ||
        normalized === 'array' ||
        normalized === 'object' ||
        normalized === 'default' ||
        normalized === 'optional' ||
        normalized === 'effects' ||
        normalized === 'union' ||
        normalized === 'nativeenum'
    ) {
        return normalized;
    }
    return 'unknown'
}

/**
 * Unwrap a Zod schema from `default`, `optional`, `nullable`, `prefault`,
 * and `nonoptional` wrappers, returning the inner schema.
 *
 * The recursion terminates at the first non-wrapper schema. This is the
 * building block of every other helper in this module.
 */
export function unwrapZodSchema(schema: z.ZodType): z.ZodType {
    let current = schema
    for (let depth = 0; depth < 10; depth += 1) {
        const def = getSchemaDef(current)
        const inner = def.innerType
        if (!inner || typeof inner !== 'object') {
            return current
        }
        current = inner as z.ZodType
    }
    return current
}

/**
 * Extract the default value of a Zod schema (if any).
 *
 * Returns `undefined` when no default is declared. Supports both Zod v4
 * (where the default is a `() => unknown` getter) and Zod v3 (where it
 * can be a static value).
 */
export function getZodDefault(schema: z.ZodType): unknown {
    const def = getSchemaDef(schema)
    const kind = getZodKind(schema)
    if (kind !== 'default' && def.type !== 'default') {
        return undefined
    }
    const value = def.defaultValue
    if (typeof value === 'function') {
        return (value as () => unknown)()
    }
    return value
}

/**
 * Check whether a Zod number schema has been constrained to integers.
 *
 * Looks for the `int` check on the v4 `checks` array, and falls back to
 * `isInt` for older Zod versions.
 */
export function isZodInteger(schema: z.ZodType): boolean {
    const def = getSchemaDef(schema)
    const checks = def.checks
    if (Array.isArray(checks)) {
        return checks.some((check) => {
            if (!check || typeof check !== 'object') return false
            const record = isRecord(check) ? check : {}
            if (record.kind === 'int' || record.kind === 'integer') {
                return true
            }
            return record.isInt === true
        })
    }
    return false
}
