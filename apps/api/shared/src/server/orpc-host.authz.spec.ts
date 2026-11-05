import { afterEach, describe, expect, it } from 'vitest'

import {
    clearRoleSnapshot,
    installRoleSnapshot,
} from '../core/authz/role-catalog'

import { roleTableStore } from './orpc-host'

/**
 * The gate's capability source (`SEC-062`), which is where an enforcement flip actually gets its answers.
 *
 * Two failure modes are worth a test each: a custom role being refused because the store only knew the shipped table
 * (a lockout), and a platform role being mistaken for a project capability (privilege escalation).
 */
const actor = (role: string) => ({ id: 'u1', role })

describe('roleTableStore', () => {
    afterEach(() => {
        clearRoleSnapshot()
    })

    it('answers a platform role from the shipped table before any snapshot exists', async () => {
        const store = roleTableStore()

        const admin = await store.capabilities(actor('superAdmin'), {
            kind: 'platform',
        })
        const viewer = await store.capabilities(actor('viewer'), {
            kind: 'platform',
        })

        expect(admin.permissions).toContain('user:delete')
        expect(viewer.permissions).not.toContain('user:delete')
        expect(viewer.permissions).toContain('cluster:read')
    })

    it('honours a CUSTOM role once the catalogue snapshot is installed', async () => {
        installRoleSnapshot(9, [
            { name: 'support', permissions: ['audit:read', 'user:list'] },
        ])

        const capabilities = await roleTableStore().capabilities(
            actor('support'),
            { kind: 'platform' }
        )

        expect(capabilities.permissions).toEqual(['audit:read', 'user:list'])
    })

    it("grants nothing for a project scope: membership is the project service's fact, not a platform role's", async () => {
        const store = roleTableStore()

        // Even the highest platform role gets no project capability from here. A project-scoped declaration under
        // `enforce` is therefore a denial — fail-closed, and the reason those routes stay with their owning service.
        const superAdmin = await store.capabilities(actor('superAdmin'), {
            kind: 'project',
            id: 'p-1',
        })

        expect(superAdmin.permissions).toEqual([])
        expect(superAdmin.sources).toEqual([])
    })

    it('grants nothing to a role the catalogue does not list', async () => {
        installRoleSnapshot(9, [
            { name: 'support', permissions: ['audit:read'] },
        ])

        const capabilities = await roleTableStore().capabilities(
            actor('deleted-role'),
            { kind: 'platform' }
        )

        expect(capabilities.permissions).toEqual([])
    })
})
