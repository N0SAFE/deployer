import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import type { EffectHostShape } from '@deployer/nest-effect'

import { deriveIngressProviderToken } from '../../platform-ingress/services/ingress-provider-token'

import { TraefikIngressConfigController } from './traefik-ingress-config.controller'

import type { SecretShape } from '../../auth/orpc/secrets'
import type { TraefikIngressConfigServiceShape } from '../services/traefik-ingress-config.service'

const config = { http: { routers: {}, services: {} } }

function controller() {
    const service = {
        buildDynamicConfig: vi.fn(() => Effect.succeed(config)),
    } as unknown as TraefikIngressConfigServiceShape
    const secrets: SecretShape = { get: () => Effect.succeed('s3cret') }
    const host = {
        runUnwrapped: (effect: Effect.Effect<unknown>) =>
            Effect.runPromise(effect),
    } as unknown as EffectHostShape
    const response = { status: vi.fn() }
    return {
        controller: new TraefikIngressConfigController(service, secrets, host),
        service,
        response,
    }
}

describe('TraefikIngressConfigController', () => {
    it('serves the dynamic configuration to an ingress presenting the derived token', async () => {
        const { controller: c, response } = controller()
        expect(
            await c.dynamicConfig(
                deriveIngressProviderToken('s3cret'),
                response
            )
        ).toBe(config)
        expect(response.status).not.toHaveBeenCalled()
    })

    it('answers anyone else with a plain 401: the endpoint is reachable through Traefik itself', async () => {
        const { controller: c, service, response } = controller()
        expect(await c.dynamicConfig(undefined, response)).toEqual({
            error: 'invalid ingress token',
        })
        expect(await c.dynamicConfig('guess', response)).toEqual({
            error: 'invalid ingress token',
        })
        expect(response.status).toHaveBeenCalledWith(401)
        expect(service.buildDynamicConfig).not.toHaveBeenCalled()
    })
})
