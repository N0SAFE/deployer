import type { Session } from "./auth";

/**
 * Auth is a discriminated union, not a nullable bag: checking `isLoggedIn`
 * narrows `session`/`user` to non-null, so handlers never cast.
 */
export type AnonymousAuth = {
  readonly isLoggedIn: false;
  readonly session: null;
  readonly user: null;
};

export type AuthenticatedAuth = {
  readonly isLoggedIn: true;
  readonly session: Session["session"];
  readonly user: Session["user"];
};

export type AuthContext = AnonymousAuth | AuthenticatedAuth;

export function toAuthContext(session: Session | null): AuthContext {
  return session
    ? { isLoggedIn: true, session: session.session, user: session.user }
    : { isLoggedIn: false, session: null, user: null };
}

/**
 * The session middleware attaches the Better Auth result to the Node request,
 * the same convention the existing API/app-services use (`request.session`,
 * `request.user` for observability tools).
 */
declare global {
  namespace Express {
    interface Request {
      session: Session | null;
      user?: Session["user"];
    }
  }
}
