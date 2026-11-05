import { describe, expect, it } from 'vitest'

import { bearerToken, secretsMatch } from './secrets'

/**
 * A secret comparison is a security primitive, not a utility: these cases are the ones that decide whether a missing
 * configuration authenticates everyone, and whether a guess can be recovered byte by byte.
 */
describe('secretsMatch', () => {
    it('matches identical secrets', () => {
        expect(secretsMatch('dev-fallback-key', 'dev-fallback-key')).toBe(true)
    })

    it('rejects a prefix, a suffix, and a one-character edit', () => {
        expect(secretsMatch('dev-fallback-ke', 'dev-fallback-key')).toBe(false)
        expect(secretsMatch('xdev-fallback-key', 'dev-fallback-key')).toBe(
            false
        )
        expect(secretsMatch('dev-fallback-kez', 'dev-fallback-key')).toBe(false)
    })

    it('rejects a guess of a different length without throwing', () => {
        // `timingSafeEqual` throws on unequal buffer lengths; hashing first is what makes this a `false`.
        expect(secretsMatch('', 'dev-fallback-key')).toBe(false)
        expect(secretsMatch('a'.repeat(4096), 'dev-fallback-key')).toBe(false)
    })

    it('never matches when the expected secret is absent or empty', () => {
        expect(secretsMatch('anything', undefined)).toBe(false)
        expect(secretsMatch('anything', null)).toBe(false)
        expect(secretsMatch('anything', '')).toBe(false)
        expect(secretsMatch(undefined, undefined)).toBe(false)
        expect(secretsMatch(null, '')).toBe(false)
    })

    it('rejects an absent presented secret', () => {
        expect(secretsMatch(undefined, 'dev-fallback-key')).toBe(false)
        expect(secretsMatch(null, 'dev-fallback-key')).toBe(false)
    })
})

describe('bearerToken', () => {
    it.each([
        ['Bearer abc', 'abc'],
        ['bearer abc', 'abc'],
        ['Bearer   abc  ', 'abc'],
    ])('reads the token from %s', (header, token) => {
        expect(bearerToken(header)).toBe(token)
    })

    it('refuses anything that is not a bearer header', () => {
        expect(bearerToken('Basic abc')).toBeNull()
        expect(bearerToken('abc')).toBeNull()
        expect(bearerToken('Bearer')).toBeNull()
        expect(bearerToken('')).toBeNull()
        expect(bearerToken(null)).toBeNull()
        expect(bearerToken(undefined)).toBeNull()
    })
})
