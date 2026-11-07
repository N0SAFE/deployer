/**
 * Public Access Point Service — first-class core service.
 *
 * The single entry point for every feature that needs to know where this node is publicly reachable and whether it is
 * actually up. It uses the CORE EVENT SYSTEM (`PublicAccessPointEventService`) as the global relay: the state is a Zod
 * discriminated union (`kind`: ip | hostname | tunnel | null).
 *
 *   - `getAccessPoint()`  — request ⇒ live re-check ⇒ emit onto the global relay ⇒ return the fresh state.
 *   - `watchAccessPoint()` — subscribe to the global event relay to receive the current state, whenever it changes.
 *
 * The access point can be a public IP, a hostname, or a DNS-provider-backed tunnel, all derived from the node network config
 * and the lanes — never env vars.
 */
import { Context, Effect } from 'effect'

import { EdgeProviderRegistry } from '../../edge/edge-provider.registry'
import { EgressService } from '../../egress/egress.service'
import { ClusterSettings } from '../../mesh-node/cluster-settings'
import { IngressLanesService } from '../../platform-ingress/services/ingress-lanes.service'

import { ReachabilityService } from './reachability.service'

import type { PublicAccessPointEvent } from '../events/public-access-point-event.contracts'
import type { PublicAccessPointEventService } from '../events/public-access-point-event.service'
import type { ReachabilityDependencyFailure } from '../reachability.errors'
import type { Observable } from 'rxjs'

/** The relay this service writes to: a Nest-owned pooled event service, so it is handed over at construction. */
type AccessPointRelay = Pick<
    PublicAccessPointEventService,
    'emitAccessPointUpdated' | 'watchAccessPoint$'
>

export type PublicAccessPointServiceShape = {
    /** Re-check availability (probes the node's own endpoints), emit the result on the relay, and return it. */
    readonly getAccessPoint: () => Effect.Effect<
        PublicAccessPointEvent,
        ReachabilityDependencyFailure,
        | ReachabilityService
        | IngressLanesService
        | EdgeProviderRegistry
        | ClusterSettings
        | EgressService
    >
    /** Every state push on the global access-point relay. */
    readonly watchAccessPoint: () => Observable<PublicAccessPointEvent>
}

/**
 * Tag and implementation together: the tag is the contract, `live` the one implementation.
 *
 * The relay is a constructor argument because it is a Promise/RxJS-based Nest provider, not an Effect service: the module
 * builds `new PublicAccessPointService.live(events)`. The state itself is yielded per call.
 */
export class PublicAccessPointService extends Context.Service<
    PublicAccessPointService,
    PublicAccessPointServiceShape
>()('shared/PublicAccessPointService') {
    static readonly live = class PublicAccessPointServiceImpl
        implements PublicAccessPointServiceShape
    {
        constructor(private readonly relay: AccessPointRelay) {}

        getAccessPoint(): ReturnType<
            PublicAccessPointServiceShape['getAccessPoint']
        > {
            return Effect.gen({ self: this }, function* () {
                const reachability = yield* ReachabilityService
                const state = yield* reachability.resolveAccessPointState()
                yield* Effect.sync(() => {
                    this.relay.emitAccessPointUpdated(state)
                })
                return state
            })
        }

        watchAccessPoint(): Observable<PublicAccessPointEvent> {
            return this.relay.watchAccessPoint$()
        }
    }
}
