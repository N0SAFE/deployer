import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { API_SERVICE_NAMES } from '@deployer/env'

import { makePlatformHealthService } from './platform-health.service'

const answer = (status: number) =>
    (() =>
        Promise.resolve(
            new Response(null, { status })
        )) as unknown as typeof fetch
const run = (fetchReady: typeof fetch) =>
    Effect.runPromise(makePlatformHealthService(fetchReady).getHealth())

describe('PlatformHealthService', () => {
    it('is healthy when every service answers ready', async () => {
        const health = await run(answer(200))
        expect(health.state).toBe('healthy')
        expect(health.services).toHaveLength(API_SERVICE_NAMES.length)
    })

    it('is degraded when a service answers but is not ready', async () => {
        const health = await run(answer(503))
        expect(health.state).toBe('degraded')
        expect(health.services[0]).toMatchObject({
            healthy: false,
            reason: 'not ready (starting or a dependency is down)',
        })
    })

    it('is unreachable when no service answers, and never fails', async () => {
        const health = await run((() =>
            Promise.reject(
                new Error('ECONNREFUSED')
            )) as unknown as typeof fetch)
        expect(health.state).toBe('unreachable')
        expect(
            health.services.every((service) => service.latencyMs === undefined)
        ).toBe(true)
    })
})
