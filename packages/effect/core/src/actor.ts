import { Context } from "effect";

/**
 * Who is acting: a signed-in user, or a named system component.
 *
 * `sessionId` is the Better Auth session the request arrived on, when there is one. It is part of the actor because a
 * decision can be about the CREDENTIAL, not only the person: a step-up (`AUTH-062`) and an impersonation (`AUTH-067`)
 * are bound to the session that proved them, so a passkey tap on one device cannot authorise an action from another.
 * `null` means "no session identity" — an anonymous caller, a mesh peer, a test — and anything that needs a session
 * refuses it instead of guessing.
 */
export type Actor =
	| { readonly kind: "user"; readonly id: string; readonly role: string; readonly sessionId: string | null }
	| { readonly kind: "system"; readonly id: string };

export const Actor = {
	user: (id: string, role: string, sessionId: string | null = null): Actor => ({ kind: "user", id, role, sessionId }),
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
