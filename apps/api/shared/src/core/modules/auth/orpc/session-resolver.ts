import { Context, Data, Effect } from "effect";

import type { Auth } from "../../../../auth";
import type { UserSession } from "./auth-utils";

/** Better Auth could not answer; the caller treats it as "no session" and logs it. */
export class SessionLookupFailed extends Data.TaggedError("SessionLookupFailed")<{
	readonly cause: unknown;
}> {}

export type SessionResolverShape = {
	/** The caller's session from the request headers, or null when there is none. Better Auth does the check. */
	readonly resolve: (headers: Headers) => Effect.Effect<UserSession | null, SessionLookupFailed>;
};

/** Tag and contract: how a request's session is found. Better Auth is the implementation (`makeSessionResolver`). */
export class SessionResolver extends Context.Service<SessionResolver, SessionResolverShape>()("auth/SessionResolver") {}

/**
 * Resolves the session through Better Auth's `getSession`, which verifies the signed cookie and reads the
 * session row. Its answer comes back in one of three shapes (a wrapped `Response`, a bare `Response`, or the
 * session itself), all of which are read here.
 */
export function makeSessionResolver(auth: Auth): SessionResolverShape {
	return {
		resolve: (headers) =>
			Effect.tryPromise({
				try: async (): Promise<UserSession | null> => {
					const raw: unknown = await auth.api.getSession({ headers, asResponse: false });
					if (raw === null || typeof raw !== "object") return null;

					const response =
						raw instanceof Response
							? raw
							: "response" in raw && raw.response instanceof Response
								? raw.response
								: null;
					if (response !== null) {
						return response.ok ? ((await response.json().catch(() => null)) as UserSession | null) : null;
					}
					return "session" in raw && "user" in raw ? (raw as UserSession) : null;
				},
				catch: (cause) => new SessionLookupFailed({ cause }),
			}),
	};
}
