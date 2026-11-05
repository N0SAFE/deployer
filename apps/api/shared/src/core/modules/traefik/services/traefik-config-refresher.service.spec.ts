import { Logger } from '@nestjs/common'
import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import type { SupervisorOrchestratorShape } from '@deployer/supervision'

import { EDGE_CONNECTOR_SUPERVISOR_ID } from '../../supervisors/platform/edge-connector.supervisor'
import { PLATFORM_INGRESS_SUPERVISOR_ID } from '../../supervisors/platform/traefik.supervisor'

import { makeTraefikConfigRefresher } from './traefik-config-refresher.service'

describe('TraefikConfigRefresher', () => {
    it('re-converges the ingress and the tunnel connectors', async () => {
        const convergeNow = vi.fn(() => Effect.succeed('converged' as const))
        makeTraefikConfigRefresher({
            convergeNow,
        } as unknown as SupervisorOrchestratorShape).refresh()

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
        const convergeNow = vi
            .fn()
            .mockReturnValueOnce(Effect.fail(new Error('engine down')))
            .mockReturnValueOnce(Effect.succeed('converged'))
        const refresher = makeTraefikConfigRefresher({
            convergeNow,
        } as unknown as SupervisorOrchestratorShape)
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
