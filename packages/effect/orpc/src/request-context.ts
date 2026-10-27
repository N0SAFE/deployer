import { Actor, Correlation, CurrentActor, type Ambient } from "@deployer/effect-core";
import { Effect } from "effect";

export const CORRELATION_HEADER = "x-correlation-id";

/**
 * The slice of an oRPC request context this package reads. Structural on purpose: the package
 * never imports the app's context augmentation, so any service whose context has these fields
 * can use it.
 */
export type RequestContextInput = {
	readonly request?: { readonly headers: { get(name: string): string | null } };
	readonly auth?: { readonly user?: { readonly id: string; readonly role?: string | null } | null };
	readonly systemActor?: { readonly kind: "system"; readonly source: string } | null;
};

/** The acting identity: a verified system claim wins over a user session; neither means anonymous. */
export function actorFromContext(context: RequestContextInput): Actor | null {
	if (context.systemActor) return Actor.system(context.systemActor.source);
	const user = context.auth?.user;
	return user ? Actor.user(user.id, user.role ?? "user") : null;
}

/** The caller's correlation id, or a fresh one when it sent none. */
export function correlationFromContext(context: RequestContextInput): string {
	const sent = context.request?.headers.get(CORRELATION_HEADER);
	return sent !== null && sent !== undefined && sent !== "" ? sent : crypto.randomUUID();
}

/**
 * Discharge the ambient requirements for one request.
 *
 * `onAnonymous` runs when no actor is present and decides what that means (typically failing
 * `unauthorized`); a public procedure passes an anonymous actor instead.
 */
export const provideRequest =
	<E2>(context: RequestContextInput, onAnonymous: () => Effect.Effect<Actor, E2>) =>
	<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | E2, Exclude<R, Ambient>> =>
		Effect.gen(function* () {
			const actor = actorFromContext(context) ?? (yield* onAnonymous());
			return yield* effect.pipe(
				Effect.provideService(CurrentActor, actor),
				Effect.provideService(Correlation, { id: correlationFromContext(context) }),
			);
		}) as Effect.Effect<A, E | E2, Exclude<R, Ambient>>;
