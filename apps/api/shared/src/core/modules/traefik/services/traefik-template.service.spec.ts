import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { provideTo } from '@deployer/effect-core'

import { StorageFailure } from '../../database/storage'
import {
    TraefikTemplateCreateFailure,
    TraefikTemplateNotFound,
    TraefikTemplateVariablesMissing,
} from '../errors'
import { TraefikTemplateRepository } from '../repositories/traefik-template.repository'

import {
    buildVariablesMetadata,
    extractVariables,
    parseTemplate,
    TraefikTemplateService,
    validateVariables,
} from './traefik-template.service'

import type { TraefikTemplateRepositoryShape } from '../repositories/traefik-template.repository'

function repo(overrides: Record<string, unknown> = {}) {
    return {
        findProviderByType: vi.fn(() => Effect.succeed(null)),
        findActiveByServiceId: vi.fn(() => Effect.succeed(null)),
        createProviderTemplate: vi.fn((data: object) =>
            Effect.succeed({ ...data })
        ),
        createServiceTemplate: vi.fn((data: object) =>
            Effect.succeed({ ...data })
        ),
        updateServiceTemplate: vi.fn((id: string, data: object) =>
            Effect.succeed({ id, ...data })
        ),
        ...overrides,
    } as unknown as TraefikTemplateRepositoryShape
}

const serviceOver = (repository: TraefikTemplateRepositoryShape) =>
    provideTo(
        new TraefikTemplateService.live(),
        (effect) =>
            effect.pipe(
                Effect.provideService(TraefikTemplateRepository, repository)
            ) as Effect.Effect<unknown>
    )

describe('template helpers', () => {
    it('replaces placeholders and leaves unknown ones', () => {
        expect(
            parseTemplate('Host(`~##host##~`) ~##other##~', { host: 'a.test' })
        ).toBe('Host(`a.test`) ~##other##~')
    })

    it('extracts each variable once', () => {
        expect(extractVariables('~##host## ~ ~##host##~ ~## port ##~')).toEqual(
            ['host', 'port']
        )
    })

    it('reports missing required variables', () => {
        const required = buildVariablesMetadata(['host', 'subdomain'])
        expect(validateVariables(required, { subdomain: 'x' })).toEqual({
            valid: false,
            missing: ['host'],
        })
        expect(validateVariables(required, { host: 'a' }).valid).toBe(true)
    })
})

describe('TraefikTemplateService', () => {
    it('creates a service template with generated variable metadata', async () => {
        const repository = repo()
        const created = await Effect.runPromise(
            serviceOver(repository).createServiceTemplate({
                serviceId: 's1',
                templateContent: '~##host##~',
            } as never)
        )
        expect(created).toMatchObject({ serviceId: 's1', isActive: true })
        expect(
            (
                created as unknown as {
                    variables: Record<string, { required: boolean }>
                }
            ).variables.host?.required
        ).toBe(true)
    })

    it('fails with TraefikTemplateCreateFailure when the insert returns no row', async () => {
        const service = serviceOver(
            repo({ createServiceTemplate: () => Effect.succeed(null) })
        )
        const error = await Effect.runPromise(
            Effect.flip(
                service.createServiceTemplate({
                    serviceId: 's1',
                    templateContent: 'x',
                } as never)
            )
        )
        expect(error).toBeInstanceOf(TraefikTemplateCreateFailure)
    })

    it('fails with TraefikTemplateNotFound when updating an unknown template', async () => {
        const service = serviceOver(
            repo({ updateServiceTemplate: () => Effect.succeed(null) })
        )
        expect(
            await Effect.runPromise(
                Effect.flip(
                    service.updateServiceTemplate('t1', { isActive: false })
                )
            )
        ).toBeInstanceOf(TraefikTemplateNotFound)
    })

    it("prefers the service template, falls back to the provider's, and renders it", async () => {
        const provider = {
            templateContent: '~##host##~',
            variables: buildVariablesMetadata(['host']),
        }
        const service = serviceOver(
            repo({ findProviderByType: () => Effect.succeed(provider) })
        )
        expect(
            await Effect.runPromise(
                service.renderTemplateForDeployment('s1', 'docker', {
                    host: 'a.test',
                })
            )
        ).toBe('a.test')
        expect(
            await Effect.runPromise(
                Effect.flip(
                    service.renderTemplateForDeployment('s1', 'docker', {})
                )
            )
        ).toBeInstanceOf(TraefikTemplateVariablesMissing)
        expect(
            await Effect.runPromise(
                serviceOver(repo()).renderTemplateForDeployment(
                    's1',
                    'none',
                    {}
                )
            )
        ).toBeNull()
    })

    it('surfaces the typed storage failure', async () => {
        const service = serviceOver(
            repo({
                findActiveByServiceId: () =>
                    Effect.fail(new StorageFailure({})),
            })
        )
        expect(
            await Effect.runPromise(
                Effect.flip(service.getServiceTemplate('s1'))
            )
        ).toBeInstanceOf(StorageFailure)
    })
})
