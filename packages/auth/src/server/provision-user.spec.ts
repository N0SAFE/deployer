import { describe, expect, it, vi } from 'vitest'

import { provisionUserAccount, type ProvisionUserInput } from './provision-user'

import type { BetterAuthFactoryResult } from './auth'

/**
 * Public sign-up is disabled, so every account the platform itself owns is
 * created here. The assertions are the two things sign-in depends on: the
 * password is hashed by Better Auth (never stored raw), and the credential
 * account is keyed to the user id.
 */
function fakeAuth() {
    const createUser = vi.fn((user: Record<string, unknown>) =>
        Promise.resolve({ id: 'u1', ...user })
    )
    const createAccount = vi.fn((account: Record<string, unknown>) =>
        Promise.resolve(account)
    )
    const hash = vi.fn((password: string) =>
        Promise.resolve(`hashed:${password}`)
    )

    const auth = {
        $context: Promise.resolve({
            internalAdapter: { createUser, createAccount },
            password: { hash },
        }),
    } as unknown as BetterAuthFactoryResult['auth']

    return { auth, createUser, createAccount, hash }
}

describe('provisionUserAccount', () => {
    it('hashes the password and writes a credential account for the new user', async () => {
        const { auth, createUser, createAccount, hash } = fakeAuth()

        const userId = await provisionUserAccount(auth, {
            email: '  Operator@Example.com ',
            name: 'Operator',
            password: 'typed-password',
            role: 'superAdmin',
        })

        expect(userId).toBe('u1')
        expect(hash).toHaveBeenCalledWith('typed-password')
        expect(createUser).toHaveBeenCalledWith(
            expect.objectContaining({
                email: 'operator@example.com',
                name: 'Operator',
                emailVerified: true,
                role: 'superAdmin',
            }),
            { method: 'admin' }
        )
        expect(createAccount).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'u1',
                accountId: 'u1',
                providerId: 'credential',
                password: 'hashed:typed-password',
            })
        )
    })

    it('omits the role when the caller does not grant one', async () => {
        const { auth, createUser } = fakeAuth()
        const input: ProvisionUserInput = {
            email: 'a@b.c',
            name: 'A',
            password: 'p',
        }

        await provisionUserAccount(auth, input)

        expect(createUser.mock.calls[0]?.[0]).not.toHaveProperty('role')
    })
})
