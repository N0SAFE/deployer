import type { Auth } from "@/auth";
import type { AdminPluginWrapper } from "../plugin-utils/plugin-wrapper-factory";
import type { SessionUserWithRole } from "../utils/auth-utils";

import { AppError } from "@repo/errors";
/**
 * Brand symbol for authenticated context
 */
declare const AuthenticatedBrand: unique symbol;

// ─── Mesh Context ───────────────────────────────────────────────────────────

/**
 * A single hop recorded in the mesh parcour — traces the path a request
 * has travelled across mesh nodes so every downstream node knows the
 * full chain.
 */
export interface MeshParcourEntry {
    /** Node ID that handled this hop */
    nodeId: string;
    /** ISO timestamp when this hop occurred (optional) */
    timestamp?: string;
}

/**
 * Mesh-specific context populated by {@link requireMesh} middleware.
 *
 * Carries the verified calling node's identity plus the full routing
 * trail (parcour) so handlers have full topological awareness without
 * querying the cluster repository.
 */
export interface MeshContext {
    /** Whether the caller's mesh credentials were successfully verified. */
    readonly verified: boolean;

    /** Node ID of the immediate caller (the peer that sent this request). */
    readonly callerNodeId: string;

    /**
     * Full ordered path this request has traversed through the mesh,
     * from the **origin** node (index 0) to the **immediate caller**
     * (last entry).
     *
     * Examples:
     * - `[{ nodeId: "node-a" }]`                    — direct 1-hop call
     * - `[{ nodeId: "node-a" }, { nodeId: "node-b" }]` — forwarded once
     */
    readonly meshParcour: MeshParcourEntry[];

    /** The originating node — shorthand for `meshParcour[0]?.nodeId ?? callerNodeId`. */
    readonly originNodeId: string;

    /**
     * The node that forwarded to the immediate caller, or `null` when
     * the caller is the origin (direct call).
     */
    readonly previousCallerNodeId: string | null;

    /** Which credential type was used to verify this request. */
    readonly peerIdentity: {
        readonly nodeId: string;
        readonly tokenType: "peer-service" | "mesh-internal";
    };
}

/**
 * ORPC context that carries mesh routing info.
 * Use as the input/output type for middlewares that only deal with mesh.
 */
export interface ORPCContextWithMesh {
    mesh: MeshContext;
    [key: string]: unknown;
    [key: symbol]: unknown;
}

/**
 * ORPC context with BOTH mesh AND auth — for endpoints that need
 * both verified peer identity AND a user session (either direct or
 * forwarded through the mesh).
 *
 * This is an intersection type (not interface extends) so it works
 * correctly with both ORPC's MergedInitialContext and standalone use.
 */
export type ORPCContextWithAuthAndMesh<TLoggedIn extends boolean = boolean> =
    ORPCContextWithAuth<TLoggedIn> & ORPCContextWithMesh;

/**
 * Minimal ORPC context requiring only auth utilities.
 * Use this for middlewares that only need auth context (most access control).
 */
export interface ORPCContextWithAuthOnly<TLoggedIn extends boolean = boolean> {
    auth: ORPCAuthContext<TLoggedIn>;
    [key: string]: unknown;
    [key: symbol]: unknown;
}

/**
 * Full ORPC context with request and auth utilities.
 * Use this for middlewares that need access to the raw request.
 */
export interface ORPCContextWithAuth<TLoggedIn extends boolean = boolean> extends ORPCContextWithAuthOnly<TLoggedIn> {
    request: Request;
    [key: string]: unknown;
    [key: symbol]: unknown;
}

/**
 * Auth context available in ORPC handlers
 * 
 * For access control, use plugin-based middlewares:
 * - `adminMiddlewares.requireRole(roles)` - Require specific admin role(s)
 * - `adminMiddlewares.requirePermission(permission)` - Require specific permission
 * 
 * @template TLoggedIn - Whether user is logged in (boolean by default, true for authenticated contexts)
 */
export interface ORPCAuthContext<TLoggedIn extends boolean = boolean> {
  /** Whether user is authenticated */
  readonly isLoggedIn: TLoggedIn;

  /** User session (null if not authenticated) */
  readonly session: TLoggedIn extends true 
    ? Auth["$Infer"]["Session"]["session"] 
    : TLoggedIn extends false 
      ? null 
      : Auth["$Infer"]["Session"]["session"] | null;

  /** User object (null if not authenticated) */
  readonly user: TLoggedIn extends true 
    ? SessionUserWithRole 
    : TLoggedIn extends false 
      ? null 
      : SessionUserWithRole | null;

  /**
   * Admin plugin utilities with auto-injected headers
   * Provides platform-level user management operations
   */
  readonly admin: AdminPluginWrapper;

  /**
   * Require authentication - throws if user is not logged in
   * 
   * Use this for programmatic auth checks in handlers when you need to
   * ensure authentication after some business logic.
   * 
   * @throws ORPCError with UNAUTHORIZED code if not authenticated
   * @returns Object with non-null session and user
   */
  requireAuth(): { 
    session: NonNullable<ORPCAuthContext<true>['session']>; 
    user: NonNullable<ORPCAuthContext<true>['user']>;
  };
  
  /** Internal brand for type narrowing (not accessible at runtime) */
  [AuthenticatedBrand]?: TLoggedIn extends true ? true : boolean;
}

/**
 * Authenticated auth context type (guaranteed non-null user and session)
 * This is the type after requireAuth() middleware has been applied
 */
export interface ORPCAuthenticatedContext extends ORPCAuthContext<true> {
  /** Internal brand for type narrowing */
  [AuthenticatedBrand]: true;
}

/**
 * Type assertion helper for authenticated context.
 *
 * Call this after you have verified `auth.isLoggedIn` at runtime to
 * narrow the type to `ORPCAuthenticatedContext` (which guarantees
 * non-null `session` and `user`).
 *
 * This is a **trusted narrowing** — the `as` cast is unavoidable here
 * because TypeScript can't track the conditional mapped types through
 * runtime checks. We encapsulate it in a single exported function
 * rather than scattering `as ORPCAuthenticatedContext` at every call
 * site.
 *
 * @example
 * ```ts
 * .handler(({ context }) => {
 *   const auth = assertAuthenticated(context.auth);
 *   const userId = auth.user.id; // No null check needed
 * })
 * ```
 */
export function assertAuthenticated(auth: ORPCAuthContext): ORPCAuthenticatedContext {
  if (!auth.isLoggedIn || !auth.session || !auth.user) {
    throw new AppError('Auth context is not authenticated', 'INTERNAL_ERROR');
  }
  return auth as ORPCAuthenticatedContext;
}

/**
 * Brand symbol for the auth middleware chain.
 * `requireAuth()` checks for this symbol to verify that `authMiddleware`
 * was called before it in the middleware chain.
 */
export declare const AUTH_MIDDLEWARE_BRAND: unique symbol;

/**
 * Runtime value of the auth middleware brand.
 * Set by authMiddleware, checked by requireAuth.
 */
export const AUTH_MIDDLEWARE_BRAND_VALUE = Symbol('orpc.auth-middleware');

/**
 * Context with the auth middleware brand applied.
 * Used as the output type of authMiddleware and the input type of requireAuth().
 */
export interface ORPCContextWithAuthBrand extends ORPCContextWithAuthOnly {
  readonly [AUTH_MIDDLEWARE_BRAND]: typeof AUTH_MIDDLEWARE_BRAND;
}


