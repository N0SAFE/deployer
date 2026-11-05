import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { actionHash } from '@deployer/auth/server'
import { ForbiddenError } from '@deployer/errors'
import { approvalContract } from '@deployer/identity-contracts'

import { makeApprovalGuard } from './approval.guard'

import type { ServiceClientShape } from '../../../server/service-client'

/** A client that records the call and answers with whatever the case needs (resolve or throw). */
function client(answer: () => unknown) {
    const require = vi.fn(() => Promise.resolve().then(answer))
    const clientFor = vi.fn(() => ({
        require,
    })) as unknown as ServiceClientShape['clientFor']
    return {
        services: { clientFor } as unknown as ServiceClientShape,
        require,
        clientFor,
    }
}

describe('ApprovalGuard', () => {
    it('asks identity about the same digest the requester files', async () => {
        const { services, require, clientFor } = client(() => ({
            allowed: true,
        }))

        await Effect.runPromise(
            makeApprovalGuard(services).require(
                'user-1',
                'project:delete',
                'project.delete',
                ['p-1']
            )
        )

        expect(clientFor).toHaveBeenCalledWith('identity', approvalContract)
        expect(require).toHaveBeenCalledWith({
            requesterId: 'user-1',
            permission: 'project:delete',
            actionHash: actionHash('project.delete', 'p-1'),
        })
    })

    it("turns a refusal into ForbiddenError, keeping the API's message", async () => {
        const { services } = client(() => {
            throw new Error(
                'approval required: ask another admin to approve action abc'
            )
        })

        const result = await Effect.runPromise(
            Effect.result(
                makeApprovalGuard(services).require(
                    'user-1',
                    'deployment:create',
                    'deployment.create',
                    ['s-1']
                )
            )
        )

        expect(result._tag).toBe('Failure')
        if (result._tag !== 'Failure') return
        expect(result.failure).toBeInstanceOf(ForbiddenError)
        expect(result.failure.message).toContain('approval required')
    })

    it('fails closed when identity is unreachable', async () => {
        const { services } = client(() => {
            throw new TypeError('fetch failed')
        })

        const result = await Effect.runPromise(
            Effect.result(
                makeApprovalGuard(services).require(
                    'user-1',
                    'container:exec',
                    'container.exec',
                    ['c-1']
                )
            )
        )

        expect(result._tag).toBe('Failure')
    })
})
