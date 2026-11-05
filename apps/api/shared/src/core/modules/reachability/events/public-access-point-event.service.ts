/**
 * Public Access Point Event Service — the global relay.
 *
 * Extends the core pooled event service (`../../events/base`) so the node's
 * public access point state is broadcast through the same event system every
 * other domain uses. Any feature can:
 *   - observe the stream (watchAccessPoint$)
 *   - emit a refreshed state (emitAccessPointUpdated)
 *
 * The contract output is a ZOD DISCRIMINATED UNION on `kind` — one perfectly
 * structured schema for the whole flow.
 */
import { Observable } from 'rxjs'

import { BasePooledEventService } from '../../events/base/index'
import { type CoreEventStreamPoolServiceShape } from '../../events/base/index'

import {
    publicAccessPointEventContracts,
    type PublicAccessPointEventContracts,
    type PublicAccessPointEvent,
} from './public-access-point-event.contracts'

export const ACCESS_POINT_EVENT_SCOPE = 'node'

export class PublicAccessPointEventService extends BasePooledEventService<PublicAccessPointEventContracts> {
    constructor(streamPool?: CoreEventStreamPoolServiceShape) {
        super(
            'public-access-point',
            publicAccessPointEventContracts,
            streamPool
        )
    }

    /** Broadcast a fresh access-point state over the global relay. */
    emitAccessPointUpdated(state: PublicAccessPointEvent): void {
        this.emit(
            'accessPointUpdated',
            { scope: ACCESS_POINT_EVENT_SCOPE },
            state
        )
    }

    /** Observe the global access-point stream (scoped to the node). */
    watchAccessPoint$(): Observable<PublicAccessPointEvent> {
        return this.observePooledEvent$(
            'accessPointUpdated',
            { scope: ACCESS_POINT_EVENT_SCOPE },
            {
                includePersisted: false,
            }
        )
    }
}
