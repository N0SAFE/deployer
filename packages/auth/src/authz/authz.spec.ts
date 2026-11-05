import { describe, expect, it } from 'vitest'

import { flattenGroups } from './builder'
import {
    BUNDLES,
    PERMISSIONS,
    SYSTEM_ROLES,
    capabilitiesOfRole,
    roleGrants,
    type Permission,
} from './definition'
import { can, decide } from './evaluate'

import type { CapabilitySet } from './types'

const ALL = Object.keys(PERMISSIONS)

describe('catalog integrity', () => {
    it('gives every permission a bundle, so the role editor can reach it', () => {
        const bundled = new Set(
            Object.values(BUNDLES).flatMap((group) => flattenGroups(group))
        )
        const orphans = ALL.filter((permission) => !bundled.has(permission))

        expect(orphans).toEqual([])
    })

    it('only references permissions and bundles that exist', () => {
        for (const [bundle, group] of Object.entries(BUNDLES)) {
            for (const permission of flattenGroups(group)) {
                expect(ALL, `${bundle} → ${permission}`).toContain(permission)
            }
        }
        for (const [role, definition] of Object.entries(SYSTEM_ROLES)) {
            for (const bundle of definition.bundles) {
                expect(Object.keys(BUNDLES), `${role} → ${bundle}`).toContain(
                    bundle
                )
            }
        }
    })

    it('gives superAdmin the whole catalog, and the danger bundle only to it', () => {
        expect(capabilitiesOfRole('superAdmin')).toEqual(ALL)
        // The danger bundle is what separates the two admin roles: destructive and reveal-level capabilities.
        expect(capabilitiesOfRole('admin')).not.toContain(
            'platform.secret:reveal'
        )
        expect(capabilitiesOfRole('admin')).not.toContain('node:revoke')
        expect(capabilitiesOfRole('operator')).not.toContain('user:set-role')
        expect(capabilitiesOfRole('viewer')).not.toContain('container:exec')
    })

    it('keeps project roles project-scoped and platform roles platform-scoped', () => {
        expect(SYSTEM_ROLES.owner.scope).toBe('project')
        expect(SYSTEM_ROLES.superAdmin.scope).toBe('platform')
    })

    it('holds nothing for an unknown role', () => {
        expect(capabilitiesOfRole('nope')).toEqual([])
        expect(roleGrants('nope', 'project:read')).toBe(false)
    })
})

describe('decide', () => {
    const capabilities = (
        permissions: readonly Permission[]
    ): CapabilitySet => ({
        permissions,
        sources: permissions.length === 0 ? [] : ['test'],
    })
    const facts = {
        actorId: 'u1',
        ownerId: 'u1',
        environmentKind: 'production' as const,
        now: Date.now(),
    }
    const scope = { kind: 'platform' as const }

    it('allows a granted permission and names the source', () => {
        const decision = decide({
            permission: 'project:read',
            scope,
            capabilities: capabilities(['project:read']),
            facts,
        })

        expect(decision).toMatchObject({
            allowed: true,
            reason: 'granted by test',
        })
    })

    it('denies by default and says why', () => {
        expect(
            decide({
                permission: 'project:read',
                scope,
                capabilities: capabilities([]),
                facts,
            })
        ).toMatchObject({
            allowed: false,
            reason: 'no grant in this scope',
        })
        expect(
            decide({
                permission: 'project:read',
                scope,
                capabilities: capabilities(['project:write']),
                facts,
            })
        ).toMatchObject({
            allowed: false,
            reason: 'not granted in this scope',
        })
    })

    it('denies a conditional grant that does not hold, even when the permission is present', () => {
        expect(
            decide({
                permission: 'project:delete',
                scope,
                capabilities: capabilities(['project:delete']),
                facts: { ...facts, ownerId: 'someone-else' },
                condition: { ownerOnly: true },
            })
        ).toMatchObject({ allowed: false, reason: 'owner only' })
    })

    it('refuses a production-only guardrail in production', () => {
        expect(
            decide({
                permission: 'service:deploy',
                scope,
                capabilities: capabilities(['service:deploy']),
                facts,
                condition: { notEnvironment: ['production'] },
            })
        ).toMatchObject({ allowed: false, reason: 'not allowed in production' })
    })

    it("has no superAdmin bypass: the role's capabilities decide, and they are visible", () => {
        const superAdmin = capabilities(capabilitiesOfRole('superAdmin'))
        expect(
            decide({
                permission: 'role:assign',
                scope,
                capabilities: superAdmin,
                facts,
            }).allowed
        ).toBe(true)
        expect(
            decide({
                permission: 'role:assign',
                scope,
                capabilities: capabilities([]),
                facts,
            }).allowed
        ).toBe(false)
    })
})

describe('can', () => {
    it('accepts a capability set or a bare list', () => {
        expect(can(['project:read'], 'project:read')).toBe(true)
        expect(
            can({ permissions: ['project:read'], sources: [] }, 'project:read')
        ).toBe(true)
        expect(can({ permissions: [], sources: [] }, 'project:read')).toBe(
            false
        )
    })
})
