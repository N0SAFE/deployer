import { Context } from "effect";

/** Who is acting: a signed-in user, or a named system component. */
export type Actor =
	| { readonly kind: "user"; readonly id: string; readonly role: string }
	| { readonly kind: "system"; readonly id: string };

export const Actor = {
	user: (id: string, role: string): Actor => ({ kind: "user", id, role }),
	system: (id: string): Actor => ({ kind: "system", id }),
} as const;

/**
 * The acting identity. It has no default: a method that reads it carries `CurrentActor` in `R`, and
 * only a request boundary, a worker or a test can provide it.
 */
export class CurrentActor extends Context.Service<CurrentActor, Actor>()("effect-core/CurrentActor") {}

/** Correlation id threaded through logs and service-to-service calls. */
export class Correlation extends Context.Service<Correlation, { readonly id: string }>()(
	"effect-core/Correlation",
) {}

/** What a service method may leave open in `R`; everything else is resolved at layer build. */
export type Ambient = CurrentActor | Correlation;
