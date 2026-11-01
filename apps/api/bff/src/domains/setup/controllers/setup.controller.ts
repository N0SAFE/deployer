import { runPromiseUnwrapped } from "@deployer/effect-core";
import { Controller, Logger, Inject } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { ORPCError } from "@orpc/server";
import { setupContract } from "@deployer/bff-contracts";
import { domainErrorOptions, standardErrorOptions } from "@deployer/orpc-utils";
import { publicAccess } from "@/core/modules/auth/orpc/middlewares";
import { AllowAnonymous } from "@/core/modules/auth/decorators/decorators";
import { Pool } from "pg";
import { InitializationService } from "@/core/modules/setup/services/initialization.service";
import { ReachabilityService } from "@/core/modules/reachability/services/reachability.service";
import { EgressRequestError, EgressService } from "@/core/modules/egress/egress.service";
import { PostSetupDestinationService } from "../services/post-setup-destination.service";
import { PostSetupVerificationService } from "../services/post-setup-verification.service";
import { NodeConfigRepository, type NodeConfigRepositoryShape } from "@deployer/node-state"
import { liveSnapshot } from "@deployer/shared/core/utils/live-snapshot.utils";

/**
 * Re-evaluation cadence for `getPostSetupVerificationStream` — the interval the
 * wizard used to poll at while the ingress is being replaced.
 */
const POST_SETUP_VERIFICATION_STREAM_INTERVAL_MS = 2_000;

/**
 * Setup wizard surface — intentionally PRE-AUTH by design (the wizard runs
 * before any account exists).
 *
 * CRITICAL: the global APP_GUARD AuthGuard (AuthModule) runs at the Nest layer
 * BEFORE ORPC middleware, so the ORPC-level `.use(publicAccess())` alone does
 * NOT bypass it — every request would 401. The Nest-level @AllowAnonymous()
 * metadata is what the guard actually reads (SetMetadata "PUBLIC"). Both are
 * applied: @AllowAnonymous() for the guard, publicAccess() for ORPC handlers
 * that read context.auth without requiring a session.
 */
@AllowAnonymous()
@Controller()
export class SetupController {
    private readonly logger = new Logger(SetupController.name);
    constructor(
        private readonly initializationService: InitializationService,
        private readonly reachabilityService: ReachabilityService,
        @Inject(NodeConfigRepository) private readonly nodeConfigRepository: NodeConfigRepositoryShape,
        private readonly postSetupDestination: PostSetupDestinationService,
        private readonly postSetupVerification: PostSetupVerificationService,
        private readonly egress: EgressService,
    ) {}

    // ─── State ────────────────────────────────────────────────────────────────

    @Implement(setupContract.getState)
    getState() {
        return implement(setupContract.getState)
            .use(publicAccess())
            .handler(async () => this.initializationService.getSetupState());
    }

    @Implement(setupContract.getNodeStatus)
    getNodeStatus() {
        return implement(setupContract.getNodeStatus)
            .use(publicAccess())
            .handler(async () => this.initializationService.getNodeStatus());
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
                await this.initializationService.assertSetupMutable();
                await this.initializationService.assertDatabaseProbeAllowed(input.databaseUrl.trim());
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
     * Start the initialization process in the background.
     * Returns immediately. Live progress can be consumed via `getInitializeStream`.
     */
    @Implement(setupContract.triggerInitialize)
    triggerInitialize() {
        return implement(setupContract.triggerInitialize)
            .use(publicAccess())
            .handler(async ({ input }) => {
                await this.initializationService.assertSetupMutable();
                // Credentials are stored inside initializationService.triggerInitialize()
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

    // ─── Post-setup hints (ORPC) ────────────────────────────────────────────

    /**
     * List pending post-setup hint IDs.
     * Called by PostSetupHints component on mount.
     */
    @Implement(setupContract.listPostSetupHints)
    listPostSetupHints() {
        return implement(setupContract.listPostSetupHints)
            .use(publicAccess())
            .handler(() => ({
                hintIds: ["scanning" as const, "notifications" as const],
            }));
    }

    /**
     * Dismiss a post-setup hint. Persisted so the hint never appears again.
     */
    @Implement(setupContract.dismissPostSetupHint)
    setupDismissPostSetupHint() {
        return implement(setupContract.dismissPostSetupHint)
            .use(publicAccess())
            .handler(async ({ input, errors }) => {
                await this.initializationService.assertSetupMutable();
                this.logger.log(`Hint dismissed: ${input.hintId}`);
                const config = await runPromiseUnwrapped(this.nodeConfigRepository.find());
                if (!config) {
                    throw errors.INTERNAL_SERVER_ERROR(
                        domainErrorOptions(
                            "INTERNAL_SERVER_ERROR",
                            500,
                            "Cannot dismiss hint — node config not found",
                        ),
                    );
                }
                const flags = config.postSetupFlags ?? {};
                await runPromiseUnwrapped(this.nodeConfigRepository.upsert({
                    nodeId: config.nodeId,
                    strategy: config.strategy,
                    setupState: config.setupState,
                    deployerVersion: config.deployerVersion,
                    databaseUrl: config.databaseUrl,
                    databaseProvisioning: config.databaseProvisioning ?? null,
                    configuredAt: config.configuredAt,
                    meshUrlsSnapshot: config.meshUrlsSnapshot ?? [],
                    meshSharedSecret: config.meshSharedSecret,
                    meshSharedSecretUpdatedAt: config.meshSharedSecretUpdatedAt,
                    peerServiceToken: config.peerServiceToken,
                    peerServiceTokenExpiresAt: config.peerServiceTokenExpiresAt,
                    upgradedAtVersion: config.upgradedAtVersion,
                    postSetupFlags: { ...flags, [input.hintId]: "dismissed" },
                    updatedAt: new Date().toISOString(),
                }));
                return { status: 201 as const, headers: {}, body: { ok: true } };
            });
    }

    // ─── Where the operator goes next ───────────────────────────────────────

    /**
     * The destination for the wizard's final "continue to dashboard" click.
     *
     * Answered by the API because it owns the one fact the client cannot see:
     * whether a dashboard is actually running. With the managed web app enabled
     * the destination is its hostname; without it, this API's own console page —
     * which is answerable and offers to enable one. The client no longer derives
     * this from its own hostname, which could only ever guess and produced a 404
     * on the last click of a successful "API only" setup.
     */
    @Implement(setupContract.getPostSetupDestination)
    getPostSetupDestination() {
        return implement(setupContract.getPostSetupDestination)
            .use(publicAccess())
            .handler(async () => this.postSetupDestination.resolve());
    }

    /**
     * Do the API and the dashboard really answer through the cluster ingress?
     *
     * The wizard asks this (and dials the returned URLs from the browser) before
     * it lets the operator leave: the ingress is replaced at the end of setup and
     * the stream reporting "done" is not evidence that the new one routes.
     */
    @Implement(setupContract.getPostSetupVerification)
    getPostSetupVerification() {
        return implement(setupContract.getPostSetupVerification)
            .use(publicAccess())
            .handler(async () => this.postSetupVerification.verify());
    }

    @Implement(setupContract.getPostSetupVerificationStream)
    getPostSetupVerificationStream() {
        return implement(setupContract.getPostSetupVerificationStream)
            .use(publicAccess())
            .handler(() =>
                liveSnapshot(() => this.postSetupVerification.verify(), {
                    intervalMs: POST_SETUP_VERIFICATION_STREAM_INTERVAL_MS,
                }),
            );
    }
}

/** The JSON body of a response, or null when it is empty or not JSON. */

/**
 * Best-effort extraction of a session token from a `Set-Cookie` header
 * returned by Better Auth.
 */
function extractSessionCookie(setCookieHeader: string): string | null {
    if (!setCookieHeader) return null;

    const cookies = setCookieHeader
        // `Headers` joins several cookies with ", "; a comma inside `Expires=Wed, 21 Oct ...` is not followed by `name=`.
        .split(/,\s*(?=[^\s;,=]+=)/g)
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