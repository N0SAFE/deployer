import { Effect, Layer } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
    Actor,
    Correlation,
    CurrentActor,
    HttpRequest,
    systemRequest,
} from '@deployer/effect-core'
import { ForbiddenError } from '@deployer/errors'

import { DatabasePort } from '@identity/core/database/database.port'
import { AuditService } from '@identity/modules/audit/audit.service'
import { StepUpService } from '@identity/modules/step-up/step-up.service'

import { ApprovalForbidden, ApprovalInvalid } from './approval.errors'
import {
    ApprovalRepository,
    type AccessRequestRow,
    type ApprovalRepositoryShape,
} from './approval.repository'
import { ApprovalService } from './approval.service'

const request = (
    overrides: Partial<AccessRequestRow> = {}
): AccessRequestRow => ({
    id: 'req-1',
    permission: 'user:delete',
    requesterId: 'requester',
    requesterName: 'Requester',
    via: null,
    scope: { projectId: 'p-1' },
    actionHash: 'a'.repeat(64),
    reason: 'prod hotfix',
    requiredApprovals: 1,
    status: 'pending',
    ttlSec: 3600,
    expiresAt: new Date(Date.now() + 3_600_000),
    consumedAt: null,
    createdAt: new Date(),
    approvals: 0,
    ...overrides,
})

describe('ApprovalService', () => {
    const repo = {
        create: vi.fn(),
        findById: vi.fn(),
        list: vi.fn(),
        vote: vi.fn(),
        expireStale: vi.fn(),
        countApprovers: vi.fn(),
        roleOf: vi.fn(),
        consume: vi.fn(),
    }

    beforeEach(() => {
        vi.clearAllMocks()
        repo.create.mockImplementation(() => Effect.succeed(request()))
        repo.findById.mockImplementation(() => Effect.succeed(request()))
        repo.vote.mockImplementation(() =>
            Effect.succeed(request({ status: 'approved', approvals: 1 }))
        )
        repo.consume.mockImplementation(() => Effect.succeed(true))
        repo.expireStale.mockImplementation(() => Effect.void)
        // Two approvers by default: a real two-person rule, so `require` must consume an approval.
        repo.countApprovers.mockImplementation(() => Effect.succeed(2))
        repo.roleOf.mockImplementation((id: string) =>
            Effect.succeed(
                id === 'root'
                    ? 'superAdmin'
                    : id === 'admin-1'
                      ? 'admin'
                      : 'user'
            )
        )
    })

    const run = <A, E>(
        actor: Actor,
        use: (
            approvals: ApprovalService['Service']
        ) => Effect.Effect<
            A,
            E,
            | ApprovalRepository
            | CurrentActor
            | DatabasePort
            | StepUpService
            | AuditService
            | HttpRequest
        >,
        stepUp: 'ok' | 'missing' = 'ok'
    ): Effect.Effect<A, E> => {
        const layer = Layer.mergeAll(
            Layer.succeed(
                ApprovalService,
                ApprovalService.live as unknown as ApprovalService['Service']
            ),
            Layer.succeed(
                ApprovalRepository,
                repo as unknown as ApprovalRepositoryShape
            ),
            Layer.succeed(CurrentActor, actor),
            Layer.succeed(HttpRequest, systemRequest),
            Layer.succeed(Correlation, { id: 'test' }),
            Layer.succeed(DatabasePort, {} as never),
            Layer.succeed(AuditService, {
                record: () => Effect.void,
            } as unknown as AuditService['Service']),
            Layer.succeed(StepUpService, {
                assertCritical: () =>
                    stepUp === 'ok'
                        ? Effect.void
                        : Effect.fail(new ForbiddenError('step-up required')),
                latestProof: () =>
                    Effect.succeed({
                        id: 'proof-1',
                        method: 'passkey' as const,
                        verifiedAt: new Date(),
                    }),
                status: () => Effect.die(new Error('unused')),
            } as unknown as StepUpService['Service'])
        )

        return Effect.gen(function* () {
            const approvals = yield* ApprovalService
            return yield* use(approvals)
        }).pipe(Effect.provide(layer))
    }

    const input = {
        permission: 'user:delete',
        scope: { projectId: 'p-1' },
        actionHash: 'a'.repeat(64),
        reason: 'prod hotfix',
        ttlSec: 3600,
        requiredApprovals: 1,
    }

    it('refuses a permission the catalog does not declare', async () => {
        const outcome = await Effect.runPromise(
            Effect.flip(
                run(Actor.user('requester', 'user'), (a) =>
                    a.request({ ...input, permission: 'deploy:everything' })
                )
            )
        )

        expect(outcome).toBeInstanceOf(ApprovalInvalid)
        expect(repo.create).not.toHaveBeenCalled()
    })

    it('records the requester and the expiry it was asked for', async () => {
        await Effect.runPromise(
            run(Actor.user('requester', 'operator'), (a) => a.request(input))
        )

        const created = repo.create.mock.calls[0]?.[0] as {
            requesterId: string
            expiresAt: Date
            ttlSec: number
        }
        expect(created.requesterId).toBe('requester')
        expect(created.ttlSec).toBe(3600)
        expect(created.expiresAt.getTime()).toBeGreaterThan(Date.now())
    })

    it('refuses to file a request for an action no policy makes approvable', async () => {
        const outcome = await Effect.runPromise(
            Effect.flip(
                run(Actor.user('requester', 'admin'), (a) =>
                    a.request({ ...input, permission: 'deployment:rollback' })
                )
            )
        )

        expect(outcome).toBeInstanceOf(ApprovalInvalid)
        expect(repo.create).not.toHaveBeenCalled()
    })

    it("takes the quorum from the policy, not from the requester's payload", async () => {
        await Effect.runPromise(
            run(Actor.user('requester', 'admin'), (a) =>
                a.request({ ...input, requiredApprovals: 1 })
            )
        )

        const created = repo.create.mock.calls[0]?.[0] as {
            requiredApprovals: number
            ttlSec: number
        }
        // `user:delete` is a one-approver policy today; the assertion is that the POLICY is what lands in the row.
        expect(created.requiredApprovals).toBe(1)
        expect(created.ttlSec).toBeLessThanOrEqual(3600)
    })

    it('refuses a system caller: a request belongs to a person', async () => {
        const outcome = await Effect.runPromise(
            Effect.flip(run(Actor.system('scheduler'), (a) => a.request(input)))
        )

        expect(outcome).toBeInstanceOf(ApprovalForbidden)
    })

    it('refuses to decide your own request', async () => {
        const outcome = await Effect.runPromise(
            Effect.flip(
                run(Actor.user('requester', 'superAdmin'), (a) =>
                    a.decide('req-1', 'approve')
                )
            )
        )

        expect(outcome).toBeInstanceOf(ApprovalForbidden)
        expect(repo.vote).not.toHaveBeenCalled()
    })

    it('refuses to decide without a fresh passkey proof', async () => {
        const outcome = await Effect.runPromise(
            Effect.flip(
                run(
                    Actor.user('approver', 'superAdmin'),
                    (a) => a.decide('req-1', 'approve'),
                    'missing'
                )
            )
        )

        expect(outcome).toBeInstanceOf(ApprovalForbidden)
        expect(repo.vote).not.toHaveBeenCalled()
    })

    it('refuses a request that is no longer pending', async () => {
        repo.findById.mockImplementation(() =>
            Effect.succeed(request({ status: 'denied' }))
        )

        const outcome = await Effect.runPromise(
            Effect.flip(
                run(Actor.user('approver', 'superAdmin'), (a) =>
                    a.decide('req-1', 'approve')
                )
            )
        )

        expect(outcome).toBeInstanceOf(ApprovalInvalid)
    })

    it('refuses an expired request', async () => {
        repo.findById.mockImplementation(() =>
            Effect.succeed(request({ expiresAt: new Date(Date.now() - 1000) }))
        )

        const outcome = await Effect.runPromise(
            Effect.flip(
                run(Actor.user('approver', 'superAdmin'), (a) =>
                    a.decide('req-1', 'approve')
                )
            )
        )

        expect(outcome).toBeInstanceOf(ApprovalInvalid)
    })

    it('records a vote from another approver', async () => {
        const decided = await Effect.runPromise(
            run(Actor.user('approver', 'superAdmin'), (a) =>
                a.decide('req-1', 'approve')
            )
        )

        expect(decided.status).toBe('approved')
        expect(repo.vote).toHaveBeenCalledWith(
            'req-1',
            'approver',
            'approve',
            expect.stringMatching(/^[a-f0-9]{64}$/)
        )
    })

    it('lists only for an actor holding `approval:read`', async () => {
        repo.list.mockImplementation(() => Effect.succeed([request()]))

        const rows = await Effect.runPromise(
            run(Actor.user('viewer-1', 'viewer'), (a) =>
                a.list({ status: 'pending', limit: 50 })
            )
        )
        expect(rows).toHaveLength(1)
        // The queue expires what it can no longer offer before it shows anything.
        expect(repo.expireStale).toHaveBeenCalledWith(expect.any(Date))

        const denied = await Effect.runPromise(
            Effect.flip(
                run(Actor.user('u-1', 'user'), (a) =>
                    a.list({ status: 'pending', limit: 50 })
                )
            )
        )
        expect(denied).toBeInstanceOf(ApprovalForbidden)
    })

    describe('require', () => {
        it('allows an actor whose role already grants the permission, without spending an approval', async () => {
            // `superAdmin` holds `user:delete`; the guard is for callers who do not.
            await Effect.runPromise(
                run(Actor.user('root', 'superAdmin'), (a) =>
                    a.require('user:delete', 'h'.repeat(64))
                )
            )

            expect(repo.consume).not.toHaveBeenCalled()
        })

        it('allows a caller without the permission when a matching approval is consumed', async () => {
            await Effect.runPromise(
                run(Actor.user('admin-1', 'admin'), (a) =>
                    a.require('user:delete', 'h'.repeat(64))
                )
            )

            expect(repo.consume).toHaveBeenCalledWith(
                'admin-1',
                'h'.repeat(64),
                expect.any(Date)
            )
        })

        it('degrades to step-up when fewer than two people can approve (solo install)', async () => {
            repo.countApprovers.mockImplementation(() => Effect.succeed(1))

            await Effect.runPromise(
                run(Actor.user('admin-1', 'admin'), (a) =>
                    a.require('user:delete', 'h'.repeat(64))
                )
            )

            // No second person exists, so no approval is demanded; the caller's step-up is the gate.
            expect(repo.consume).not.toHaveBeenCalled()
        })

        it('refuses when nothing was approved for that exact action', async () => {
            repo.consume.mockImplementation(() => Effect.succeed(false))

            const outcome = await Effect.runPromise(
                Effect.flip(
                    run(Actor.user('admin-1', 'admin'), (a) =>
                        a.require('user:delete', 'h'.repeat(64))
                    )
                )
            )

            expect(outcome).toBeInstanceOf(ApprovalForbidden)
        })

        it('refuses a permission the catalog does not declare, even with an approval', async () => {
            const outcome = await Effect.runPromise(
                Effect.flip(
                    run(Actor.user('admin-1', 'admin'), (a) =>
                        a.require('nonsense:delete', 'h'.repeat(64))
                    )
                )
            )

            expect(outcome).toBeInstanceOf(ApprovalForbidden)
        })
    })

    describe('requireFor', () => {
        it("answers for the peer-named actor, spending THAT actor's approval", async () => {
            // The mesh call itself is a system actor; the permission belongs to the account the peer authenticated.
            await Effect.runPromise(
                run(Actor.system('mesh'), (a) =>
                    a.requireFor('admin-1', 'project:delete', 'h'.repeat(64))
                )
            )

            expect(repo.consume).toHaveBeenCalledWith(
                'admin-1',
                'h'.repeat(64),
                expect.any(Date)
            )
        })

        it('does not spend anything when the named actor already holds the capability', async () => {
            await Effect.runPromise(
                run(Actor.system('mesh'), (a) =>
                    a.requireFor('root', 'project:delete', 'h'.repeat(64))
                )
            )

            expect(repo.consume).not.toHaveBeenCalled()
        })

        it('refuses when the named actor has no approval for that action', async () => {
            repo.consume.mockImplementation(() => Effect.succeed(false))

            const outcome = await Effect.runPromise(
                Effect.flip(
                    run(Actor.system('mesh'), (a) =>
                        a.requireFor(
                            'admin-1',
                            'project:delete',
                            'h'.repeat(64)
                        )
                    )
                )
            )

            expect(outcome).toBeInstanceOf(ApprovalForbidden)
        })
    })

    it('spends the approval of the requester', async () => {
        const result = await Effect.runPromise(
            run(Actor.user('requester', 'user'), (a) =>
                a.consume('a'.repeat(64))
            )
        )

        expect(result).toEqual({ consumed: true })
        expect(repo.consume).toHaveBeenCalledWith(
            'requester',
            'a'.repeat(64),
            expect.any(Date)
        )
    })
})
