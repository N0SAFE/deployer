import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { actionHash } from '@deployer/auth/server'
import { ForbiddenError } from '@deployer/errors'
import { approvalContract } from '@deployer/identity-contracts'

import { verifySystemActorClaim } from '../auth/system-actor/system-actor'

import { ApprovalGuard } from './approval.guard'

import type { ServiceClientShape } from '../../../server/service-client'

/** A client that records the call and answers with whatever the case needs (resolve or throw). */
function client(answer: () => unknown) {
    const require = vi.fn(() => Promise.resolve().then(answer))
    const systemActorClientFor = vi.fn(
        (_name: string, _contract: unknown, _token: string) => ({ require })
    )
    return {
        services: { systemActorClientFor } as unknown as ServiceClientShape,
        require,
        systemActorClientFor,
    }
}

const SECRET = 'platform-secret-gen-1'
const secrets = (value: string | null = SECRET) => ({
    get: () => Effect.succeed(value),
    accepted: () => Effect.succeed(value === null ? [] : [value]),
})
const guardOf = (services: ServiceClientShape, value?: string | null) =>
    new ApprovalGuard.live(services, secrets(value))

describe('ApprovalGuard', () => {
    it('asks identity about the same digest the requester files', async () => {
        const { services, require, systemActorClientFor } = client(() => ({
            allowed: true,
        }))

        await Effect.runPromise(
            guardOf(services).require(
                'user-1',
                'project:delete',
                'project.delete',
                ['p-1']
            )
        )

        // The question is asked as the system: a claim for identity, signed with the platform secret, naming the requester.
        expect(systemActorClientFor).toHaveBeenCalledWith(
            'identity',
            approvalContract,
            expect.any(String)
        )
        const token = systemActorClientFor.mock.calls[0]?.[2]
        expect(token).toBeDefined()
        expect(
            verifySystemActorClaim(token ?? '', SECRET, 'identity')
        ).toMatchObject({ subject: 'user-1', source: 'approval-guard' })
        expect(
            verifySystemActorClaim(token ?? '', SECRET, 'runtime')
        ).toBeNull()
        expect(
            verifySystemActorClaim(token ?? '', 'another', 'identity')
        ).toBeNull()
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
                guardOf(services).require(
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
                guardOf(services).require(
                    'user-1',
                    'container:exec',
                    'container.exec',
                    ['c-1']
                )
            )
        )

        expect(result._tag).toBe('Failure')
    })

    it('fails closed, without calling identity, when there is no platform secret to sign with', async () => {
        const { services, require, systemActorClientFor } = client(() => ({
            allowed: true,
        }))

        const result = await Effect.runPromise(
            Effect.result(
                guardOf(services, null).require(
                    'user-1',
                    'project:delete',
                    'project.delete',
                    ['p-1']
                )
            )
        )

        expect(result._tag).toBe('Failure')
        expect(systemActorClientFor).not.toHaveBeenCalled()
        expect(require).not.toHaveBeenCalled()
    })
})
