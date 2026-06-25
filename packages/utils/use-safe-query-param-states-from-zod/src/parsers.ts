/**
 * Parser factory: turn a single Zod schema into a `nuqs` parser builder.
 *
 * This module is the only one that has to deal with `nuqs`'s generic
 * `SingleParser<T>` because each `parseAs*` builder carries its own
 * value type. The public alias `NuqsParserBuilder` widens it back to a
 * structural shape so a heterogeneous map of parsers is assignable to
 * `useQueryStates`.
 */
import {
    parseAsArrayOf,
    parseAsBoolean,
    parseAsFloat,
    parseAsInteger,
    parseAsJson,
    parseAsNumberLiteral,
    parseAsString,
    parseAsStringLiteral,
    type SingleParser,
} from 'nuqs'
import type { z } from 'zod'

import {
    getZodDefault,
    getZodKind,
    isZodInteger,
    unwrapZodSchema,
} from './schema'

/**
 * Structural shape every `nuqs` parser builder satisfies. Keeping it
 * local avoids leaking the generic `SingleParser<T>` into the rest of
 * the package.
 */
export type NuqsParserBuilder = {
    parse: (value: string) => unknown
    serialize: (value: unknown) => string
    eq: (a: unknown, b: unknown) => boolean
    withDefault: (defaultValue: unknown) => NuqsParserBuilder
}

function asParserBuilder(parser: SingleParser<unknown>): NuqsParserBuilder {
    return parser as unknown as NuqsParserBuilder
}

/**
 * Return a parser builder for the given Zod field schema. The optional
 * `includeDefault` flag controls whether the returned parser is wrapped
 * with `withDefault(value)` (defaults to `true`).
 *
 * Unknown Zod types fall back to a string parser, which is the safest
 * default because it round-trips through URLs without coercion.
 */
export function createParserForZodField(
    schema: z.ZodType,
    includeDefault = true
): NuqsParserBuilder {
    const baseSchema = unwrapZodSchema(schema)
    const kind = getZodKind(baseSchema)
    const defaultValue = includeDefault ? getZodDefault(schema) : undefined

    let parser: NuqsParserBuilder

    switch (kind) {
        case 'string':
            parser = asParserBuilder(parseAsString as unknown as SingleParser<unknown>)
            break
        case 'number':
            parser = asParserBuilder(
                (isZodInteger(baseSchema)
                    ? parseAsInteger
                    : parseAsFloat) as unknown as SingleParser<unknown>
            )
            break
        case 'boolean':
            parser = asParserBuilder(
                parseAsBoolean as unknown as SingleParser<unknown>
            )
            break
        case 'enum':
        case 'nativeenum': {
            const values = extractStringEnumValues(baseSchema)
            if (values.length > 0) {
                parser = asParserBuilder(
                    parseAsStringLiteral(values) as unknown as SingleParser<unknown>
                )
            } else {
                parser = asParserBuilder(
                    parseAsString as unknown as SingleParser<unknown>
                )
            }
            break
        }
        case 'literal': {
            const literal = extractLiteralValue(baseSchema)
            if (typeof literal === 'string') {
                parser = asParserBuilder(
                    parseAsStringLiteral([literal]) as unknown as SingleParser<unknown>
                )
            } else if (typeof literal === 'number') {
                parser = asParserBuilder(
                    parseAsNumberLiteral([literal]) as unknown as SingleParser<unknown>
                )
            } else {
                parser = asParserBuilder(
                    parseAsString as unknown as SingleParser<unknown>
                )
            }
            break
        }
        case 'array': {
            const elementSchema = extractArrayElement(baseSchema)
            const elementParser: NuqsParserBuilder = elementSchema
                ? createParserForZodField(elementSchema, false)
                : asParserBuilder(parseAsString as unknown as SingleParser<unknown>)
            // `parseAsArrayOf` widens the inner builder to its own
            // generic; we re-narrow through `asParserBuilder` to keep
            // the public type structural.
            const arrayParser = (parseAsArrayOf as unknown as (
                inner: NuqsParserBuilder
            ) => SingleParser<unknown>)(elementParser)
            parser = asParserBuilder(arrayParser)
            break
        }
        case 'object': {
            try {
                parser = asParserBuilder(
                    parseAsJson(baseSchema) as unknown as SingleParser<unknown>
                )
            } catch {
                parser = asParserBuilder(
                    parseAsString as unknown as SingleParser<unknown>
                )
            }
            break
        }
        case 'effects': {
            const inner = unwrapZodSchema(baseSchema)
            parser = createParserForZodField(inner, includeDefault)
            break
        }
        case 'union':
        case 'unknown':
        default:
            parser = asParserBuilder(
                parseAsString as unknown as SingleParser<unknown>
            )
            break
    }

    if (defaultValue !== undefined && defaultValue !== null) {
        return parser.withDefault(defaultValue)
    }

    return parser
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractStringEnumValues(schema: z.ZodType): string[] {
    const def = schema as { options?: readonly string[]; enum?: readonly unknown[] }
    if (Array.isArray(def.options)) {
        return def.options.filter(
            (value): value is string => typeof value === 'string'
        )
    }
    if (Array.isArray(def.enum)) {
        return def.enum.filter(
            (value): value is string => typeof value === 'string'
        )
    }
    const values = (schema as { _def?: { values?: unknown } })._def?.values
    if (values && typeof values === 'object') {
        return Object.values(values as Record<string, unknown>).filter(
            (value): value is string => typeof value === 'string'
        )
    }
    return []
}

function extractLiteralValue(schema: z.ZodType): string | number | undefined {
    const def = schema as { _def?: { value?: unknown } }
    const value = def._def?.value
    if (typeof value === 'string' || typeof value === 'number') {
        return value
    }
    return undefined
}

function extractArrayElement(schema: z.ZodType): z.ZodType | undefined {
    const element = (schema as { _def?: { element?: unknown } })._def?.element
    if (element && typeof element === 'object') {
        return element as z.ZodType
    }
    return undefined
}
