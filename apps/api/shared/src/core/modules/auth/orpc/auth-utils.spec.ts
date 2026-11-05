import { beforeEach, describe, expect, it } from 'vitest'

import { AuthUtils, AuthUtilsEmpty } from './auth-utils'

import type { ORPCAuthContext } from './types'
import type { UserSession } from '../utils/auth-utils'

/**
 * The auth face a handler sees.
 *
 * It used to carry Better Auth plugin wrappers (`admin.listUsers`, `admin.hasPermission`) with their own registry and
 * header injection. Those are gone (`SEC-062`): authorization is the transport gate, so this face is the session and the
 * refusal, and a test here proves what a handler can and cannot reach.
 */
const session = (): UserSession => ({
    session: {
        id: 'session-123',
        userId: 'user-123',
        expiresAt: new Date('2025-12-31'),
        token: 'token-123',
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
    },
    user: {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'admin',
        emailVerified: true,
        image: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
    },
})

describe('ORPC AuthUtils', () => {
    let mockSession: UserSession

    beforeEach(() => {
        mockSession = session()
    })

    describe('AuthUtils', () => {
        it('exposes the session and the user, and nothing that authorizes', () => {
            const utils = new AuthUtils(mockSession)

            expect(utils.isLoggedIn).toBe(true)
            expect(utils.session).toBe(mockSession.session)
            expect(utils.user).toBe(mockSession.user)
            // No `admin`, no `checks`, no `middleware`: a handler cannot reach a second permission source.
            expect(utils).not.toHaveProperty('admin')
        })

        it('reports an empty state for a null session', () => {
            const utils = new AuthUtils(null)

            expect(utils.isLoggedIn).toBe(false)
            expect(utils.session).toBeNull()
            expect(utils.user).toBeNull()
        })

        it('satisfies ORPCAuthContext', () => {
            const utils: ORPCAuthContext = new AuthUtils(mockSession)
            expect(utils.user?.id).toBe('user-123')
        })

        describe('requireAuth', () => {
            it('returns the session when authenticated', () => {
                expect(new AuthUtils(mockSession).requireAuth()).toBe(
                    mockSession
                )
            })

            it('refuses with the contract-closed UNAUTHORIZED message', () => {
                expect(() => new AuthUtils(null).requireAuth()).toThrow(
                    'Authentication required'
                )
            })
        })
    })

    describe('AuthUtilsEmpty', () => {
        it('is always unauthenticated and exposes no plugin surface', () => {
            const utils = new AuthUtilsEmpty()

            expect(utils.isLoggedIn).toBe(false)
            expect(utils.session).toBeNull()
            expect(utils.user).toBeNull()
            expect(utils).not.toHaveProperty('admin')
        })

        it('satisfies ORPCAuthContext', () => {
            const utils: ORPCAuthContext = new AuthUtilsEmpty()
            expect(utils.user).toBeNull()
        })

        it('always refuses', () => {
            expect(() => new AuthUtilsEmpty().requireAuth()).toThrow(
                'Authentication required'
            )
        })
    })
})
