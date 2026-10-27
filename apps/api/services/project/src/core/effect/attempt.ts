import { Effect } from "effect";

const toError = (cause: unknown) =>
	cause instanceof Error ? cause : new Error(String(cause));

/** Lifts a NestJS promise into the Effect error channel. */
export function attempt<A>(run: () => Promise<A>): Effect.Effect<A, Error> {
	return Effect.tryPromise({
		try: run,
		catch: toError,
	});
}

/** Lifts a synchronous throw into the Effect error channel. */
export function guard<A>(run: () => A): Effect.Effect<A, Error> {
	return Effect.try({
		try: run,
		catch: toError,
	});
}
