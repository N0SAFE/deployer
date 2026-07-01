/**
 * Default-value extraction for Zod object schemas.
 *
 * Used to seed the URL-search state with sensible defaults when the URL
 * does not specify a value for a given key. Exposes both a recursive
 * `getZodObjectDefaults` (full nested defaults) and a shallow
 * `getZodObjectShallowDefaults` (top-level only) helper for the common
 * case where the schema is flat.
 */
import type { z } from 'zod'
import { isRecord, isObjectLike } from '@repo/type-guards'

import {
    getZodDefault,
    getZodKind,
    unwrapZodSchema,
} from './schema'

/**
 * Recursively compute defaults for a Zod object schema.
 *
 * For each field:
 *  - If the field declares an explicit `default`, use that.
 *  - Otherwise, fall back to a sensible empty value (`''`, `0`, `false`,
 *    `[]`, an empty object, or the first enum/literal value).
 */

/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys. Used in place of `as Record<string, unknown>`
 * to avoid the runtime lie.
 */
export function getZodObjectDefaults<T extends z.ZodObject>(
    schema: T
): z.infer<T> {
    const shape = (schema as { shape: z.ZodRawShape }).shape
    const defaults: Record<string, unknown> = {}

    for (const [key, fieldSchema] of Object.entries(shape)) {
        const explicit = getZodDefault(fieldSchema as z.ZodType)
        if (explicit !== undefined) {
            defaults[key] = explicit
            continue
        }
        defaults[key] = inferEmptyValue(fieldSchema as z.ZodType)
    }

    return defaults as z.infer<T>
}

/**
 * Shallow (top-level) defaults. Identical to `getZodObjectDefaults` for
 * the first level but does not recurse into nested objects, returning
 * `{}` for them. This is cheaper for very large schemas.
 */
export function getZodObjectShallowDefaults<T extends z.ZodObject>(
    schema: T
): z.infer<T> {
    const shape = (schema as { shape: z.ZodRawShape }).shape
    const defaults: Record<string, unknown> = {}

    for (const [key, fieldSchema] of Object.entries(shape)) {
        const explicit = getZodDefault(fieldSchema as z.ZodType)
        defaults[key] = explicit !== undefined ? explicit : getEmptyPrimitive(fieldSchema as z.ZodType)
    }

    return defaults as z.infer<T>
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function inferEmptyValue(schema: z.ZodType): unknown {
    const base = unwrapZodSchema(schema)
    const kind = getZodKind(base)
    switch (kind) {
        case 'string':
            return ''
        case 'number':
            return 0
        case 'boolean':
            return false
        case 'array':
            return []
        case 'object':
            if ('shape' in (base as object)) {
                return getZodObjectDefaults(base as z.ZodObject)
            }
            return {}
        case 'enum':
        case 'nativeenum': {
            const values = getEnumValues(base)
            return values[0]
        }
        case 'literal': {
            const literal = getLiteralValue(base)
            return literal
        }
        default:
            return undefined
    }
}

function getEmptyPrimitive(schema: z.ZodType): unknown {
    const base = unwrapZodSchema(schema)
    const kind = getZodKind(base)
    switch (kind) {
        case 'string':
            return ''
        case 'number':
            return 0
        case 'boolean':
            return false
        case 'array':
            return []
        case 'object':
            return {}
        case 'enum':
        case 'nativeenum': {
            const values = getEnumValues(base)
            return values[0]
        }
        case 'literal':
            return getLiteralValue(base)
        default:
            return undefined
    }
}

function getEnumValues(schema: z.ZodType): unknown[] {
    const def = schema as { options?: readonly unknown[]; enum?: readonly unknown[] }
    if (Array.isArray(def.options)) return [...def.options]
    if (Array.isArray(def.enum)) return [...def.enum]
    const values = (schema as { _def?: { values?: unknown } })._def?.values
    if (values && typeof values === 'object') {
        return Object.values(values as Record<string, unknown>)
    }
    return []
}

function getLiteralValue(schema: z.ZodType): unknown {
    return (schema as { _def?: { value?: unknown } })._def?.value
}
