import { describe, expect, it } from 'vitest'

import { mayInvite } from './index'

/**
 * The invitation grant rule, which is the security half of the invite plugin.
 *
 * The plugin used to receive no hooks at all (`useInvite` dropped every option), so any authenticated session could
 * create an invitation — including one carrying `superAdmin`, with the token in the response. `mayInvite` is the
 * decision `useInvite` now passes as `canInviteRole`, stated on its own so it can be tested without Better Auth.
 */
describe('mayInvite', () => {
    it.each([
        // actor, invited role, allowed
        ['superAdmin', 'superAdmin', true],
        ['superAdmin', 'admin', true],
        ['admin', 'operator', true],
        ['admin', 'viewer', true],
        ['admin', 'admin', false],
        ['admin', 'superAdmin', false],
        ['operator', 'viewer', false],
        ['viewer', 'viewer', false],
        ['user', 'viewer', false],
        [null, 'viewer', false],
    ])('actor %s inviting %s is %s', (actorRole, invitedRole, allowed) => {
        expect(mayInvite(actorRole, invitedRole)).toBe(allowed)
    })

    it('never lets a plain account invite, whatever the role', () => {
        expect(mayInvite('user', 'user')).toBe(false)
        expect(mayInvite(undefined, 'viewer')).toBe(false)
    })
})
