import { beforeEach, describe, expect, it, vi } from 'vitest'

import { stepUpPlugin } from './step-up'

vi.mock('better-auth/api', () => ({
    createAuthMiddleware: vi.fn((handler) => ({ handler })),
}))

/** The hook handler, as the mocked `createAuthMiddleware` returns it. */
const handlerOf = (
    plugin: ReturnType<typeof stepUpPlugin>
): ((ctx: unknown) => Promise<void>) => {
    const after = plugin.hooks?.after?.[0] as unknown as {
        handler: { handler: (ctx: unknown) => Promise<void> }
    }
    return after.handler.handler
}

describe('stepUpPlugin', () => {
    const sink = { record: vi.fn() }

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('records the session the passkey ceremony MINTED, not the one it replaced', async () => {
        await handlerOf(stepUpPlugin(sink))({
            path: '/passkey/verify-authentication',
            body: {},
            context: {
                // The endpoint has no session middleware, so this is the pre-verification state.
                session: {
                    session: { id: 'old-session' },
                    user: { id: 'user-1' },
                },
                returned: { session: { id: 'new-session', userId: 'user-1' } },
            },
        })

        expect(sink.record).toHaveBeenCalledWith(
            expect.objectContaining({
                sessionId: 'new-session',
                userId: 'user-1',
                method: 'passkey',
            })
        )
    })

    it('falls back to the current session when the endpoint returned none', async () => {
        await handlerOf(stepUpPlugin(sink))({
            path: '/two-factor/verify-totp',
            body: {},
            context: {
                session: {
                    session: { id: 'session-1' },
                    user: { id: 'user-1' },
                },
                returned: undefined,
            },
        })

        expect(sink.record).toHaveBeenCalledWith(
            expect.objectContaining({ sessionId: 'session-1', method: 'totp' })
        )
    })

    it('records nothing when there is no session to bind to', async () => {
        await handlerOf(stepUpPlugin(sink))({
            path: '/passkey/verify-authentication',
            body: {},
            context: { session: null, returned: undefined },
        })

        expect(sink.record).not.toHaveBeenCalled()
    })

    it('ignores a path that proves nothing', () => {
        const plugin = stepUpPlugin(sink)
        const after = plugin.hooks?.after?.[0] as unknown as {
            matcher: (ctx: { path: string }) => boolean
        }

        expect(after.matcher({ path: '/sign-in/email' })).toBe(false)
        expect(after.matcher({ path: '/passkey/verify-authentication' })).toBe(
            true
        )
    })
})
