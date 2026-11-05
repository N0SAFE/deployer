import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { provideTo } from '@deployer/effect-core'

import { StorageFailure } from '../../database/storage'

import {
    DomainConflictService,
    validateBasePath,
    validateSubdomain,
} from './domain-conflict.service'
import { ServiceDomainMappingService } from './service-domain-mapping.service'

const row = (basePath: string | null) => ({
    serviceId: 's1',
    serviceName: 'web',
    subdomain: 'api',
    basePath,
})

function conflicts(rows: ReturnType<typeof row>[] | StorageFailure) {
    const mappings = {
        findByProjectDomainAndPathWithServiceNames: () =>
            rows instanceof StorageFailure
                ? Effect.fail(rows)
                : Effect.succeed(rows),
    }
    return provideTo(
        DomainConflictService.live,
        (effect) =>
            effect.pipe(
                Effect.provideService(
                    ServiceDomainMappingService,
                    mappings as never
                )
            ) as Effect.Effect<unknown>
    )
}

describe('DomainConflictService', () => {
    it('is available when nothing uses the subdomain', async () => {
        const result = await Effect.runPromise(
            conflicts([]).checkSubdomainAvailability('pd', 'api', null)
        )
        expect(result.available).toBe(true)
    })

    it('refuses an exact URL match', async () => {
        const result = await Effect.runPromise(
            conflicts([row('/v1')]).checkSubdomainAvailability(
                'pd',
                'api',
                '/v1'
            )
        )
        expect(result.available).toBe(false)
    })

    it('refuses a root path when the subdomain is already used without a base path', async () => {
        const result = await Effect.runPromise(
            conflicts([row(null)]).checkSubdomainAvailability('pd', 'api', null)
        )
        expect(result.available).toBe(false)
    })

    it('shares a subdomain between different base paths', async () => {
        const result = await Effect.runPromise(
            conflicts([row('/v1')]).checkSubdomainAvailability(
                'pd',
                'api',
                '/v2'
            )
        )
        expect(result.available).toBe(true)
    })

    it('fails with the typed storage failure', async () => {
        const failure = new StorageFailure({})
        const error = await Effect.runPromise(
            Effect.flip(
                conflicts(failure).checkSubdomainAvailability('pd', 'api', null)
            )
        )
        expect(error).toBeInstanceOf(StorageFailure)
    })

    it('validates subdomain labels and base paths', () => {
        expect(validateSubdomain('v2.staging.api').valid).toBe(true)
        expect(validateSubdomain('a..b').valid).toBe(false)
        expect(validateBasePath('/v1').valid).toBe(true)
        expect(validateBasePath('v1').valid).toBe(false)
        expect(validateBasePath('/v1/').valid).toBe(false)
    })
})
