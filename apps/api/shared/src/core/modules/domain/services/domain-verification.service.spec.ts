import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { ProjectDomainNotFoundError } from '../errors'

import { DatabasePort } from '../../database/storage'
import { makeDomainVerificationService } from './domain-verification.service'

import type { ProjectDomainRepositoryShape } from '../repositories/project-domain.repository'

const verified = {
    id: 'd1',
    projectId: 'p1',
    domain: 'a.test',
    verificationStatus: 'verified',
    verifiedAt: new Date(0),
}

function service(domain: unknown) {
    const repository = {
        findById: vi.fn(() => Effect.succeed(domain)),
        update: vi.fn(() => Effect.succeed(domain)),
        findByProjectId: vi.fn(() =>
            Effect.succeed([
                { verificationStatus: 'pending' },
                { verificationStatus: 'verified' },
            ])
        ),
    } as unknown as ProjectDomainRepositoryShape
    return { repository, service: makeDomainVerificationService(repository, {} as never) }
}

/**
 * Runs an operation with the database port its repository leaves open; the fake repository never
 * touches it, and providing it is what discharges the channel.
 */
const run = <A, E>(effect: Effect.Effect<A, E, DatabasePort>): Promise<A> =>
    Effect.runPromise(Effect.provideService(effect, DatabasePort, {} as never))

describe('DomainVerificationService', () => {
    it('fails with ProjectDomainNotFoundError when the domain belongs to another project', async () => {
        const error = await run(
            Effect.flip(
                service(verified).service.verifyProjectDomain('other', 'd1')
            )
        )
        expect(error).toBeInstanceOf(ProjectDomainNotFoundError)
    })

    it('answers an already verified domain without touching DNS or the row', async () => {
        const t = service(verified)
        const result = await run(
            t.service.verifyProjectDomain('p1', 'd1')
        )
        expect(result).toMatchObject({ success: true, status: 'verified' })
        expect(t.repository.update).not.toHaveBeenCalled()
    })

    it('counts pending domains', async () => {
        expect(
            await run(
                service(verified).service.getPendingDomainsCount('p1')
            )
        ).toBe(1)
    })

    it('declares its sweep in the shape, and no onStart', () => {
        const { service: s } = service(verified)
        expect(s.run).toBeTypeOf('function')
        expect(s.onStart).toBeUndefined()
    })

    it('builds a verification token carrying the domain', () => {
        expect(
            service(verified).service.generateVerificationToken('a.test')
        ).toMatch(/^deployer-verify-[0-9a-f]{32}-a\.test$/)
    })
})
