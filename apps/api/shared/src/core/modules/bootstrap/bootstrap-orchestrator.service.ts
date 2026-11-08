/**
 * BootstrapOrchestratorService — the API's post-start provisioning sequence.
 *
 * ── WHAT THIS IS ────────────────────────────────────────────────────────────
 * The steps that must happen on every boot of the API, in order, once a global
 * database URL is known:
 *
 *   1. ensure the swarm overlay is joined   (supervised services live there)
 *   2. verify the database is reachable
 *   3. under ONE advisory lock: apply pending global migrations (FATAL on
 *      failure), then ensure the default admin (policy-gated, idempotent)
 *   4. signal lifecycle readiness
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

import { existsSync } from 'node:fs'

import { Logger } from '@nestjs/common'
import { Context, Effect } from 'effect'

import { runPromiseUnwrapped } from '@deployer/effect-core'
// The migration directory is owned by the schema package; resolving it there is
// what keeps the restart path's "apply pending migrations" step from silently
// finding nothing (see `resolveMigrationsFolder`).
import { resolveManagedGlobalDbUrl, splitManagedEnv } from '@deployer/env'
import { AppError } from '@deployer/errors'
import { AppLifecyclePhase, type AppLifecycleShape } from '@deployer/lifecycle'
import type { ServiceLifecycleShape } from '@deployer/nest-effect'
import { GLOBAL_MIGRATIONS_DIR } from '@deployer/nest-schema'
import type { NodeConfigRepositoryShape } from '@deployer/node-state'
import type { SupervisorOrchestratorShape } from '@deployer/supervision'

import { adminBootstrapDecisionFromProcessEnv } from '../../admin-bootstrap/admin-bootstrap-policy'
import { ensureDefaultAdmin } from '../../admin-bootstrap/default-admin.bootstrap'
import { applyGlobalMigrations } from '../database/migrations/global-migrations'
import { SWARM_APP_WIRING_SUPERVISOR_ID } from '../supervisors/platform/swarm-app-wiring.supervisor'

import { BootstrapFailed } from './bootstrap.errors'

import type { GlobalDatabase } from '../database/global/global-database.service'
import type { BootstrapAdvisoryLockServiceShape } from '../database/services/bootstrap-advisory-lock.service'
import type { DatabaseStartupGuardShape } from '../database/services/database-startup-guard.service'
import type { Pool } from 'pg'

export type BootstrapOrchestratorServiceShape = ServiceLifecycleShape

/** What the orchestrator is built from. */
export type BootstrapOrchestratorOptions = {
    /**
     * The shared `pg.Pool` and its Drizzle wrapper, injected by TOKEN. Both are bound by `GlobalDatabaseModule` and exported
     * through the `@Global()` `DatabaseModule`. Resolving them by token (rather than reaching through
     * `GlobalDatabaseService`) is what makes this service depend only on the connections it uses — and
     * `GlobalDatabaseService` deliberately exposes no `pool` getter, because the pool's lifecycle belongs to the pool
     * lifecycle, not to the wrapper.
     */
    readonly pool: Pool
    readonly db: GlobalDatabase
    readonly nodeConfigRepository: NodeConfigRepositoryShape
    /** Advanced to READY when the boot pipeline completes. */
    readonly lifecycle: AppLifecycleShape
    readonly startupGuard: DatabaseStartupGuardShape
    /**
     * Cross-replica guard around the boot-time side effects (migrations + default admin). The step before it (converging the
     * DB supervisor) cannot be guarded: the lock IS a database session, so it can only be taken once the database that
     * supervisor creates is reachable.
     */
    readonly bootstrapLock: BootstrapAdvisoryLockServiceShape
    /**
     * Converges the GLOBAL POSTGRES supervisor during boot. The database is a swarm service this API's own supervisor
     * creates, so waiting for it without first asking that supervisor to converge waits for something nothing has made.
     */
    readonly orchestrator: SupervisorOrchestratorShape
}

export class BootstrapOrchestratorService extends Context.Service<
    BootstrapOrchestratorService,
    BootstrapOrchestratorServiceShape
>()('shared/BootstrapOrchestratorService') {
    /**
     * Collaborators are constructor arguments: the shape is `ServiceLifecycleShape`,
     * whose members have an empty requirement channel.
     */
    static readonly live = class BootstrapOrchestratorServiceImpl
        implements BootstrapOrchestratorServiceShape
    {
        private readonly logger = new Logger('BootstrapOrchestratorService')
        private readonly pool: Pool
        private readonly db: GlobalDatabase
        private readonly nodeConfigRepository: NodeConfigRepositoryShape
        private readonly lifecycle: AppLifecycleShape
        private readonly startupGuard: DatabaseStartupGuardShape
        private readonly bootstrapLock: BootstrapAdvisoryLockServiceShape
        private readonly orchestrator: SupervisorOrchestratorShape

        constructor(options: BootstrapOrchestratorOptions) {
            this.pool = options.pool
            this.db = options.db
            this.nodeConfigRepository = options.nodeConfigRepository
            this.lifecycle = options.lifecycle
            this.startupGuard = options.startupGuard
            this.bootstrapLock = options.bootstrapLock
            this.orchestrator = options.orchestrator
        }

    private async bootstrap(): Promise<void> {
        this.logger.log('🚀 Bootstrap starting…')

        try {
            const config = await runPromiseUnwrapped(
                this.nodeConfigRepository.find()
            )
            const databaseUrl = this.resolveDatabaseUrl(
                config?.databaseUrl?.trim() ?? null
            )

            if (databaseUrl === null || databaseUrl.length === 0) {
                // NOT an error: this happens on a node whose onboarding has not
                // reached the database step. Reported as not-ready so compose
                // keeps waiting for the gate (plan §7.3).
                this.logger.warn(
                    '⏳ No global database configured yet — the API will report NOT READY ' +
                        'until onboarding (apps/setup) completes.'
                )
                return
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
            if (config?.setupState !== 'setup_done') {
                this.logger.log(
                    `⏳ Setup state is "${config?.setupState ?? 'unknown'}" — the wizard is ` +
                        'provisioning this node; the boot pipeline will run on the next start.'
                )
                return
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
                await runPromiseUnwrapped(
                    this.orchestrator.convergeNow(SWARM_APP_WIRING_SUPERVISOR_ID)
                )
            } catch (error: unknown) {
                // Non-fatal by design: pre-swarm on a single node there is
                // nothing to wire, and failing the boot for it would make the
                // simple case the fragile one.
                this.logger.warn(
                    `Swarm overlay wiring skipped: ${error instanceof Error ? error.message : String(error)}`
                )
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
                const databaseState = await runPromiseUnwrapped(
                    this.orchestrator.convergeNow('global-db-postgres')
                )
                if (databaseState !== null) {
                    this.logger.log(
                        `Global Postgres supervisor converged (state=${databaseState})`
                    )
                }
            } catch (error: unknown) {
                this.logger.warn(
                    `Global Postgres convergence skipped: ${error instanceof Error ? error.message : String(error)}`
                )
            }

            // 3. Verify reachability. Throws when the database is unreachable in
            //    a mode where it is mandatory (SETUP_AUTO) — this is the one
            //    place a missing database SHOULD stop the boot, and the guard
            //    owns that policy rather than this service guessing at it.
            //
            //    It also WAITS for the dependency: the database may be a swarm
            //    service whose task is still being scheduled, so a single-shot
            //    check would fail at random on a boot that is merely early.
            await runPromiseUnwrapped(
                this.startupGuard.ensureDatabaseAvailable(this.pool)
            )

            // 4. Migrations and the default admin, UNDER AN ADVISORY LOCK.
            //    Both are convergent but not atomic: two replicas booting at once
            //    run the same DDL and the same admin upsert, and the loser fails on
            //    a duplicate object (or both create an admin). The lock makes one
            //    replica the writer; a loser skips and proceeds — it booted against
            //    the schema the winner is applying.
            //
            //    A migration failure is FATAL: booting against a schema nobody
            //    verified fails later on an unrelated query, which is a much worse
            //    place to discover it. See `applyGlobalMigrations`.
            const lockAcquired = await runPromiseUnwrapped(
                this.bootstrapLock.acquire()
            )
            if (!lockAcquired) {
                this.logger.warn(
                    '⏭  Another replica holds the bootstrap lock — migrations and the ' +
                        'default admin are being applied there; continuing to readiness.'
                )
            } else {
                try {
                    await this.runGlobalMigrations(databaseUrl)
                    await this.bootstrapSeededAdmin(databaseUrl)
                } finally {
                    await runPromiseUnwrapped(this.bootstrapLock.release())
                }
            }

            this.lifecycle.transitionNow(AppLifecyclePhase.READY, {
                message:
                    'Database reachable, migrations applied — the platform is ready',
                databaseReachable: true,
            })
            this.lifecycle.markReadyNow()

            this.logger.log('✅ Bootstrap completed')
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            this.logger.error(`❌ Bootstrap failed: ${message}`)
            this.lifecycle.markErrorNow(message)
            throw err
        }
    }

    /**
     * Resolve the database URL the SAME WAY THE SHARED POOL DOES.
     *
     * ── WHY THIS METHOD EXISTS ──────────────────────────────────────────────
     * This service used to read `node_config.databaseUrl` directly and hand it
     * to the migrator and to `ensureDefaultAdmin`, while the pool that serves
     * every query resolved its URL from `MANAGED_GLOBAL_DB_*` instead. TWO
     * resolvers for one platform, and they disagreed:
     *
     *   pool (query path)   → postgresql://…@nextjs-nestjs-global-db:5432/deployer
     *   bootstrap (DDL path)→ postgresql://…@global-db:5432/deployer   ← stale row
     *
     * The second URL is AMBIGUOUS, because `global-db` is carried by two
     * containers on two networks and the answer depends on the caller's network
     * attachments. The BFF is on the overlay as well as the bridge, so its
     * migrations and its admin bootstrap landed on the SWARM database (91
     * tables, `admin@admin.com` present) while its queries landed on the empty
     * COMPOSE one. That is what produced
     *
     *   {"message":"Invalid email or password"}   ← sign-in against the empty DB
     *   GET /analytics/metrics/realtime → 500     ← svc-identity had no schema
     *
     * after the migrations had just been logged as applied.
     *
     * The pool's precedence is authoritative — compose-managed env first, the
     * persisted row only when no managed database is configured — so this
     * mirrors it exactly. Anything else reintroduces the split.
     */
    private resolveDatabaseUrl(
        configuredUrl: string | null
    ): string | null {
        const managed = splitManagedEnv(process.env).globalDb
        if (managed.enabled) {
            // With `MANAGED_GLOBAL_DB_ENABLED=true` the deployment owns the
            // database and the URL is derived from env — the persisted row is a
            // leftover from an earlier profile and must not win.
            return resolveManagedGlobalDbUrl(managed)
        }
        return configuredUrl === '' ? null : configuredUrl
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
        // ── THE PACKAGE THAT OWNS THE MIGRATIONS RESOLVES THEM ──────────────
        // This used to try three hand-counted `../../..` candidates aimed at
        // `apps/<app>/src/config/drizzle/global/migrations`. When `src/config`
        // was relocated under `shared/`, none of them reached a real directory
        // and the helper threw BEFORE logging anything useful — so the
        // "apply pending global migrations" step of the restart path silently
        // never ran. Measured consequence: a node marked `setup_done` booted
        // against an EMPTY Postgres and every service retried preflight forever:
        //
        //   relation "drizzle.__drizzle_migrations" does not exist
        //   relation "local_event_outbox" does not exist
        //   [preflight] preflight attempt 364 not ready — retrying in 2000ms
        //
        // `GLOBAL_MIGRATIONS_DIR` walks up from the schema package until it finds
        // `migrations/global/meta/_journal.json`, so it is correct from source, from
        // the bundle, and from the published volume the apps actually resolve.
        // `existsSync` is kept as a guard because a packaging error must still be
        // loud rather than become "nothing to migrate".
        if (!existsSync(GLOBAL_MIGRATIONS_DIR)) {
            throw new AppError(
                `Global migrations directory not found at ${GLOBAL_MIGRATIONS_DIR}`,
                'INTERNAL_ERROR'
            )
        }
        return GLOBAL_MIGRATIONS_DIR
    }

    /**
     * Apply pending global Postgres migrations.
     *
     * FATAL on failure: a boot that continues against a schema nobody verified
     * fails later, on an unrelated query, with an error that points at the
     * symptom rather than at the migration. The only case treated as success is
     * `already-applied`, decided by SQLSTATE inside `applyGlobalMigrations` —
     * not by matching words in the driver's message.
     */
    private async runGlobalMigrations(databaseUrl: string): Promise<void> {
        const migrationsFolder = this.resolveMigrationsFolder()

        this.logger.log(
            `🔄 Running global Postgres migrations (${databaseUrl.replace(/:[^:@/]*@/, ':***@')})…`
        )
        this.logger.log(`   migrations: ${migrationsFolder}`)

        const outcome = await applyGlobalMigrations(this.db, { migrationsFolder })
        if (outcome === 'already-applied') {
            this.logger.log('✅ Global Postgres migrations: schema already current')
        } else {
            this.logger.log('✅ Global Postgres migrations applied')
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
    private async bootstrapSeededAdmin(
        databaseUrl: string
    ): Promise<void> {
        const { decision: admin, reason: adminReason } =
            adminBootstrapDecisionFromProcessEnv()

        if (admin === 'never') {
            this.logger.log(`⏭  Default-admin bootstrap skipped (${adminReason})`)
            return
        }
        if (adminReason.includes('deprecated alias')) {
            this.logger.warn(
                `⚠️  ${adminReason} — prefer ADMIN_BOOTSTRAP=auto|true|false`
            )
        }

        this.logger.log(
            `🔐 Ensuring default admin (decision=${admin}: ${adminReason})…`
        )

        const result = await ensureDefaultAdmin(databaseUrl)

        if (result.outcome === 'failed') {
            throw new AppError(
                `Failed to ensure default admin: ${result.error}`,
                'INTERNAL_ERROR'
            )
        }
        if (result.outcome === 'created') {
            this.logger.log(`✅ Default admin created (id=${result.userId})`)
        } else if (result.outcome === 'promoted') {
            this.logger.log(
                `✅ Existing user promoted to superAdmin (id=${result.userId})`
            )
        } else {
            this.logger.log(`ℹ️  Default admin already exists (id=${result.userId})`)
        }
    }

    // Runs once every module has finished initialising (the supervisors registered their work), and a failure fails the
    // boot: refusing to report READY is correct, breaking the PROCESS is wrong only when the database is merely absent.
    onReady(): Effect.Effect<void, BootstrapFailed> {
        return Effect.tryPromise({
            try: () => this.bootstrap(),
            catch: (cause) =>
                new BootstrapFailed({
                    reason:
                        cause instanceof Error ? cause.message : String(cause),
                    cause,
                }),
        })
    }
    }
}
