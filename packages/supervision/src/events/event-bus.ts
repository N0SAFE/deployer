import { Context, Effect, Layer, PubSub, Stream } from 'effect'

import {
    matchesEventFilter,
    type SupervisorEvent,
    type SupervisorEventFilter,
} from './supervisor-event'

export type SupervisorEventBusShape = {
    /** Publishes an event to everyone listening now. */
    readonly emit: (event: SupervisorEvent) => Effect.Effect<void>
    /** Every event, from the moment the stream is run. */
    readonly events: Stream.Stream<SupervisorEvent>
    /** The events matching `filter`. */
    readonly of: (
        filter?: SupervisorEventFilter
    ) => Stream.Stream<SupervisorEvent>
    /** Waits for the next event matching `filter`. */
    readonly once: (
        filter?: SupervisorEventFilter
    ) => Effect.Effect<SupervisorEvent>
}

/**
 * The one implementation of `SupervisorEventBusShape`.
 *
 * Its pub/sub hub is created in `create`, so `live` is an Effect that resolves the bus rather
 * than a bare class: the hub cannot exist before the Effect runtime does.
 */
class SupervisorEventBusImpl implements SupervisorEventBusShape {
    constructor(private readonly pubsub: PubSub.PubSub<SupervisorEvent>) {}

    get events(): Stream.Stream<SupervisorEvent> {
        return Stream.fromPubSub(this.pubsub)
    }

    emit(event: SupervisorEvent): Effect.Effect<void> {
        return PubSub.publish(this.pubsub, event).pipe(Effect.asVoid)
    }

    of(filter: SupervisorEventFilter = {}): Stream.Stream<SupervisorEvent> {
        return this.events.pipe(
            Stream.filter((event) => matchesEventFilter(event, filter))
        )
    }

    once(filter: SupervisorEventFilter = {}): Effect.Effect<SupervisorEvent> {
        return this.of(filter).pipe(
            Stream.runHead,
            Effect.flatMap((head) =>
                head._tag === 'Some'
                    ? Effect.succeed(head.value)
                    : Effect.never
            )
        )
    }
}

/** Supervisor lifecycle and health events, as a stream anything can subscribe to. */
export class SupervisorEventBus extends Context.Service<
    SupervisorEventBus,
    SupervisorEventBusShape
>()('supervision/SupervisorEventBus') {
    /** The implementation, resolved once per runtime with its own hub. */
    static readonly live: Effect.Effect<SupervisorEventBusShape> =
        Effect.map(PubSub.unbounded<SupervisorEvent>(), (pubsub) =>
            new SupervisorEventBusImpl(pubsub)
        )

    static readonly Live: Layer.Layer<SupervisorEventBus> = Layer.effect(
        SupervisorEventBus,
        SupervisorEventBus.live
    )
}
