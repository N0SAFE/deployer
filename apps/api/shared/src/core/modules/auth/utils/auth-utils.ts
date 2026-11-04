import { standardErrorActions } from "@deployer/orpc-utils";

import type { Auth } from "../../../../auth";

export type SessionUserWithRole = Auth["$Infer"]["Session"]["user"] & {
  /**
   * The platform role, from the `user.role` column.
   *
   * A `string`, not a `PlatformRole`: roles are ROWS now, so a value read from the database cannot be the union the
   * declaration was compiled from. It is checked where it is used (`roleHasPermission` answers `false` for a name the
   * catalogue does not list), not asserted here.
   */
  role?: string;
  // Better Auth's user columns, nullable at runtime.
  banned?: boolean | null;
  banReason?: string | null;
  banExpires?: Date | string | null;
  [key: string]: unknown;
};

/** A resolved session, as every handler boundary receives it. */
export type UserSession = {
  session: Auth["$Infer"]["Session"]["session"];
  user: SessionUserWithRole;
};

/**
 * The auth face an oRPC handler sees.
 *
 * Deliberately small: the session, the user, and `requireAuth()`. Authorization is NOT here — it runs at the transport
 * (`authzGate`) or through `Authz`, so there is no second place to check a permission and no Better Auth plugin surface
 * to call. That surface (`auth.api.*`, the admin plugin wrappers, the Nest guard converters) was how a handler could
 * authorize itself differently from every other route.
 */
export class AuthUtils {
  constructor(private readonly _session: UserSession | null) {}

  get isLoggedIn(): boolean {
    return this._session !== null;
  }

  get session(): UserSession["session"] | null {
    return this._session?.session ?? null;
  }

  get user(): SessionUserWithRole | null {
    return this._session?.user ?? null;
  }

  /**
   * The authenticated session, or a refusal.
   *
   * `UNAUTHORIZED` is declared on every contract (`standardDomainErrorContracts`), so oRPC keeps it a typed error on the
   * client rather than a 500.
   */
  requireAuth(): UserSession {
    if (this._session === null) {
      throw standardErrorActions.UNAUTHORIZED("Authentication required");
    }
    return this._session;
  }
}

/** The same face for a caller with no session: every read is `null`/`false`, and `requireAuth()` refuses. */
export class AuthUtilsEmpty {
  readonly isLoggedIn = false;
  readonly session = null;
  readonly user = null;

  requireAuth(): never {
    throw standardErrorActions.UNAUTHORIZED("Authentication required");
  }
}
