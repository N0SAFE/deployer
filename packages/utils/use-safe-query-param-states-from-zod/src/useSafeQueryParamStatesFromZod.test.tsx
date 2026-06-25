// The hook is fully type-safe and the public surface is exercised by the
// page-wrappers integration. The actual nuqs interaction is mocked in
// the apps/web app's `useSafeQueryStatesFromZod.test.tsx` suite which
// runs against a real DOM environment. We keep a minimal smoke test
// here to verify the build pipeline of the new package.

import { describe, expect, it } from 'vitest'

import { getZodObjectDefaults } from './defaults'
import { createParserForZodField } from './parsers'
import { mergeWithDefaults } from './merge'
import { z } from 'zod'

describe('package smoke', () => {
    it('derives defaults from a Zod schema', () => {
        const schema = z.object({
            q: z.string().default('hello'),
            page: z.number().int().default(2),
        })

        const defaults = getZodObjectDefaults(schema)
        expect(defaults).toEqual({ q: 'hello', page: 2 })
    })

    it('builds parsers for a Zod schema', () => {
        const schema = z.object({
            q: z.string().default('hello'),
            page: z.number().int().default(2),
            flag: z.boolean().default(true),
        })

        const parser = createParserForZodField(schema.shape.q)
        expect(typeof parser.parse).toBe('function')
        expect(typeof parser.serialize).toBe('function')
    })

    it('merges raw values with defaults', () => {
        const schema = z.object({
            q: z.string().default('hello'),
            page: z.number().int().default(2),
        })

        const merged = mergeWithDefaults(schema, { q: 'world' })
        expect(merged).toEqual({ q: 'world', page: 2 })
    })
})
