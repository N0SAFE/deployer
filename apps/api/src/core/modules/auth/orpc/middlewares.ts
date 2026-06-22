import { fromNodeHeaders } from "better-auth/node";
import type { IncomingHttpHeaders } from "http";
import type { Auth } from "@/auth";
import { AuthUtils } from "./auth-utils";
import type {
    ORPCAuthContext, MeshContext, MeshParcourEntry,
    ORPCContextWithAuthOnly, ORPCContextWithAuth,
} from "./types";
import { os, ORPCError } from "@orpc/server";
import { verifyMeshToken, verifyPeerServiceToken } from "@repo/auth/mesh";
import { EnvService } from "@/config/env/env.service";
import type { Env } from "@/config/env/env";

const readEnv = <K extends keyof Env>(key: K): Env[K] => {
    return new EnvService<Env>().get(key);
};

/**
 * Read the mesh shared secret, first from the static registry (populated
 * by whatever module wired the NodeConfigRepository), then from the env
 * var for backward compatibility.
 *
 * This is populated by a one-time call from AppModule (or any module
 * that has access to NodeConfigRepository) at startup.
 *
 * TODO(ph2): replace with proper DI once the middleware pattern supports it.
 */
let _meshSecretProvider: (() => string | null) | null = null;

/**
 * Register a provider that returns the mesh shared secret from the local
 * database. Called once at startup by the module that owns
 * NodeConfigRepository.
 */
export function setMeshSecretProvider(provider: () => string | null): void {
    _meshSecretProvider = provider;
}

function resolveSharedSecret(): string | null {
    // 1. Try the local DB provider (dynamic secret, set at setup time)
    if (_meshSecretProvider) {
        const fromDb = _meshSecretProvider();
        if (fromDb) return fromDb;
    }
    // 2. Fall back to env var (backward compat for pre-migration deployments)
    const fromEnv = readEnv("MESH_STREAM_SHARED_SECRET")?.toString().trim();
    if (fromEnv) return fromEnv;
    return null;
}

/**
 * Converts headers to web standard Headers.
 * Handles both Node.js IncomingHttpHeaders and web standard Headers.
 */
function toWebHeaders(headers: Headers | IncomingHttpHeaders | Record<string, string | string[] | undefined>): Headers {
  // If already a Headers object, return it directly
  if (headers instanceof Headers) {
    return headers;
  }
  // Otherwise, convert from Node.js style headers
  return fromNodeHeaders(headers);
}

/**
 * Creates an auth middleware that populates context.auth with authentication utilities
 * This middleware should be added globally in the ORPC module configuration
 */
export function createAuthMiddleware(auth: Auth) {
    console.log('Creating auth middleware');
    return os.$context<{
        request: Request;
    }>().middleware(async (opts) => {
        // Extract session from request headers
        // ORPC provides headers as web standard Headers, not Node.js IncomingHttpHeaders
        const headers = opts.context.request.headers;
        const webHeaders = toWebHeaders(headers);
        const session = await auth.api.getSession({
            headers: webHeaders,
        });
        
        // Create auth utilities with session AND headers for plugin utilities
        const authUtils = new AuthUtils(session, auth, webHeaders);

        // Pass context with auth to next middleware/handler
        return opts.next({
            context: {
                ...opts.context,
                auth: authUtils,
            },
        });
    })
}

/**
 * Middleware to mark a procedure as public (no authentication required)
 * This is useful when you want to explicitly allow unauthenticated access
 *
 * @example
 * ```ts
 * implement(contract)
 *   .use(publicAccess())
 *   .handler(({ context }) => {
 *     // context.auth.isLoggedIn can be false here
 *   })
 * ```
 */
export function publicAccess() {
    return os
        .$context<ORPCContextWithAuthOnly>()
        .middleware(({ context, next }) => {
            // Simply pass through without any checks
            return next({ context });
        });
}

/**
 * Middleware to require authentication but allow any authenticated user
 *
 * This middleware:
 * 1. Ensures user is logged in (throws UNAUTHORIZED if not)
 * 2. Narrows context type so downstream middlewares/handlers
 *    can access `context.auth.user` without null checks.
 *
 * This middleware is **fully independent** of `requireMesh()`. It does
 * NOT know about the mesh context. For endpoints that need both a
 * verified peer AND a user session, compose the middlewares:
 *
 * ```ts
 * // Order doesn't matter — each only touches its own context key.
 * .use(requireMesh())
 * .use(requireAuth())
 * ```
 *
 * @example
 * ```ts
 * implement(contract)
 *   .use(requireAuth())
 *   .handler(({ context }) => {
 *     const userId = context.auth.user.id; // No null check needed
 *   })
 * ```
 */
export function requireAuth() {
    return os
        .$context<ORPCContextWithAuthOnly>()
        .middleware(({ context, next }) => {
            // This throws UNAUTHORIZED if no session is available.
            // After it succeeds, session and user are guaranteed non-null.
            context.auth.requireAuth();

            return next({
                context: {
                    ...context,
                    auth: makeAuthenticatedAuth(context.auth),
                },
            });
        });
}

/**
 * Build a narrowed `ORPCAuthContext<true>` from a runtime-verified
 * authenticated auth context.
 *
 * After `requireAuth()` succeeds we know `session` and `user` are
 * non-null, but TypeScript can't track this through the conditional
 * mapped types. This factory isolates the unavoidable narrowing cast.
 */
function makeAuthenticatedAuth(auth: ORPCAuthContext): ORPCAuthContext<true> {
    return {
        isLoggedIn: true,
        session: auth.session,
        user: auth.user,
        admin: auth.admin,
        org: auth.org,
        requireAuth: () => auth.requireAuth(),
    } as ORPCAuthContext<true>;
}

// ─── Incoming header constants ──────────────────────────────────────────────

const HDR_MESH_NODE_ID      = "x-mesh-node-id";
const HDR_MESH_PARCOUR      = "x-mesh-parcour";
const HDR_MESH_INTERNAL_KEY = "x-mesh-internal-key";

/**
 * Parse the parcour header — a comma-separated list of nodeIds, oldest
 * first. Each entry MAY carry an optional `@timestamp` suffix.
 *
 * Input:  "node-a@2025-01-01T00:00:00Z,node-b"
 * Output: [{ nodeId: "node-a", timestamp: "2025-01-01T00:00:00Z" },
 *          { nodeId: "node-b" }]
 */
function parseParcour(raw: string | null): MeshParcourEntry[] {
    if (!raw) return [];
    return raw.split(",").map((part) => {
        const trimmed = part.trim();
        if (!trimmed) return null;
        const atIdx = trimmed.indexOf("@");
        if (atIdx > 0) {
            return { nodeId: trimmed.slice(0, atIdx), timestamp: trimmed.slice(atIdx + 1) || undefined };
        }
        return { nodeId: trimmed };
    }).filter((e): e is MeshParcourEntry => e !== null);
}

/**
 * Build the full MeshContext from the incoming headers and verified
 * peer identity.
 */
function buildMeshContext(
    verifiedNodeId: string,
    tokenType: "peer-service" | "mesh-internal",
    webHeaders: Headers,
): MeshContext {
    const callerNodeId = verifiedNodeId;

    const rawParcour = webHeaders.get(HDR_MESH_PARCOUR) ?? webHeaders.get(HDR_MESH_PARCOUR.toUpperCase());
    const incomingParcour: MeshParcourEntry[] = parseParcour(rawParcour);

    const incomingNodeId: string | null =
        webHeaders.get(HDR_MESH_NODE_ID) ?? webHeaders.get(HDR_MESH_NODE_ID.toUpperCase());

    // Build the full parcour: incoming trail (oldest first) → caller.
    const fullParcour: MeshParcourEntry[] = [...incomingParcour];
    const lastIncoming: MeshParcourEntry | undefined = fullParcour[fullParcour.length - 1];
    if (lastIncoming?.nodeId !== callerNodeId) {
        fullParcour.push({ nodeId: callerNodeId });
    }

    // If the incomingNodeId header differs from the last parcour entry,
    // prepend it as an even earlier hop (the caller's outbound record).
    if (incomingNodeId !== null && incomingNodeId !== callerNodeId) {
        const firstExisting: MeshParcourEntry | undefined = fullParcour[0];
        if (firstExisting?.nodeId !== incomingNodeId) {
            fullParcour.unshift({ nodeId: incomingNodeId });
        }
    }

    const originNodeId: string = fullParcour[0]?.nodeId ?? callerNodeId;
    const previousCallerNodeId: string | null = fullParcour.length >= 2
        ? fullParcour[fullParcour.length - 2]?.nodeId ?? null
        : null;

    return {
        verified: true,
        callerNodeId,
        meshParcour: fullParcour,
        originNodeId,
        previousCallerNodeId,
        peerIdentity: { nodeId: callerNodeId, tokenType },
    };
}

// ─── requireMesh — the core peer-identity middleware ─────────────────────────

/**
 * **requireMesh** — validate that the caller is an authenticated mesh peer
 * and populate `context.mesh` with verified routing information.
 *
 * This middleware is **orthogonal** to `requireAuth()`. It NEVER reads or
 * modifies `context.auth`. Endpoints that also need a user session must
 * compose both:
 *
 * ```ts
 * .use(requireMesh())           // context.mesh ← peer identity + parcour
 * .use(requireAuth())           // context.auth ← user session
 * ```
 *
 * Accepted credentials (in order of preference):
 *
 * 1. **Peer service token** (`v2.…`) in `X-Mesh-Internal-Key` — signed
 *    with a node-specific derivative of the mesh shared secret. This is
 *    what an enrolled peer presents on all routine mesh calls.
 *
 * 2. **Generic mesh control token** (`v1.…` per-request HMAC or the
 *    bare shared secret) in `X-Mesh-Internal-Key`. Used for control-plane
 *    operations where the immediate peer identity isn't known.
 *
 * Errors:
 *   - `FORBIDDEN` — no valid mesh credential found.
 *   - `UNAUTHORIZED` — credential present but malformed / expired.
 */
export function requireMesh() {
    return os
        .$context<ORPCContextWithAuth>()
        .middleware(async ({ context, next }) => {
            const request = context.request;
            const webHeaders = toWebHeaders(request.headers);

            const internalKey: string | null =
                webHeaders.get(HDR_MESH_INTERNAL_KEY) ??
                webHeaders.get(HDR_MESH_INTERNAL_KEY.toUpperCase());

            if (!internalKey) {
                throw new ORPCError("FORBIDDEN", {
                    message: "Mesh endpoint requires internal credentials",
                });
            }

            // ── 1. Peer service token (v2.) — preferred ────────────────────
            if (internalKey.startsWith("v2.")) {
                const sharedSecret = resolveSharedSecret();
                if (!sharedSecret) {
                    throw new ORPCError("FORBIDDEN", {
                        message: "Mesh shared secret is not configured",
                    });
                }
                const verified = verifyPeerServiceToken(internalKey, sharedSecret);
                if (!verified) {
                    throw new ORPCError("UNAUTHORIZED", {
                        message: "Invalid or expired peer service token",
                    });
                }
                const meshCtx = buildMeshContext(
                    verified.nodeId,
                    "peer-service",
                    webHeaders,
                );
                return next({
                    context: {
                        ...context,
                        mesh: meshCtx,
                    },
                });
            }

            // ── 2. Generic mesh control token (v1. or bare secret) ──────────
            const sharedSecret = resolveSharedSecret();
            if (!sharedSecret) {
                throw new ORPCError("FORBIDDEN", {
                    message: "Mesh shared secret is not configured",
                });
            }
            const ok = internalKey.startsWith("v1.")
                ? verifyMeshToken(internalKey, sharedSecret)
                : (internalKey.trim() === sharedSecret);
            if (!ok) {
                throw new ORPCError("FORBIDDEN", {
                    message: "Mesh endpoint requires internal credentials",
                });
            }
            const meshCtx = buildMeshContext("mesh-internal", "mesh-internal", webHeaders);
            return next({
                context: {
                    ...context,
                    mesh: meshCtx,
                },
            });
        });
}

/**
 * Middleware to require specific platform role(s)
 *
 * This middleware:
 * 1. Requires authenticated context (must be used after requireAuth())
 * 2. Checks if user has one of the allowed roles
 * 3. Throws FORBIDDEN if user doesn't have required role
 *
 * @param allowedRoles - Array of roles that are allowed to access the endpoint
 *
 * @example
 * ```ts
 * implement(contract)
 *   .use(requireAuth())  // Must be authenticated first
 *   .use(requirePlatformRole(['admin', 'superAdmin']))
 *   .handler(({ context }) => {
 *     // Only admins and superAdmins can access this
 *   })
 * ```
 */
export function requirePlatformRole(allowedRoles: string[]) {
    return os
        .$context<ORPCContextWithAuthOnly<true>>()  // Requires authenticated context
        .middleware(({ context, next }) => {
            const userRole = context.auth.user.role;
            
            if (!userRole || !allowedRoles.includes(userRole)) {
                throw new ORPCError('FORBIDDEN', {
                    message: 'Insufficient permissions. Required role: ' + allowedRoles.join(', '),
                });
            }
            
            return next({ context });
        });
}


