import '@orpc/effect/extensions/effect'

import { Context, Effect } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { effectContext } from '@deployer/nest-effect/testing'
import { callProcedure } from '@deployer/orpc-utils/testing'

import {
    HealthRegistryRepository,
    UptimeSource,
} from '../services/health.service'
import { HealthService, SERVICE_NAME } from '../services/health.service'
import { healthRegistryFake, healthSnapshot } from '../testing/health.fixtures'

import { HealthController } from './health.controller'

// Authentication and role checks are the shared middlewares' concern; here they let the call
// through so the rest of the chain runs for real.
vi.mock('@deployer/shared/core/modules/auth/orpc/middlewares', async () => {
    const { os } = await import('@orpc/server')
    const passThrough = () => os.$context().middleware(({ next }) => next())
    return { requireAuth: passThrough, requirePlatformRole: passThrough }
})

/**
 * The health service's contract surface.
 *
 * `.effect()` handlers resolve services from `effect/context`, so the
 * controller is a plain class and the context is built explicitly. The shared
 * test helpers (`callProcedure`, `effectContext`) remove the per-file
 * `~orpc.handler` and Context plumbing.
 */
const runOnce = vi.fn(() => Effect.succeed(healthSnapshot()))

/** The stubbed clock: the controller must forward this exactly, not `process.uptime()`. */
const UPTIME_SECONDS = 42

describe('HealthController', () => {
    let controller: HealthController
    let context: {
        'effect/context': Context.Context<
            HealthService | HealthRegistryRepository | UptimeSource
        >
    }

    beforeEach(() => {
        runOnce.mockReset()
        runOnce.mockImplementation(() => Effect.succeed(healthSnapshot()))

        context = effectContext(
            Context.empty().pipe(
                Context.add(HealthService, new HealthService.live()),
                Context.add(
                    HealthRegistryRepository,
                    healthRegistryFake(runOnce)
                ),
                Context.add(UptimeSource, () => UPTIME_SECONDS)
            )
        )
        controller = new HealthController()
    })

    function call<TOutput>(implementation: unknown): Promise<TOutput> {
        return callProcedure<TOutput>(implementation, {}, context)
    }

    describe('check', () => {
        it('surfaces a registry failure as the declared FAILED_DEPENDENCY error', async () => {
            runOnce.mockImplementation(() =>
                Effect.die(new Error('registry exploded'))
            )

            await expect(call(controller.check())).rejects.toMatchObject({
                code: 'FAILED_DEPENDENCY',
            })
        })

        it('runs a REAL pass rather than reading a cache', async () => {
            await call(controller.check())

            // The container probe (`/health/ready`) reads the cached verdict because it
            // is polled forever; this endpoint is a consumer asking "what is true now",
            // so it must force a pass — otherwise two callers could see different
            // answers to the same question.
            expect(runOnce).toHaveBeenCalled()
        })

        it('reports ok with the per-indicator detail when everything is up', async () => {
            const result = await call<{
                status: string
                indicators: { name: string; status: string }[]
            }>(controller.check())

            expect(result.status).toBe('ok')
            expect(result.indicators[0]?.name).toBe('database')
        })

        it('reports degraded when any indicator is down', async () => {
            runOnce.mockImplementation(() =>
                Effect.succeed(
                    healthSnapshot({
                        status: 'down',
                        indicators: [
                            {
                                name: 'redis',
                                status: 'down',
                                latencyMs: 2,
                                message: 'connection refused',
                            },
                        ],
                    })
                )
            )

            const result = await call<{ status: string }>(controller.check())

            // `degraded` rather than an error: a health endpoint that fails when a
            // dependency is down has hidden the diagnosis it exists to provide.
            expect(result.status).toBe('degraded')
        })
    })

    describe('detailed', () => {
        it("passes Terminus' payload through unchanged", async () => {
            const result = await call<{
                info: Record<string, unknown>
                error: Record<string, unknown>
                details: Record<string, unknown>
            }>(controller.detailed())

            // A Terminus client or UI must be able to consume this without a translator.
            expect(result.info).toHaveProperty('database')
            expect(result.error).toEqual({})
            expect(result.details).toHaveProperty('database')
        })

        it('reports uptime in seconds, as the contract declares', async () => {
            const result = await call<{ uptime: number }>(controller.detailed())

            // Exact, from the stubbed clock: the old `process.uptime() / 1000` in this
            // controller would report 0.042 here, and wall time could never equal 42.
            expect(result.uptime).toBe(UPTIME_SECONDS)
        })

        it('sends the service name from the service, not a controller literal', async () => {
            const result = await call<{ service: string }>(
                controller.detailed()
            )

            expect(result.service).toBe(SERVICE_NAME)
        })

        it('includes the flattened renderable list alongside the Terminus shape', async () => {
            const result = await call<{
                indicators: { name: string; status: string }[]
            }>(controller.detailed())

            expect(result.indicators).toHaveLength(1)
            expect(result.indicators[0]).toMatchObject({
                name: 'database',
                status: 'up',
            })
        })
    })
})
