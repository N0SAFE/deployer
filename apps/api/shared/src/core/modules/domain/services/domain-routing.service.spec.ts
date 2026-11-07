import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { provideTo } from '@deployer/effect-core'

import { TraefikRepository } from '../../traefik/repositories/traefik.repository'
import { TraefikVariableResolverService } from '../../traefik/services/traefik-variable-resolver.service'
import { ServiceDomainMappingRepository } from '../repositories/service-domain-mapping.repository'

import { DomainRoutingService } from './domain-routing.service'

const urlRow = {
    mappingId: 'm1',
    subdomain: 'api',
    basePath: '/v1',
    isPrimary: true,
    sslEnabled: true,
    sslProvider: 'letsencrypt' as const,
    orgDomain: 'example.com',
}

/** The live class over the tags each method yields — the shape channels, exercised. */
const routing = (
    mappings: Partial<ServiceDomainMappingRepository['Service']>,
    traefik: Partial<TraefikRepository['Service']> = {}
) =>
    provideTo(new DomainRoutingService.live(), (effect) =>
        effect.pipe(
            Effect.provideService(
                ServiceDomainMappingRepository,
                mappings as ServiceDomainMappingRepository['Service']
            ),
            Effect.provideService(
                TraefikRepository,
                traefik as TraefikRepository['Service']
            ),
            Effect.provideService(
                TraefikVariableResolverService,
                TraefikVariableResolverService.live
            )
        ) as Effect.Effect<unknown>
    )

describe('DomainRoutingService', () => {
    it('maps url rows to reachable URLs, base path normalized', async () => {
        const service = routing({
            findServiceUrlRows: () =>
                Effect.succeed([{ ...urlRow, basePath: 'v1/' }]),
        })
        const urls = await Effect.runPromise(service.resolveServiceUrls('s1'))
        expect(urls).toEqual([
            {
                mappingId: 'm1',
                host: 'api.example.com',
                domain: 'example.com',
                subdomain: 'api',
                basePath: '/v1',
                fullUrl: 'https://api.example.com/v1',
                isPrimary: true,
                sslEnabled: true,
                sslProvider: 'letsencrypt',
            },
        ])
    })

    it('resolves the primary URL', async () => {
        const service = routing({
            findServiceUrlRows: () => Effect.succeed([urlRow]),
        })
        expect(
            await Effect.runPromise(service.resolvePrimaryUrl('s1'))
        ).toBe('https://api.example.com/v1')
    })

    it('answers null when the service has no mapping', async () => {
        const service = routing({
            findServiceUrlRows: () => Effect.succeed([]),
        })
        expect(
            await Effect.runPromise(service.resolvePrimaryUrl('s1'))
        ).toBeNull()
    })

    it('returns false when a preview route has no config', async () => {
        const service = routing(
            {},
            { getServiceConfigByServiceId: () => Effect.succeed(undefined) }
        )
        expect(
            await Effect.runPromise(service.removePreviewRoute('s1', 'p.x.com'))
        ).toBe(false)
    })

    it('surfaces the storage failure of the mapping read', async () => {
        const service = routing({
            findServiceUrlRows: () =>
                Effect.fail({ _tag: 'StorageFailure' } as never),
        })
        await expect(
            Effect.runPromise(service.resolveServiceUrls('s1'))
        ).rejects.toMatchObject({ _tag: 'StorageFailure' })
    })
})
