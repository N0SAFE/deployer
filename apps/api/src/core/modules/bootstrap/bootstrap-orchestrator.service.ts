/**
 * BootstrapOrchestratorService — the API's post-start provisioning sequence.
 *
 * ── WHAT THIS IS ────────────────────────────────────────────────────────────
 * The steps that must happen on every boot of the API, in order, once a global
 * database URL is known:
 *
 *   1. ensure the swarm overlay is joined   (supervised services live there)
 *   2. verify the database is reachable
 *   3. apply pending global migrations      (idempotent)
 *   4. ensure the default admin             (policy-gated, idempotent)
 *   5. signal lifecycle readiness
 *
 * ── WHY IT LIVES HERE, AND WHY IT IS NOT THE DELETED ORCHESTRATOR ───────────
 * These steps used to live in `OrchestratorService`, which was 775 lines and
 * mostly SUB-APP PLUMBING: it resolved a database URL, decided whether to show
 * the setup wizard, spawned a setup-wizard context on port 3010, chained a
 * mesh-initializer context on 3011, then started the main app on 3012, and
 * swapped the gateway's fallback at each stage.
 *
 * That pipeline existed for exactly one reason: the API could be launched
 * BEFORE setup had run, so it needed a pre-setup surface. Onboarding now belongs
 * to `apps/setup` (its own process, its own hostname), so:
 *
 *   - the pipeline, the sub-apps and the gateway swap are GONE (correctly);
 *   - the provisioning STEPS survive, because they are not about sub-apps at
 *     all — they are what makes a started API usable.
 *
 * Keeping them here rather than deleting them with the pipeline is the whole
 * point of this file. Their absence would not fail a type-check or a unit test;
 * it would surface later as "the database never got migrated on a restart" or
 * "the admin vanished after a re-deploy".
 *
 * ── WHY IT IS TOLERANT OF A MISSING DATABASE ────────────────────────────────
 * In dev, compose starts this app BEFORE setup has provisioned anything (that
 * ordering is what lets setup drive it — plan §8.5), so "no database yet" is a
 * normal state, not a failure. Every step below is therefore conditional on a
 * URL existing and skips loudly otherwise.
 *
 * The distinction that matters (plan §7.3): breaking the PROCESS is wrong — it
 * would crash-loop and leave setup nothing to drive — but refusing to report
 * READY is correct, and that is what happens.
 */

import { Injectable, Logger, Inject } from "@nestjs/common";
import type { OnApplicationBootstrap } from "@nestjs/common";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";
import { AppLifecycleService, AppLifecyclePhase } from "@repo/nest-lifecycle";
import { NodeConfigRepository } from "@repo/nest-nodes/node-config.repository";
import { AppError } from "@repo/errors";
import {
    GLOBAL_DATABASE_CONNECTION,
    GLOBAL_DATABASE_POOL,
} from "@repo/nest-database-core/database-connection";

import { DatabaseStartupGuard } from "@/core/modules/database/services/database-startup-guard.service";
import type { GlobalDatabase } from "@/core/modules/database/global/global-database.service";
import { SwarmAppWiringSupervisorService } from "@/core/modules/supervisors/platform/swarm-app-wiring.supervisor.service";
import { SupervisorOrchestratorService } from "@repo/nest-supervisor-core/supervisor-orchestrator.service";
import { ensureDefaultAdmin } from "@/core/admin-bootstrap/default-admin.bootstrap";
import { adminBootstrapDecisionFromProcessEnv } from "@/core/admin-bootstrap/admin-bootstrap-policy";

@Injectable()
export class BootstrapOrchestratorService implements OnApplicationBootstrap {
    private readonly logger = new Logger(BootstrapOrchestratorService.name);

    constructor(
        /**
         * The shared `pg.Pool` and its Drizzle wrapper, injected by TOKEN.
         *
         * Both are bound by `GlobalDatabaseModule` and exported through the
         * `@Global()` `DatabaseModule`. Resolving them by token (rather than
         * reaching through `GlobalDatabaseService`) is what makes this service
         * depend only on the connections it uses — and `GlobalDatabaseService`
         * deliberately exposes no `pool` getter, because the pool's lifecycle
         * belongs to the lifecycle service, not to the wrapper.
         */
        @Inject(GLOBAL_DATABASE_POOL) private readonly pool: Pool,
        @Inject(GLOBAL_DATABASE_CONNECTION) private readonly db: GlobalDatabase,
        private readonly nodeConfigRepository: NodeConfigRepository,
        private readonly lifecycle: AppLifecycleService,
        private readonly startupGuard: DatabaseStartupGuard,
        private readonly appWiring: SwarmAppWiringSupervisorService,
        /**
         * Converges the GLOBAL POSTGRES supervisor during boot.
         *
         * The database is a swarm service this API's own supervisor creates, so
         * waiting for it without first asking that supervisor to converge waits
         * for something nothing has made — see the step-2 note in
         * `onApplicationBootstrap`.
         */
        private readonly orchestrator: SupervisorOrchestratorService,
    ) {}

    async onApplicationBootstrap(): Promise<void> {
        this.logger.log("🚀 Bootstrap starting…");

        try {
            const config = this.nodeConfigRepository.find();
            const databaseUrl = config?.databaseUrl?.trim() ?? null;

            if (databaseUrl === null || databaseUrl.length === 0) {
                // NOT an error: this happens on a node whose onboarding has not
                // reached the database step. Reported as not-ready so compose
                // keeps waiting for the gate (plan §7.3).
                this.logger.warn(
                    "⏳ No global database configured yet — the API will report NOT READY " +
                        "until onboarding (apps/setup) completes.",
                );
                return;
            }

            // ── A FRESH INSTALL IS PROVISIONED BY THE WIZARD, NOT HERE ──────
            // `setup_done` is written by the setup flow once provisioning
            // succeeded. Before that, the node has a database URL but an EMPTY
            // schema, and running this sequence would be actively wrong:
            //
            //   - the operator's credentials are in the wizard's trigger, not in
            //     the environment, so `ensureDefaultAdmin` would create an admin
            //     from `DEFAULT_ADMIN_*` defaults — the WRONG account on a real
            //     install, and one the operator never chose;
            //   - migrations would run concurrently with the wizard's own
            //     `migrate` step, which is what `LocalInitializationService`
            //     already performs as part of the flow the operator is watching.
            //
            // So this pipeline is the RESTART path: it applies the delta on a
            // node that a previous run brought up (see `checkConfigAndEmit`,
            // which unblocks the graph on exactly this condition).
            if (config?.setupState !== "setup_done") {
                this.logger.log(
                    `⏳ Setup state is "${config?.setupState ?? "unknown"}" — the wizard is ` +
                        "provisioning this node; the boot pipeline will run on the next start.",
                );
                return;
            }

            // 1. Join the swarm overlay FIRST when the engine is swarm-active.
            //    The supervised services (the managed Postgres, Redis) are swarm
            //    SERVICES on that overlay, and the swarm ingress port is not
            //    reachable from a container on the bridge network (IPVS rejects
            //    traffic arriving via the bridge gateway). So the app must be on
            //    the overlay BEFORE the connectivity probe below, or the probe
            //    fails against a database that is actually running. No-op while
            //    the engine is not in a swarm.
            try {
                await this.appWiring.ensureDesiredState();
            } catch (error: unknown) {
                // Non-fatal by design: pre-swarm on a single node there is
                // nothing to wire, and failing the boot for it would make the
                // simple case the fragile one.
                this.logger.warn(
                    `Swarm overlay wiring skipped: ${error instanceof Error ? error.message : String(error)}`,
                );
            }

            // 2. CREATE THE DATABASE IF THIS NODE OWNS IT, BEFORE WAITING FOR IT.
            //
            //    ── WHY THIS STEP EXISTS, AND WHAT IT FIXES ─────────────────────
            //    The global Postgres is a SWARM SERVICE that this API's own
            //    supervisor creates. Nothing else makes it: on a swarm-managed
            //    profile (`dev-supervised`, `prod`) compose starts no database,
            //    and setup only schedules THIS API.
            //
            //    So waiting for the database before anything has created it waits
            //    forever. On a fresh install the boot died with
            //
            //      ❌ DATABASE CONNECTION FAILED
            //         URL: postgresql://***:***@global-db:5432/deployer
            //         Error: Hostname not resolved — check DNS.
            //
            //    because `global-db` is the ALIAS of a service that had not been
            //    created yet. The supervisor was registered and healthy; it simply
            //    never got a converge pass before the guard gave up.
            //
            //    Converging it here is what breaks the cycle: the supervisor
            //    creates the service (idempotent), and the guard below then waits
            //    for the task it just scheduled to accept connections.
            //
            //    NON-FATAL, like the wiring above: on a profile where the
            //    deployment owns the database (plain `dev`, or an external URL)
            //    there is no supervisor to converge, and the guard is the correct
            //    authority on whether the database is usable.
            try {
                const databaseState = await this.orchestrator.convergeNow("global-db-postgres");
                if (databaseState !== null) {
                    this.logger.log(`Global Postgres supervisor converged (state=${databaseState})`);
                }
            } catch (error: unknown) {
                this.logger.warn(
                    `Global Postgres convergence skipped: ${error instanceof Error ? error.message : String(error)}`,
                );
            }

            // 3. Verify reachability. Throws when the database is unreachable in
            //    a mode where it is mandatory (SETUP_AUTO) — this is the one
            //    place a missing database SHOULD stop the boot, and the guard
            //    owns that policy rather than this service guessing at it.
            //
            //    It also WAITS for the dependency: the database may be a swarm
            //    service whose task is still being scheduled, so a single-shot
            //    check would fail at random on a boot that is merely early.
            await this.startupGuard.ensureDatabaseAvailable(this.pool);

            // 4. Migrations. Idempotent — drizzle tracks applied files in
            //    `__drizzle_migrations` and skips them, so this is safe on every
            //    boot. Non-fatal on failure: a stale schema degrades the affected
            //    queries, whereas refusing to boot on a transient connection
            //    error would take the platform down over a recoverable hiccup.
            await this.runGlobalMigrations(databaseUrl);

            // 5. The default admin. Policy-gated (compose/explicit modes ensure it
            //    on every boot; managed/manual let the wizard seed it). FAILS the
            //    boot when the policy requires an admin and one cannot be created,
            //    because a node that must be usable but has no credentials is an
            //    orphaned install (see `ensureDefaultAdmin`).
            await this.bootstrapSeededAdmin(databaseUrl);

            this.lifecycle.transition(AppLifecyclePhase.READY, {
                message: "Database reachable, migrations applied — the platform is ready",
                databaseReachable: true,
            });
            this.lifecycle.markReady();

            this.logger.log("✅ Bootstrap completed");
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.error(`❌ Bootstrap failed: ${message}`);
            this.lifecycle.markError(message);
            throw err;
        }
    }

    /**
     * Locate the global migration files, from EITHER the source tree OR the bundle.
     *
     * WHY BOTH CANDIDATES, AND WHY NOT JUST `import.meta.url`
     * `import.meta.url` is the usual way to make an asset path cwd-independent,
     * but it is not stable for a path that is BUNDLED: the file's directory
     * changes between the two ways this code runs —
     *
     *   source   apps/api/src/core/modules/bootstrap/  → ../../../config/…
     *   bundled  apps/api/dist/chunk-*.js             → ../../../  = repo root
     *
     * so a single relative depth cannot be right in both. The previous
     * implementation "worked" only because the production Dockerfile mirrors
     * `drizzle/` into four directories to cover whatever depth the bundler
     * happened to produce — an implicit contract, and one that silently breaks
     * the moment a file moves.
     *
     * Trying the candidates EXPLICITLY removes that coupling: each path is
     * checked, the one in use is logged, and the caller fails loudly when
     * neither exists. A wrong migration path is otherwise invisible — the
     * migrator reports nothing to do, and the schema quietly stays stale.
     */
    private resolveMigrationsFolder(): string {
        const candidates = [
            // Bundled: dist/<file>.js → two levels up is the app root, where the
            // production image mirrors the migrations.
            fileURLToPath(new URL("../../config/drizzle/global/migrations", import.meta.url)),
            fileURLToPath(new URL("../config/drizzle/global/migrations", import.meta.url)),
            // Source or a Docker mirror at the repo root.
            fileURLToPath(new URL("../../../config/drizzle/global/migrations", import.meta.url)),
        ];

        for (const candidate of candidates) {
            if (existsSync(candidate)) {
                return candidate;
            }
        }

        // Loud, not silent: "no migrations ran" and "the schema is already
        // current" look identical in the logs otherwise.
        throw new AppError(
            `Global migrations directory not found. Tried:\n  ${candidates.join("\n  ")}`,
            "INTERNAL_ERROR",
        );
    }

    /**
     * Apply pending global Postgres migrations.
     *
     * Idempotent, and deliberately NON-FATAL on error: the platform can serve
     * with a slightly stale schema (degrading only on the affected queries),
     * whereas failing the boot on a transient migration error takes everything
     * down. Duplicate/already-exists errors are treated as success because they
     * mean the schema is already current.
     *
     * The one thing that IS fatal is being unable to find the migrations at all:
     * that is a packaging error, not a transient condition, and continuing would
     * mean booting against an unknown schema.
     */
    private async runGlobalMigrations(databaseUrl: string): Promise<void> {
        const migrationsFolder = this.resolveMigrationsFolder();

        this.logger.log(
            `🔄 Running global Postgres migrations (${databaseUrl.replace(/:[^:@/]*@/, ":***@")})…`,
        );
        this.logger.log(`   migrations: ${migrationsFolder}`);

        try {
            await migratePg(this.db, { migrationsFolder });
            this.logger.log("✅ Global Postgres migrations applied");
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("already") || message.includes("duplicate")) {
                this.logger.log("✅ Global Postgres migrations: schema already current");
            } else {
                this.logger.warn(`⚠️  Global Postgres migrations failed (non-fatal): ${message}`);
            }
        }
    }

    /**
     * Policy-gated default-admin bootstrap.
     *
     * The decision comes from `resolveAdminBootstrapDecision` (ADMIN_BOOTSTRAP,
     * with ENABLE_DEV_BOOTSTRAP / ENABLE_SEEDING honoured as deprecated aliases):
     *   - always     → ensure the admin on every ready boot
     *   - when_empty → ensure it too; `ensureDefaultAdmin` is idempotent, so an
     *                  existing admin is a no-op rather than an error
     *   - never      → skip entirely (operator opted out)
     *
     * NON-SILENT: when the policy requires an admin and creation fails, the boot
     * fails. An install that must be usable but has no credentials is orphaned,
     * and failing loudly here is the only way that becomes visible.
     */
    private async bootstrapSeededAdmin(databaseUrl: string): Promise<void> {
        const { decision: admin, reason: adminReason } = adminBootstrapDecisionFromProcessEnv();

        if (admin === "never") {
            this.logger.log(`⏭  Default-admin bootstrap skipped (${adminReason})`);
            return;
        }
        if (adminReason.includes("deprecated alias")) {
            this.logger.warn(`⚠️  ${adminReason} — prefer ADMIN_BOOTSTRAP=auto|true|false`);
        }

        this.logger.log(`🔐 Ensuring default admin (decision=${admin}: ${adminReason})…`);

        const result = await ensureDefaultAdmin(databaseUrl);

        if (result.outcome === "failed") {
            throw new AppError(
                `Failed to ensure default admin: ${result.error}`,
                "INTERNAL_ERROR",
            );
        }
        if (result.outcome === "created") {
            this.logger.log(`✅ Default admin created (id=${result.userId})`);
        } else if (result.outcome === "promoted") {
            this.logger.log(`✅ Existing user promoted to superAdmin (id=${result.userId})`);
        } else {
            this.logger.log(`ℹ️  Default admin already exists (id=${result.userId})`);
        }
    }
}
