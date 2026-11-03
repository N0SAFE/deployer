import { Effect } from "effect";

import { Actor, Correlation, CurrentActor, type Ambient } from "@deployer/effect-core";

type HeadersLike =
	| { get(name: string): string | null }
	| Readonly<Record<string, string | readonly string[] | undefined>>;

const readHeader = (headers: HeadersLike, name: string): string | undefined => {
	if (typeof (headers as { get?: unknown }).get === "function") {
		return (headers as { get(name: string): string | null }).get(name) ?? undefined;
	}
	const value = (headers as Record<string, string | readonly string[] | undefined>)[name];
	return typeof value === "string" ? value : value?.[0];
};

export const CORRELATION_HEADER = "x-correlation-id";

/**
 * The slice of an oRPC request context this package reads. Structural on purpose: the package
 * never imports the app's context augmentation, so any service whose context has these fields
 * can use it.
 */
export type RequestContextInput = {
	/** Web `Headers` (fetch hosts) or a plain Node header record (Nest's HTTP adapter). */
	readonly request?: { readonly headers: HeadersLike };
	readonly auth?: {
		readonly user?: { readonly id: string; readonly role?: string | null } | null;
		/** The verified session the request arrived on; its id is what a step-up is bound to. */
		readonly session?: { readonly id: string } | null;
	};
	readonly systemActor?: { readonly kind: "system"; readonly source: string } | null;
};

/** The acting identity: a verified system claim wins over a user session; neither means anonymous. */
export function actorFromContext(context: RequestContextInput): Actor | null {
	if (context.systemActor) return Actor.system(context.systemActor.source);
	const user = context.auth?.user;
	return user ? Actor.user(user.id, user.role ?? "user", context.auth.session?.id ?? null) : null;
}

/** The caller's correlation id, or a fresh one when it sent none. */
export function correlationFromContext(context: RequestContextInput): string {
	const sent = context.request ? readHeader(context.request.headers, CORRELATION_HEADER) : undefined;
	return sent !== undefined && sent !== "" ? sent : crypto.randomUUID();
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
