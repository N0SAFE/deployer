import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { setupContract } from "@repo/api-contracts";
import { publicAccess } from "@/core/modules/auth/orpc/middlewares";
import { Pool } from "pg";
import type { SetupProbeDbResult, SetupProbeMeshResult } from "@repo/contracts-entities";
import type { InitializationService } from "@/core/modules/setup/services/initialization.service";

@Controller()
export class SetupController {
    constructor(private readonly initializationService: InitializationService) {}

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
            .handler(async ({ input }): Promise<SetupProbeDbResult> => {
                const start = Date.now();
                const pool = new Pool({ connectionString: input.databaseUrl.trim(), max: 1 });
                try {
                    await pool.query("SELECT 1");
                    return { reachable: true, latencyMs: Date.now() - start };
                } catch (err: unknown) {
                    return {
                        reachable: false,
                        error: err instanceof Error ? err.message : String(err),
                    };
                } finally {
                    await pool.end().catch(() => undefined);
                }
            });
    }

    /**
     * Test a mesh URL — instant feedback, no side effects.
     * Used by the remote flow Step 2 URL input (debounced on the client).
     */
    @Implement(setupContract.probeMesh)
    probeMesh() {
        return implement(setupContract.probeMesh)
            .use(publicAccess())
            .handler(async ({ input }): Promise<SetupProbeMeshResult> => {
                let parsed: URL;
                try {
                    parsed = new URL(input.meshUrl.trim());
                } catch {
                    return { reachable: false, error: "Invalid URL format" };
                }

                const start = Date.now();
                const abort = new AbortController();
                const timeout = setTimeout(() => {abort.abort()}, 5_000);

                try {
                    const res = await fetch(`${parsed.origin}/mesh/node/local`, {
                        method: "GET",
                        signal: abort.signal,
                    });

                    if (!res.ok) {
                        return {
                            reachable: false,
                            error: `HTTP ${String(res.status)}`,
                            latencyMs: Date.now() - start,
                        };
                    }

                    const json = await res.json().catch(() => ({})) as Record<string, unknown>;
                    return {
                        reachable: true,
                        latencyMs: Date.now() - start,
                        nodeId:  typeof json["nodeId"]  === "string" ? json["nodeId"]  : undefined,
                        version: typeof json["version"] === "string" ? json["version"] : undefined,
                    };
                } catch (err: unknown) {
                    return {
                        reachable: false,
                        error: err instanceof Error ? err.message : String(err),
                        latencyMs: Date.now() - start,
                    };
                } finally {
                    clearTimeout(timeout);
                }
            });
    }

    // ─── Remote auth ──────────────────────────────────────────────────────────

    /**
     * Authenticate against a remote mesh node (mocked).
     * Returns an authToken forwarded as-is to `initialize`.
     */
    @Implement(setupContract.remoteAuth)
    remoteAuth() {
        return implement(setupContract.remoteAuth)
            .use(publicAccess())
            .handler(async ({ input }) => {
                // MOCK — replace with: POST ${input.meshUrl}/auth/session
                await new Promise((r) => setTimeout(r, 600));
                const mockToken = `mock-grant-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                return {
                    authToken: mockToken,
                    userId:    `mock-user-${input.username}`,
                    email:     `${input.username}@mock.mesh`,
                    meshUrl:   input.meshUrl.trim(),
                };
            });
    }

    // ─── Initialize — SSE stream ──────────────────────────────────────────────

    /**
     * Submit the wizard.
     * Returns an AsyncGenerator of SetupStreamEvent — oRPC streams this as SSE.
     *
     * Event sequence (local):
     *   step_start(provision_database) → step_log* → step_complete
     *   step_start(run_migrations)     → step_log* → step_complete
     *   step_start(seed_initial_data)  → step_log* → step_complete
     *   step_start(register_node)      → step_log* → step_complete
     *   completed({ nodeId, strategy, databaseUrl, completedAt })
     *
     * Event sequence (remote):
     *   step_start(mesh_handshake)  → step_log* → step_complete
     *   step_start(register_node)   → step_log* → step_complete
     *   completed({ nodeId, strategy, databaseUrl, completedAt })
     *
     * On any fatal error:
     *   step_failed(stepId, error, durationMs)
     *   error({ message })           ← stream closes after this
     */
    @Implement(setupContract.initialize)
    initialize() {
        return implement(setupContract.initialize)
            .handler(({ input }) => this.initializationService.initialize(input));
    }
}