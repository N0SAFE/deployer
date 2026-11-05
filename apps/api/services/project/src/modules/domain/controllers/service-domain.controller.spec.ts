import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@orpc/nest', () => ({ Implement: () => () => undefined }))
vi.mock('@deployer/nest-effect', () => {
    const builder = {
        use: () => builder,
        effect: (handler: unknown) => ({ handler }),
    }
    return { procedure: () => builder }
})
vi.mock('@deployer/shared/core/modules/auth/orpc/middlewares', () => ({
    requireAuth: () => ({}),
}))

import { ServiceDomainController } from './service-domain.controller'

describe('ServiceDomainController', () => {
    let controller: ServiceDomainController

    beforeEach(() => {
        controller = new ServiceDomainController()
    })

    it.each([
        [
            'checkSubdomainAvailability',
            () => controller.checkSubdomainAvailability(),
        ],
        ['listServiceDomains', () => controller.listServiceDomains()],
        ['addServiceDomain', () => controller.addServiceDomain()],
        ['updateServiceDomain', () => controller.updateServiceDomain()],
        ['setPrimaryServiceDomain', () => controller.setPrimaryServiceDomain()],
        ['removeServiceDomain', () => controller.removeServiceDomain()],
    ])('binds %s to a handler', (_name, build) => {
        const procedure = build() as unknown as { handler: unknown }
        expect(typeof procedure.handler).toBe('function')
    })
})
