import { Logger } from '@nestjs/common'
import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import type { SupervisorOrchestratorShape } from '@deployer/supervision'

import { EDGE_CONNECTOR_SUPERVISOR_ID } from '../../supervisors/platform/edge-connector.supervisor'
import { PLATFORM_INGRESS_SUPERVISOR_ID } from '../../supervisors/platform/traefik.supervisor'

import { TraefikConfigRefresher } from './traefik-config-refresher.service'

/** `refresh` reads only `convergeNow`; the rest of the registry is unreachable from it. */
const orchestratorOver = (
    convergeNow: SupervisorOrchestratorShape['convergeNow']
): SupervisorOrchestratorShape => ({
    register: () => Effect.void,
    list: () => [],
    has: () => false,
    get: () => null,
    find: () => null,
    awaitMatch: () => Effect.succeed(null),
    getMatching: () => Effect.succeed(null),
    getById: () => Effect.succeed(null),
    ensureAll: Effect.sync(() => new Map()),
    convergeNow,
    degraded: Effect.succeed([]),
    healthOfAll: Effect.succeed([]),
    startDriftControl: Effect.die('unused'),
})

describe('TraefikConfigRefresher', () => {
    it('re-converges the ingress and the tunnel connectors', async () => {
        const convergeNow = vi.fn<SupervisorOrchestratorShape['convergeNow']>(
            () => Effect.succeed('converged')
        )
        new TraefikConfigRefresher.live(orchestratorOver(convergeNow)).refresh()

        await vi.waitFor(() => {
            expect(convergeNow).toHaveBeenCalledTimes(2)
        })
        expect(convergeNow).toHaveBeenNthCalledWith(
            1,
            PLATFORM_INGRESS_SUPERVISOR_ID
        )
        expect(convergeNow).toHaveBeenNthCalledWith(
            2,
            EDGE_CONNECTOR_SUPERVISOR_ID
        )
    })

    it('never throws, and still re-converges the connectors when the ingress fails', async () => {
        const convergeNow = vi.fn<SupervisorOrchestratorShape['convergeNow']>()
        convergeNow
            .mockReturnValueOnce(Effect.die(new Error('engine down')))
            .mockReturnValueOnce(Effect.succeed('converged'))
        const refresher = new TraefikConfigRefresher.live(
            orchestratorOver(convergeNow)
        )
        const warn = vi
            .spyOn(Logger.prototype, 'warn')
            .mockImplementation(() => undefined)

        expect(() => {
            refresher.refresh()
        }).not.toThrow()
        await vi.waitFor(() => {
            expect(convergeNow).toHaveBeenCalledTimes(2)
        })
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('engine down')
        )
    })
})
