/**
 * TraefikConfigRefresher — "apply it now" after an operator action.
 *
 * ROUTES need no push at all any more: every ingress task polls them from the API
 * (`TraefikIngressConfigService`, every few seconds), so a deployment or a domain
 * change is live on the next poll with nothing written anywhere. What an operator
 * action CAN change is the ingress PROCESS — a lane switch adds or removes the
 * `direct` host ports, the TLS entrypoint, the connectors and the node doors — and
 * the supervisors only notice that on their next sweep. This re-converges them
 * immediately instead.
 *
 * Fire-and-forget: callers (reachability, deployments, the web-app toggle) never
 * await it; a failure is logged and surfaces through supervisor health.
 */

import { Logger } from '@nestjs/common'
import { Context } from 'effect'

import { runPromiseUnwrapped } from '@deployer/effect-core'
import { type SupervisorOrchestratorShape } from '@deployer/supervision'

import { EDGE_CONNECTOR_SUPERVISOR_ID } from '../../supervisors/platform/edge-connector.supervisor'
import { PLATFORM_INGRESS_SUPERVISOR_ID } from '../../supervisors/platform/traefik.supervisor'

export type TraefikConfigRefresherShape = {
    /** Re-converge the ingress and the edge connector. Never throws. */
    readonly refresh: () => void
}

/**
 * Tag and implementation together. `refresh` returns `void` because its callers are fire-and-forget
 * (`ingressEdgeService.update` does not await it), so it cannot yield the orchestrator: the
 * orchestrator arrives as a constructor argument, which is the only thing `new .live(...)` needs.
 */
export class TraefikConfigRefresher extends Context.Service<
    TraefikConfigRefresher,
    TraefikConfigRefresherShape
>()('shared/TraefikConfigRefresher') {
    static readonly live = class TraefikConfigRefresherImpl
        implements TraefikConfigRefresherShape
    {
        private readonly logger = new Logger('TraefikConfigRefresher')

        constructor(
            private readonly orchestrator: SupervisorOrchestratorShape
        ) {}

        refresh(): void {
            void (async () => {
                for (const id of [
                    PLATFORM_INGRESS_SUPERVISOR_ID,
                    EDGE_CONNECTOR_SUPERVISOR_ID,
                ]) {
                    try {
                        const state = await runPromiseUnwrapped(
                            this.orchestrator.convergeNow(id)
                        )
                        if (state === 'degraded')
                            this.logger.warn(
                                `${id} DEGRADED after an ingress refresh — see supervisor health`
                            )
                    } catch (error) {
                        this.logger.warn(
                            `${id} re-converge failed: ${error instanceof Error ? error.message : String(error)}`
                        )
                    }
                }
            })()
        }
    }
}
