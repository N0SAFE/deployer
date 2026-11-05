import { describe, expect, it } from 'vitest'

import { nonEmptyString } from './index'

describe('nonEmptyString', () => {
    it('returns a usable string, trimmed', () => {
        expect(nonEmptyString('abc')).toBe('abc')
        expect(nonEmptyString('  abc  ')).toBe('abc')
    })

    it('returns null for nothing that carries a value', () => {
        expect(nonEmptyString('')).toBeNull()
        expect(nonEmptyString('   ')).toBeNull()
        expect(nonEmptyString(0)).toBeNull()
        expect(nonEmptyString(null)).toBeNull()
        expect(nonEmptyString(undefined)).toBeNull()
        expect(nonEmptyString({ key: 'value' })).toBeNull()
    })
})
