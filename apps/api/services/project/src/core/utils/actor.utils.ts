/** The caller, as resolved by the BFF and forwarded over the service boundary. */
export type Actor = {
	readonly userId: string;
	readonly role: string;
};

/** The oRPC context shape `requireAuth()` guarantees. */
export type AuthenticatedContext = {
	auth: {
		user: {
			id: string;
			role?: string | null;
		};
	};
};

/** Resolve the domain actor from an oRPC context. */
export function actorFromContext(context: AuthenticatedContext): Actor {
	return {
		userId: context.auth.user.id,
		role: context.auth.user.role ?? "user",
	};
}
