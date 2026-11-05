import { describe, expect, it } from 'vitest'

import { canImpersonate } from './impersonation'

describe('canImpersonate', () => {
    it('lets a superAdmin act as a strictly weaker principal', () => {
        expect(canImpersonate('superAdmin', 'admin')).toBeNull()
        expect(canImpersonate('superAdmin', 'user')).toBeNull()
        expect(canImpersonate('superAdmin', 'viewer')).toBeNull()
    })

    it('refuses an equal target', () => {
        // superAdmin acting as superAdmin is privilege laundering, not impersonation.
        expect(canImpersonate('superAdmin', 'superAdmin')).toBe(
            'equal-or-higher'
        )
    })

    it('refuses a role without the capability, even when it outranks the target', () => {
        // `admin` outranks `user`, but `user:impersonate` is not in the platform-admin bundle.
        expect(canImpersonate('admin', 'user')).toBe('no-capability')
        expect(canImpersonate('operator', 'viewer')).toBe('no-capability')
        expect(canImpersonate('viewer', 'admin')).toBe('no-capability')
    })

    it('treats an unknown role as powerless', () => {
        expect(canImpersonate('root', 'user')).toBe('no-capability')
    })
})
