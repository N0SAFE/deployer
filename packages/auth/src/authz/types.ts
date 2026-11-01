import type { Permission, ScopeKind } from "./catalog";

/** A place a permission is checked in: the platform, or one project and everything under it. */
export type Scope = { readonly kind: ScopeKind; readonly id?: string };

export const PLATFORM_SCOPE: Scope = { kind: "platform" };

/**
 * What a procedure declares about itself.
 *
 * `public` is the only way to opt out of the gate, and it carries a reason so a reviewer sees *why* a route is open.
 * Everything else names the permission and the scope the check runs in; `by` says how to read the scope id from the
 * input, so the declaration stays next to the schema instead of being repeated in the handler.
 */
export type AccessDeclaration =
	| { readonly public: true; readonly reason: string }
	| {
			readonly public?: false;
			readonly permission: Permission;
			readonly scope?: Scope | { readonly by: "input" | "context"; readonly path: string };
	  };

export type AccessRequirement = {
	readonly permission: Permission;
	readonly scope: Scope;
};

/** The caller, as the gate sees it: the authenticated user and their platform role. */
export type Actor = {
	readonly id: string;
	readonly role: string;
};

/** Facts a condition may read. Kept small on purpose: everything here is already loaded for the decision. */
export type Facts = {
	readonly actorId: string;
	readonly ownerId?: string | null;
	readonly environmentKind?: "production" | "staging" | "preview" | "dev" | null;
	readonly now: number;
};

export type Condition =
	/** Only the owner of the resource. */
	| { readonly ownerOnly: true }
	/** Anywhere except these environment kinds (e.g. no deploys to production). */
	| { readonly notEnvironment?: readonly ("production" | "staging" | "preview" | "dev")[] };

export type Decision = {
	readonly allowed: boolean;
	/** Why, in one sentence, for the log and the "why?" drawer. Never shown verbatim to an unauthenticated caller. */
	readonly reason: string;
	readonly permission: Permission;
	readonly scope: Scope;
};

/** A refusal the gate raises; mapped to `FORBIDDEN` at the transport. */
export class AuthzDenied extends Error {
	readonly _tag = "AuthzDenied";
	constructor(
		readonly permission: Permission,
		readonly scope: Scope,
		readonly reason: string,
	) {
		super(`missing ${permission} on ${scope.kind}${scope.id === undefined ? "" : `:${scope.id}`} (${reason})`);
		this.name = "AuthzDenied";
	}
}

/** The capabilities resolved for one actor in one scope, plus what the resolver considered. */
export type CapabilitySet = {
	readonly permissions: readonly Permission[];
	/** For the explain output: which grants/roles contributed. */
	readonly sources: readonly string[];
};
