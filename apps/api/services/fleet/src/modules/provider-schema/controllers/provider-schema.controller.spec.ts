import '@orpc/effect/extensions/effect'

import { Context } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { effectContext } from '@deployer/nest-effect/testing'
import { callProcedure } from '@deployer/orpc-utils/testing'

import { ProviderSchemaService } from '../services/provider-schema.service'

import { ProviderSchemaController } from './provider-schema.controller'

// Authentication is the shared middleware's concern; here it lets the call through so the rest of
// the chain (Effect context, the `.effect()` boundary, error mapping) runs for real.
vi.mock('@deployer/shared/core/modules/auth/orpc/middlewares', async () => {
    const { os } = await import('@orpc/server')
    return { requireAuth: () => os.$context().middleware(({ next }) => next()) }
})

const context = {
    ...effectContext(
        Context.make(ProviderSchemaService, ProviderSchemaService.live)
    ),
    auth: { user: { id: 'u1', role: 'admin' } },
    request: { headers: { 'x-correlation-id': 'c-1' } },
}

const controller = new ProviderSchemaController()
const call = <T>(implementation: unknown, input: unknown = {}) =>
    callProcedure<T>(implementation, input, context)

describe('ProviderSchemaController', () => {
    it('shapes the provider list to the contract, with its total', async () => {
        const result = await call<{ providers: unknown[]; total: number }>(
            controller.getAllProviders()
        )
        expect(result.total).toBe(result.providers.length)
        expect(result.total).toBeGreaterThan(0)
    })

    it('lists the builders compatible with a provider', async () => {
        const result = await call<{
            builders: { id: string }[]
            total: number
        }>(controller.getCompatibleBuilders(), {
            params: { providerId: 'github' },
        })
        expect(result.total).toBe(result.builders.length)
        expect(result.builders.length).toBeGreaterThan(0)
    })

    it('validates a config and reports the failing field', async () => {
        const result = await call<{ valid: boolean; errors: string[] }>(
            controller.validateProviderConfig(),
            {
                params: { providerId: 'github' },
                body: { config: { repositoryUrl: 'not-a-url' } },
            }
        )
        expect(result.valid).toBe(false)
        expect(
            result.errors.some((line) => line.startsWith('repositoryUrl'))
        ).toBe(true)
    })

    it("answers an unknown provider as the contract's NOT_FOUND, with the service's sentence", async () => {
        await expect(
            call(controller.getProviderSchema(), {
                params: { id: 'no-such-provider' },
            })
        ).rejects.toMatchObject({
            code: 'NOT_FOUND',
            message: "Provider schema 'no-such-provider' not found",
        })
    })

    it('answers an unknown builder the same way, for every lookup that takes one', async () => {
        await expect(
            call(controller.getCompatibleProviders(), {
                params: { builderId: 'nope' },
            })
        ).rejects.toMatchObject({
            code: 'NOT_FOUND',
        })
        await expect(
            call(controller.validateBuilderConfig(), {
                params: { builderId: 'nope' },
                body: { config: {} },
            })
        ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })
})
