import { describe, expect, it } from 'vitest'

import { authz } from '../../authz/definition'

import { platformAc, platformRoles, platformSchemas } from './config'

/**
 * The adapter converts the model; it must not lose anything on the way.
 */
describe('better-auth adapter', () => {
    it('builds the access control from the authz statement', () => {
        expect(platformAc.statements).toEqual(authz.statement)
    })

    it('converts every platform role into a Better Auth Role', () => {
        expect(Object.keys(platformRoles)).toEqual([...authz.platformRoles])
        for (const [name, role] of Object.entries(platformRoles)) {
            expect(role, name).toMatchObject({
                authorize: expect.any(Function),
            })
        }
    })

    it('validates role names from the same declaration', () => {
        for (const name of authz.platformRoles) {
            expect(
                platformSchemas.roleNames.safeParse(name).success,
                name
            ).toBe(true)
        }
        expect(platformSchemas.roleNames.safeParse('owner').success).toBe(false)
    })
})
