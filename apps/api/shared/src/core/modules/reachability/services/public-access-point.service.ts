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

import type { ReachabilityServiceShape } from './reachability.service'
import type { PublicAccessPointEvent } from '../events/public-access-point-event.contracts'
import type { PublicAccessPointEventService } from '../events/public-access-point-event.service'
import type { ReachabilityDependencyFailure } from '../reachability.errors'
import type { Observable } from 'rxjs'

export type PublicAccessPointServiceShape = {
    /** Re-check availability (probes the node's own endpoints), emit the result on the relay, and return it. */
    readonly getAccessPoint: () => Effect.Effect<
        PublicAccessPointEvent,
        ReachabilityDependencyFailure
    >
    /** Every state push on the global access-point relay. */
    readonly watchAccessPoint: () => Observable<PublicAccessPointEvent>
}

type Ports = {
    readonly reachability: Pick<
        ReachabilityServiceShape,
        'resolveAccessPointState'
    >
    /** The pooled event service stays a class until the events module migrates. */
    readonly accessPointEvents: Pick<
        PublicAccessPointEventService,
        'emitAccessPointUpdated' | 'watchAccessPoint$'
    >
}

export function makePublicAccessPointService({
    reachability,
    accessPointEvents,
}: Ports): PublicAccessPointServiceShape {
    return {
        getAccessPoint: () =>
            reachability.resolveAccessPointState().pipe(
                Effect.tap((state) =>
                    Effect.sync(() => {
                        accessPointEvents.emitAccessPointUpdated(state)
                    })
                )
            ),
        watchAccessPoint: () => accessPointEvents.watchAccessPoint$(),
    }
}

export class PublicAccessPointService extends Context.Service<
    PublicAccessPointService,
    PublicAccessPointServiceShape
>()('shared/PublicAccessPointService') {}
