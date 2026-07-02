import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { ORPCError } from "@orpc/server";
import { setupContract } from "@repo/api-contracts";
import { publicAccess } from "@/core/modules/auth/orpc/middlewares";
import { Pool } from "pg";
import { InitializationService } from "@/core/modules/setup/services/initialization.service";
import { ReachabilityService } from "@/core/modules/reachability/services/reachability.service";

@Controller()
export class SetupController {
    constructor(
        private readonly initializationService: InitializationService,
        private readonly reachabilityService: ReachabilityService,
    ) {}

    // ─── State ────────────────────────────────────────────────────────────────

    @Implement(setupContract.getState)
    getState() {
        return implement(setupContract.getState)
            .use(publicAccess())
            .handler(() => this.initializationService.getSetupState());
    }

    @Implement(setupContract.getNodeStatus)
    getNodeStatus() {
        return implement(setupContract.getNodeStatus)
            .use(publicAccess())
            .handler(() => this.initializationService.getNodeStatus());
    }

    // ─── Pre-flight probes ────────────────────────────────────────────────────

    /**
     * Test a PostgreSQL URL — instant feedback, no side effects.
     * Used by the "use existing database" toggle in local Step 2.
     */
    @Implement(setupContract.probeDatabase)
    probeDatabase() {
        return implement(setupContract.probeDatabase)
            .use(publicAccess())
            .handler(async ({ input }) => {
                const start = Date.now();
                const pool = new Pool({
                    connectionString: input.databaseUrl.trim(),
                    max: 1,
                    connectionTimeoutMillis: 5_000,
                });
                try {
                    await pool.query("SELECT 1");
                    return {
                        status: 201,
                        headers: {},
                        body: { reachable: true, latencyMs: Date.now() - start },
                    };
                } catch (err: unknown) {
                    return {
                        status: 201,
                        headers: {},
                        body: {
                            reachable: false,
                            error: err instanceof Error ? err.message : String(err),
                        },
                    };
                } finally {
                    await pool.end().catch(() => undefined);
                }
            });
    }

    /**
     * Test a mesh URL — instant feedback, no side effects.
     *
     * Delegates to {@link ReachabilityService.checkMeshUrlReachability},
     * which is the single source of truth for mesh reachability probing.
     * That service hits the peer's public, unauthenticated
     * `GET /mesh/ping` endpoint — see the controller in
     * `system/modules/mesh` and `meshPingContract` for the route.
     *
     * `getLocalNode` is intentionally NOT used here: it sits behind
     * `requireMeshPeer()` (session + mesh internal key) and would
     * always 401 for a pre-auth bootstrap probe.
     */
    @Implement(setupContract.probeMesh)
    probeMesh() {
        return implement(setupContract.probeMesh)
            .use(publicAccess())
            .handler(async ({ input }) => {
                const result = await this.reachabilityService.checkMeshUrlReachability(
                    input.meshUrl,
                );
                return {
                    status: 201,
                    headers: {},
                    body: {
                        reachable: result.reachable,
                        latencyMs: result.latencyMs,
                        advertisedHost: result.advertisedHost,
                        version: result.version,
                        error: result.reachable ? undefined : result.error,
                    },
                };
            });
    }

    // ─── Remote auth ──────────────────────────────────────────────────────────

    /**
     * Authenticate against a remote mesh node via its Better Auth signin
     * endpoint. The returned `authToken` is forwarded as the join grant
     * to `initialize` → `consumeJoinGrant`.
     *
     * Used by the setup wizard's "Authenticate" step. Validation happens
     * in real time on the form, so the wizard only ever advances with a
     * token the mesh actually accepted.
     *
     * Endpoint shape: `POST {meshOrigin}/api/auth/sign-in/email` with body
     * `{ email, password }`. Better Auth returns either 200 with a session
     * token (or set-cookie) or 401 with an error.
     */
    @Implement(setupContract.remoteAuth)
    remoteAuth() {
        return implement(setupContract.remoteAuth)
            .use(publicAccess())
            .handler(async ({ input }) => {
                let meshOrigin: string;
                try {
                    meshOrigin = new URL(input.meshUrl).origin;
                } catch {
                    throw new ORPCError("BAD_REQUEST", {
                        message: "Invalid mesh URL",
                    });
                }

                const signinUrl = `${meshOrigin}/api/auth/sign-in/email`;

                const abort = new AbortController();
                const timeout = setTimeout(() => {
                    abort.abort();
                }, 10_000);
                const startedAt = Date.now();

                try {
                    const response = await fetch(signinUrl, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Accept": "application/json",
                        },
                        body: JSON.stringify({
                            email: input.username,
                            password: input.password,
                        }),
                        signal: abort.signal,
                    });

                    if (!response.ok) {
                        const errorBody = (await response
                            .json()
                            .catch(() => null)) as
                            | { message?: unknown; error?: unknown }
                            | null;
                        const rawMessage =
                            typeof errorBody?.message === "string"
                                ? errorBody.message
                                : typeof errorBody?.error === "string"
                                  ? errorBody.error
                                  : null;

                        if (response.status === 401 || response.status === 400) {
                            throw new ORPCError("UNAUTHORIZED", {
                                message: rawMessage ?? "Invalid email or password",
                            });
                        }

                        throw new ORPCError("BAD_GATEWAY" as never, {
                            message:
                                rawMessage ??
                                `Mesh returned ${response.status.toString()} during signin`,
                        });
                    }

                    const result = (await response.json()) as {
                        token?: unknown;
                        user?: { id?: unknown; email?: unknown };
                    };

                    const setCookie = response.headers.get("set-cookie") ?? "";
                    const tokenFromBody =
                        typeof result.token === "string" && result.token.length > 0
                            ? result.token
                            : null;

                    // Better Auth returns a SESSION COOKIE, not just a raw token.
                    // The `result.token` body field contains only the raw token,
                    // but Better Auth's `getSession()` expects the FULL signed
                    // cookie value in the format `<token>.<signature>`.  Without
                    // the signature part the session validation always fails.
                    // Always prefer the full `Set-Cookie` value when available.
                    const authToken = extractSessionCookie(setCookie) ?? tokenFromBody;

                    if (!authToken) {
                        throw new ORPCError("INTERNAL_SERVER_ERROR" as never, {
                            message:
                                "Mesh did not return a session token — cannot proceed",
                        });
                    }

                    return {
                        status: 201,
                        headers: {},
                        body: {
                            authToken,
                            userId:
                                typeof result.user?.id === "string"
                                    ? result.user.id
                                    : `user-${input.username}`,
                            email:
                                typeof result.user?.email === "string"
                                    ? result.user.email
                                    : input.username,
                            meshUrl: input.meshUrl.trim(),
                            latencyMs: Date.now() - startedAt,
                        },
                    };
                } catch (err) {
                    if (err instanceof ORPCError) throw err;
                    if (err instanceof Error && err.name === "AbortError") {
                        throw new ORPCError("GATEWAY_TIMEOUT" as never, {
                            message:
                                "Authentication timed out — mesh node did not respond",
                        });
                    }
                    throw new ORPCError("INTERNAL_SERVER_ERROR" as never, {
                        message:
                            err instanceof Error
                                ? err.message
                                : "Unknown error contacting mesh",
                    });
                } finally {
                    clearTimeout(timeout);
                }
            });
    }

    // ─── Trigger initialization (returns immediately) ─────────────────────────

    /**
     * Start the initialization process in the background.
     * Returns immediately. Live progress can be consumed via `getInitializeStream`.
     */
    @Implement(setupContract.triggerInitialize)
    triggerInitialize() {
        return implement(setupContract.triggerInitialize)
            .use(publicAccess())
            .handler(({ input }) => {
                const result = this.initializationService.triggerInitialize(input);
                return { status: 201 as const, headers: {}, body: result };
            });
    }

    // ─── Stream initialization events (SSE) ──────────────────────────────────

    /**
     * Subscribe to the initialization event stream.
     * Returns an Observable of SetupStreamEvent (SSE).
     * Replays past events for late subscribers (page reload / reconnection).
     */
    @Implement(setupContract.getInitializeStream)
    getInitializeStream() {
        return implement(setupContract.getInitializeStream)
            .use(publicAccess())
            .handler(() => this.initializationService.getInitializeStream());
    }
}

/**
 * Best-effort extraction of a session token from a `Set-Cookie` header
 * returned by Better Auth. Better Auth typically sets one of:
 *   - `better-auth.session_token=<token>; ...`
 *   - `__Secure-better-auth.session_token=<token>; ...`
 *
 * Returns the raw `name=value` pair so the caller can forward it as
 * `Cookie` on subsequent requests if needed. Returns `null` if no
 * session cookie is present.
 */
function extractSessionCookie(setCookieHeader: string): string | null {
    if (!setCookieHeader) return null;

    const cookies = setCookieHeader
        .split(/,(?=[^ ]+=)/g)
        .map((c) => c.trim())
        .filter(Boolean);

    for (const raw of cookies) {
        const [pair] = raw.split(";");
        if (!pair) continue;
        const eq = pair.indexOf("=");
        if (eq <= 0) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (name.toLowerCase().includes("session_token") && value.length > 0) {
            return `${name}=${value}`;
        }
    }

    return null;
}