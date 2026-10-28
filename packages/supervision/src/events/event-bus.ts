import { Context, Effect, Layer, PubSub, Stream } from "effect";

import { matchesEventFilter, type SupervisorEvent, type SupervisorEventFilter } from "./supervisor-event";

export type SupervisorEventBusShape = {
	/** Publishes an event to everyone listening now. */
	readonly emit: (event: SupervisorEvent) => Effect.Effect<void>;
	/** Every event, from the moment the stream is run. */
	readonly events: Stream.Stream<SupervisorEvent>;
	/** The events matching `filter`. */
	readonly of: (filter?: SupervisorEventFilter) => Stream.Stream<SupervisorEvent>;
	/** Waits for the next event matching `filter`. */
	readonly once: (filter?: SupervisorEventFilter) => Effect.Effect<SupervisorEvent>;
};

/** Supervisor lifecycle and health events, as a stream anything can subscribe to. */
export class SupervisorEventBus extends Context.Service<SupervisorEventBus, SupervisorEventBusShape>()(
	"supervision/SupervisorEventBus",
) {
	static readonly Live: Layer.Layer<SupervisorEventBus> = Layer.effect(SupervisorEventBus, makeSupervisorEventBus());
}

export function makeSupervisorEventBus(): Effect.Effect<SupervisorEventBusShape> {
	return Effect.gen(function* () {
		const pubsub = yield* PubSub.unbounded<SupervisorEvent>();
		const events = Stream.fromPubSub(pubsub);
		const of = (filter: SupervisorEventFilter = {}) => events.pipe(Stream.filter((event) => matchesEventFilter(event, filter)));
		return {
			emit: (event) => PubSub.publish(pubsub, event).pipe(Effect.asVoid),
			events,
			of,
			once: (filter = {}) =>
				of(filter).pipe(
					Stream.runHead,
					Effect.flatMap((head) => (head._tag === "Some" ? Effect.succeed(head.value) : Effect.never)),
				),
		};
	});
}
