import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
    listDeviceSessions: vi.fn(),
    setActive: vi.fn(),
    revoke: vi.fn(),
    useSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
    authClient: {
        multiSession: {
            listDeviceSessions: mocks.listDeviceSessions,
            setActive: mocks.setActive,
            revoke: mocks.revoke,
        },
    },
    useSession: mocks.useSession,
}))

vi.mock('@repo/logger', () => ({
    logger: { error: vi.fn() },
}))

import { AccountsSection } from './accounts-section'

const activeAccount = {
    session: { id: 'session-active', token: 'token-active' },
    user: { id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com' },
}

const otherAccount = {
    session: { id: 'session-other', token: 'token-other' },
    user: { id: 'user-2', name: 'Grace Hopper', email: 'grace@example.com' },
}

describe('AccountsSection', () => {
    beforeEach(() => {
        mocks.useSession.mockReturnValue({
            data: {
                session: { token: 'token-active' },
                user: { email: 'ada@example.com' },
            },
        })
        mocks.listDeviceSessions.mockResolvedValue({
            data: [activeAccount, otherAccount],
            error: null,
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('lists every account open in the browser and marks the one in use', async () => {
        render(<AccountsSection />)

        expect(await screen.findByText('Grace Hopper')).toBeInTheDocument()
        expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
        expect(await screen.findByText('AL')).toBeInTheDocument()
        expect(screen.getByText('Active')).toBeInTheDocument()
        expect(
            screen.queryByLabelText('Switch to ada@example.com')
        ).not.toBeInTheDocument()
        expect(
            screen.getByLabelText('Switch to grace@example.com')
        ).toBeInTheDocument()
    })

    it('switches the active account through the multi-session endpoint', async () => {
        const reload = vi.fn()
        vi.stubGlobal('location', { reload })
        mocks.setActive.mockResolvedValue({
            data: { session: otherAccount.session },
            error: null,
        })

        render(<AccountsSection />)
        fireEvent.click(
            await screen.findByLabelText('Switch to grace@example.com')
        )

        await waitFor(() => {
            expect(mocks.setActive).toHaveBeenCalledWith({
                sessionToken: 'token-other',
            })
        })
        expect(reload).toHaveBeenCalledTimes(1)
    })

    it('refreshes the list instead of reloading when another account is removed', async () => {
        const reload = vi.fn()
        vi.stubGlobal('location', { reload })
        mocks.revoke.mockResolvedValue({ data: { status: true }, error: null })

        render(<AccountsSection />)
        fireEvent.click(
            await screen.findByLabelText('Sign out of grace@example.com')
        )
        fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

        await waitFor(() => {
            expect(mocks.revoke).toHaveBeenCalledWith({
                sessionToken: 'token-other',
            })
        })
        expect(reload).not.toHaveBeenCalled()
        expect(mocks.listDeviceSessions).toHaveBeenCalledTimes(2)
    })

    it('explains a failed load and retries it', async () => {
        mocks.listDeviceSessions
            .mockResolvedValueOnce({
                data: null,
                error: { message: 'Auth service unavailable' },
            })
            .mockResolvedValueOnce({ data: [activeAccount], error: null })

        render(<AccountsSection />)

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Auth service unavailable'
        )

        fireEvent.click(screen.getByRole('button', { name: /try again/i }))

        await waitFor(() => {
            expect(mocks.listDeviceSessions).toHaveBeenCalledTimes(2)
        })
    })

    it('says so when this is the only account open', async () => {
        mocks.listDeviceSessions.mockResolvedValue({ data: [], error: null })

        render(<AccountsSection />)

        expect(
            await screen.findByText(
                'Only ada@example.com is open in this browser.'
            )
        ).toBeInTheDocument()
    })
})
