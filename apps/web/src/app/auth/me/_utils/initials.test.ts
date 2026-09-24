import { describe, expect, it } from 'vitest'
import { getInitials } from './initials'

describe('getInitials', () => {
    it('uses the first letters of a two-part name', () => {
        expect(getInitials('Ada Lovelace')).toBe('AL')
    })

    it('uses the first letter when the name is a single word', () => {
        expect(getInitials('Grace')).toBe('G')
    })

    it('falls through to the email when the name is blank', () => {
        expect(getInitials('', 'ada@example.com')).toBe('AE')
    })

    it('reads initials out of email punctuation', () => {
        expect(getInitials('ada.lovelace@example.com')).toBe('AL')
        expect(getInitials('ada_lovelace@example.com')).toBe('AL')
    })

    it('ignores extra whitespace', () => {
        expect(getInitials('  Ada   Lovelace  ')).toBe('AL')
    })

    it('never returns an empty mark', () => {
        expect(getInitials('', '   ')).toBe('?')
        expect(getInitials()).toBe('?')
    })
})
