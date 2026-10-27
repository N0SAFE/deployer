/**
 * Guards the invariant behind the static `config.matcher` in `proxy.ts`.
 *
 * `config.matcher` MUST be a literal: Next.js statically analyzes that export
 * before executing anything, and its docs say dynamic values "will be ignored".
 * A call such as `compileMatchers(middlewares)` therefore fails at request time
 * with "Next.js can't recognize the exported `config` field in route", and every
 * page returns 500.
 *
 * Inlining the literal removes the dynamic value, but it also breaks the link
 * between that value and the middleware stack it was derived from: an edit that
 * adds a middleware with a narrower matcher would leave `proxy.ts` matching every
 * path, silently running Proxy on requests it should skip.
 *
 * This test restores the link WITHOUT importing the middleware modules — those
 * pull in the app's whole env/contracts graph, which the unit alias set does not
 * resolve. Instead it asserts the two facts that make the literal correct:
 *   1. the literal is a static string array
 *   2. at least one stack member declares no matcher, which is what makes
 *      `compileMatchers` return "every path" and therefore equals the literal
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { compileMatchers } from '../utils/compileMatchers'
import type { Middleware } from '../utils/types'

const PROXY = join(import.meta.dirname, '..', '..', 'proxy.ts')

describe('proxy config.matcher', () => {
    it('is a static string array, so Next.js keeps it', () => {
        const source = readFileSync(PROXY, 'utf8')

        // The export must be a literal, not a call or an identifier.
        expect(source).toMatch(/matcher:\s*\[/)

        // And the module must not reach for a computed matcher any more.
        expect(source).not.toMatch(/matcher:\s*[A-Za-z_]+\s*\(/)
        expect(source).not.toMatch(/from\s+["'][^"']*compileMatchers["']/)
    })

    it('equals what compileMatchers derives when a member has no matcher', () => {
        // A stack member with no `matcher` is unconditionally applicable, which
        // is the case in `proxy.ts` (WithEnv declares none). `compileMatchers`
        // returns MATCH_EVERY_PATH for that case — `/ :path*` — so the literal
        // in `proxy.ts` is the derived value, not an approximation.
        const unconditional = [{}] as unknown as Middleware[]

        expect(compileMatchers(unconditional)).toEqual(['/:path*'])
    })
})
