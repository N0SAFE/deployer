/**
 * OrchestratorService — Event-driven sub-app pipeline manager.
 *
 * Pipeline:
 *   1. db-resolver (headless) — resolves database URL from env/SQLite
 *   2. setup-wizard (HTTP, conditional) — wizard for manual DB config
 *   3. mesh-initializer (HTTP) — discovers DB URL from mesh peers
 *   4. main-app (HTTP, last) — full AppModule with 225+ routes
 *
 * Sub-apps import core modules directly (no forwarded shared providers).
 * Cross-sub-app communication uses bridge classes with static state
 * (BaseTriggerService.sharedStates keyed by bridge class name).
 *
 * Event-driven: uses InitializationService.waitForSetup() (Promise) to
 * know when setup completes — no polling.
 */

import { Injectable, Inject, Logger, type INestApplication, type OnApplicationBootstrap } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { RouteRegistryService } from "../gateway/route-registry.service";
import { NodeConfigRepository } from "../modules/setup/repositories/node-config.repository";
import { SetupDevModule } from "../setup-dev/setup-dev.module";
import { ensureDefaultAdmin } from "../setup-dev/default-admin.bootstrap";
import { describePolicy, provisioningPolicyFromProcessEnv } from "../setup-dev/provisioning-policy";
import { SetupSubAppModule } from "../setup-sub-app/setup-sub-app.module";
import { runSubApp } from "../sub-app/sub-app-runner";
import { AppModule } from "../../app.module";
import { InternalErrorExceptionFilter } from "../middlewares/internal-error/internal-error-exception.filter";
import { APIErrorExceptionFilter } from "../modules/auth/filters/api-error-exception-filter";
import { SetupWizardBridge } from "../../sub-apps/setup-wizard/setup-wizard.bridge";
import { MeshInitializerBridge } from "../../sub-apps/mesh-initializer/mesh-initializer.bridge";
import { MeshInitializerAppModule } from "../../sub-apps/mesh-initializer/mesh-initializer.app.module";
import { AppLifecycleService, AppLifecyclePhase } from "@repo/nest-lifecycle";
import { splitManagedEnv } from "@repo/env";
import { DatabaseStartupGuard } from "../modules/database/services/database-startup-guard.service";
import { DatabaseProbeService } from "../modules/database/services/database-probe.service";
import { PostgresContainerService, MANAGED_POSTGRES_CONTAINER_NAME, MANAGED_POSTGRES_PORT } from "../modules/docker/containers/postgres/postgres-container.service";
import { TraefikPlatformConfigService } from "../modules/traefik/services/traefik-platform-config.service";
import { Pool } from "pg";
import { GLOBAL_DATABASE_CONNECTION, GLOBAL_DATABASE_POOL } from "../modules/database/database-connection";
import type { GlobalDatabase } from "../modules/database/global/global-database.service";

import { AppError } from "@repo/errors";
@Injectable()
export class OrchestratorService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OrchestratorService.name);
  private setupApp: INestApplication | null = null;

  constructor(
    private readonly registry: RouteRegistryService,
    private readonly nodeConfigRepository: NodeConfigRepository,
    private readonly lifecycle: AppLifecycleService,
    private readonly startupGuard: DatabaseStartupGuard,
    private readonly probeService: DatabaseProbeService,
    private readonly postgresContainerService: PostgresContainerService,
    /** Traefik core CONFIG handler — writes the instance dynamic config
     *  AFTER setup (DB exists). The supervisor stays process-only. */
    private readonly ingressConfig: TraefikPlatformConfigService,
    @Inject(GLOBAL_DATABASE_POOL) private readonly pool: Pool,
    @Inject(GLOBAL_DATABASE_CONNECTION) private readonly db: GlobalDatabase,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.logger.log("🚀 Orchestrator starting sub-app pipeline…");

    // ── Step 0: Log the single derived provisioning decision ─────────────
    // One line that states HOW this boot will behave — mode, DB source,
    // whether setup is expected, admin bootstrap decision and the probe
    // failure policy. Makes the old "same symptom, three causes" ambiguity
    // visible at a glance (see docs/setup-unification-plan.md §2/§8).
    const bootManaged = splitManagedEnv(
      process.env as unknown as Record<string, unknown>,
    ).globalDb;
    const bootPolicy = provisioningPolicyFromProcessEnv(bootManaged);
    this.logger.log(`[ProvisioningPolicy] ${describePolicy(bootPolicy)}`);

    // ── Step 1: Resolve database URL (dev bootstrap) ────────────────────
    await this.runDbResolver();

    // ── Step 1a: Publish the platform ingress config NOW ────────────────
    // The Traefik dynamic config must exist WHILE the setup wizard runs —
    // on FIRST BOOT there is no database yet, so the previous deferral to
    // startMainApp() left Traefik with an empty config dir and
    // api.<host> / web.<host> were unreachable. The domain family tolerates
    // the missing DB (skipped, logged); api + web routes are always written
    // so the platform surfaces are reachable from the moment this pipeline
    // boots (the supervisor already converged the process).
    try {
      await this.ingressConfig.writePlatformConfigs();
      this.logger.log("✅ Platform ingress config published at boot");
    } catch (error: unknown) {
      this.logger.warn(`Boot ingress config write skipped: ${error instanceof Error ? error.message : String(error)}`);
    }

    // ── Step 1b: Guard for stale corrupted config ───────────────────────
    // If setup_state='setup_done' but database_url is empty, the previous
    // provisioning attempt wrote an incomplete config. Reset so SETUP_AUTO
    // can re-provision from scratch (otherwise the setup wizard receives an
    // empty URL and fails Zod min(1) validation).
    //
    // There is NO "local-only" exception: the global database is mandatory
    // even in dev, so setup_done + empty databaseUrl is always an invalid
    // state that must be reset to re-provision.
    const staleConfig = this.nodeConfigRepository.find();
    if (staleConfig?.setupState === 'setup_done' && (!staleConfig.databaseUrl || staleConfig.databaseUrl.trim() === '')) {
      this.logger.warn('⚠️  Stale node_config detected (setup_done + empty database_url) — resetting to needs_setup for re-provisioning');
      this.nodeConfigRepository.upsert({
        ...staleConfig,
        setupState: 'not_started',
        databaseUrl: null as any,
        configuredAt: null as any,
        updatedAt: new Date().toISOString(),
      });
    }

    // ── Step 2: Load config and check state ─────────────────────────────
    const config = this.nodeConfigRepository.find();
    // Managed (local) Postgres: the container's RANDOM host port can drift
    // when docker recreates it (e.g. host reboot or manual recreate). Refresh
    // the persisted URL to the CURRENT mapped port BEFORE the connectivity
    // guard — otherwise a stale port hard-fails SETUP_AUTO at boot.
    const databaseUrl = (await this.refreshManagedDatabaseUrl(config)) ?? config?.databaseUrl?.trim() ?? null;
    const isConfigured = config?.setupState === 'setup_done' || config?.configuredAt;

    if (databaseUrl) {
      // ── Local SQLite has a DB URL but state is corrupted ──────────────
      // This means the local config lost its setup_done state (e.g., SQLite
      // was recreated or migrated). Try to heal by verifying the global DB.
      if (!isConfigured) {
        // First boot with a PROVIDED (candidate) DB URL: the URL was persisted
        // by Phase 0 but setup has not run yet. This is the DESIGNED path, not
        // a warning — the orchestrator either heals from an existing DB or
        // starts the wizard to initialize it.
        this.logger.log('ℹ️  Local SQLite has a candidate DB URL and setup is not complete — attempting heal / wizard');
        const healed = await this.tryHealFromGlobalDb(databaseUrl, config);
        if (healed) {
          this.logger.log('✅ Local config healed from global database');
        } else {
          // Couldn't connect to global DB — show setup wizard
          this.logger.log('⏳ Cannot heal from global DB — starting setup wizard');
          await this.startSetupWizard();
          this.waitForSetupAndContinue().catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`❌ Orchestration failed: ${msg}`);
          });
          return;
        }
      }

      this.lifecycle.transition(AppLifecyclePhase.DISCOVERING, {
        message: "Database URL found in local config, verifying connectivity…",
        databaseUrl,
      });

      // ── Verify → migrate → admin → mesh-init → main-app ──────────────
      await this.runReadyPipeline(databaseUrl, config!);
    } else {
      // ── No URL in local config — try to discover Postgres from env ──

      // Before launching the setup wizard, check if an explicit database
      // URL is set (e.g., from docker-compose). If the DB already has
      // tables, heal the local config and skip the wizard entirely.
      const envUrl = (
        process.env.SETUP_AUTO_DATABASE_URL ??
        process.env.SETUP_DATABASE_URL ??
        ''
      ).trim();
      if (envUrl) {
        this.logger.log(`🔍 Found explicit database URL in env — probing for existing database…`);
        const healed = await this.tryHealFromGlobalDb(envUrl, config || {});
        if (healed) {
          // Config was written — reload and proceed as configured
          const updatedConfig = this.nodeConfigRepository.find();
          const updatedUrl = updatedConfig?.databaseUrl?.trim() ?? null;
          if (updatedUrl) {
            this.logger.log('✅ Healed from explicit database URL — proceeding to main flow');
            await this.runReadyPipeline(updatedUrl, updatedConfig!);
            return;
          }
        } else {
          this.logger.log('ℹ️  Explicit database URL present but DB has no tables or unreachable');
        }
      }

      this.logger.log("⏳ No existing database detected — starting setup wizard");
      await this.startSetupWizard();
      this.waitForSetupAndContinue().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        // In SETUP_AUTO mode a missing/unreachable database is FATAL — never
        // degrade into a headless boot. Non-SETUP_AUTO keeps the manual
        // wizard loop alive so the user can complete setup in the UI.
        if (process.env.SETUP_AUTO === 'true') {
          this.logger.error(`❌ SETUP_AUTO boot failed without a global database: ${msg}`);
          process.exit(1);
        }
        this.logger.error(`❌ Orchestration failed: ${msg}`);
      });
    }
  }

  /**
   * Try to heal a corrupted local config by checking the global Postgres database.
   * If the global DB is reachable and has tables, the setup was completed before —
   * reconstruct the local config from the existing database state.
   */
  private async tryHealFromGlobalDb(databaseUrl: string, config: any): Promise<boolean> {
    try {
      // Probe the global DB to check if it's reachable and has tables
      const probeResult = await this.probeService.probe(databaseUrl, { timeout: 5_000 });
      if (!probeResult.reachable) {
        this.logger.warn(`Cannot reach global DB at ${databaseUrl} — cannot heal`);
        return false;
      }

      // Check if the global DB has tables (setup was completed)
      const probePool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5_000 });
      try {
        const res = await probePool.query<{ table_name: string }>(`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
          LIMIT 1;
        `);
        if (res.rows.length === 0) {
          // Fresh/empty provided DB on first boot — the wizard will initialize it.
          this.logger.log('ℹ️  Global DB is empty (fresh install) — cannot heal, setup wizard will initialize it');
          return false;
        }

        // Global DB has tables — reconstruct local config
        const now = new Date().toISOString();
        this.nodeConfigRepository.upsert({
          nodeId: config?.nodeId ?? randomUUID(),
          strategy: config?.strategy ?? 'local',
          setupState: 'setup_done',
          deployerVersion: config?.deployerVersion ?? 'unknown',
          databaseUrl,
          // Healing reconstructs config around an EXISTING database the node
          // did not spawn — externally managed, never supervised by the API.
          databaseProvisioning: 'external' as const,
          configuredAt: config?.configuredAt ?? now,
          meshUrlsSnapshot: config?.meshUrlsSnapshot ?? [],
          updatedAt: now,
        });
        this.logger.log('✅ Local SQLite config healed — setupState set to setup_done');
        return true;
      } finally {
        await probePool.end().catch(() => undefined);
      }
    } catch (err: unknown) {
      this.logger.warn(`Heal attempt failed: ${(err as Error).message}`);
      return false;
    }
  }

  // ─── Step 1b: Managed Postgres URL self-heal ─────────────────────────
  /**
   * When the global DB is LOCALLY MANAGED (a dockerode container), its
   * published HOST PORT is random and can drift if docker recreates the
   * container (host reboot, manual recreate). The persisted URL in
   * node_config becomes stale → the boot-time connectivity guard fails with
   * "Connection refused". This re-reads the CURRENT mapped port and refreshes
   * the persisted URL (same user/pass/host/db, new port) when it drifted.
   * Returns the effective URL (fresh when healed, the stored one otherwise,
   * null when no URL is configured). External DBs are never touched.
   */
  private async refreshManagedDatabaseUrl(config: ReturnType<NodeConfigRepository["find"]>): Promise<string | null> {
    const stored = config?.databaseUrl?.trim() ?? null;
    if (stored === null || config?.databaseProvisioning !== "local") return stored;
    try {
      const currentPort = await this.postgresContainerService.getMappedPort(MANAGED_POSTGRES_CONTAINER_NAME, MANAGED_POSTGRES_PORT);
      const parsed = new URL(stored);
      if (Number(parsed.port) === currentPort) return stored;
      parsed.port = String(currentPort);
      const fresh = parsed.toString();
      this.logger.log(`♻️  Managed Postgres host port drifted (${String(parsed.port)} → ${String(currentPort)}) — refreshing node_config URL`);
      await this.nodeConfigRepository.upsert({
        ...config,
        databaseUrl: fresh,
        updatedAt: new Date().toISOString(),
      });
      return fresh;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`⚠️  Managed Postgres URL refresh skipped: ${msg}`);
      return stored;
    }
  }

  // ─── Bridge: emit to SetupWizardBridge for mesh-init ───────────────

  private emitSetupWizardBridge(databaseUrl: string, config: any): void {
    const bridge = new SetupWizardBridge();
    bridge.emit({
      databaseUrl,
      strategy: config?.strategy ?? "local",
      nodeId: config?.nodeId ?? "unknown",
    });
    bridge.complete();
    this.logger.log("🔗 Emitted to SetupWizardBridge");
  }

  // ─── Step 1: Database URL Resolver (headless) ──────────────────────

  private async runDbResolver(): Promise<void> {
    this.logger.log("⚡ Resolving database URL…");
    try {
      const ctx = await NestFactory.createApplicationContext(SetupDevModule, {
        logger: ["log", "warn", "error"],
      });
      await ctx.close();
      this.logger.log("✅ Database URL resolved");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // SetupDevService throws when SETUP_AUTO requested an explicit URL that
      // is unreachable. That is a FATAL boot condition — the global database
      // is mandatory, there is no local-only fallback. Do NOT swallow it.
      if (process.env.SETUP_AUTO === 'true') {
        this.logger.error(`❌ DB resolver FAILED in SETUP_AUTO mode: ${message}`);
        throw err;
      }
      // Non-SETUP_AUTO (manual wizard flow): tolerate resolver noise — the
      // setup wizard will handle configuration from scratch.
      this.logger.warn(`⚠️  DB resolver: ${message}`);
    }
  }

  /**
   * Apply pending global Postgres migrations. Idempotent — drizzle's
   * migrator tracks which migrations have been applied in a
   * "__drizzle_migrations" table and skips already-run files.
   *
   * Called after DB verification and before the main app starts, so
   * the schema is always up to date without requiring a manual
   * `db:migrate` step. Failures are logged but do NOT block boot —
   * the app can still start with a slightly stale schema (it will
   * degrade on the affected queries rather than crash).
   */
  private async runGlobalMigrations(): Promise<void> {
    // Skip if no Postgres URL — GlobalDatabaseModule creates a placeholder
    // pool with an empty connection string when the URL is not yet known.
    const config = this.nodeConfigRepository.find();
    if (!config?.databaseUrl?.trim()) {
      this.logger.log('ℹ️  No global database URL — skipping Postgres migrations');
      return;
    }

    const migrationsFolder = fileURLToPath(
      new URL("../../config/drizzle/global/migrations", import.meta.url),
    );
    this.logger.log("🔄 Running global Postgres migrations…");
    try {
      await migratePg(this.db, { migrationsFolder });
      this.logger.log("✅ Global Postgres migrations applied");
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      // Duplicate/already-existed errors are benign — the schema is current.
      if (msg.includes("already") || msg.includes("duplicate")) {
        this.logger.log(`✅ Global Postgres migrations: schema already current (${msg})`);
      } else {
        this.logger.warn(`⚠️  Global Postgres migrations failed (non-fatal): ${msg}`);
      }
    }
  }

  /**
   * Ready-database pipeline — verify → migrate → admin → mesh-init → main-app.
   *
   * The ONLY path that runs once a usable database URL exists (already
   * configured, or healed from an existing DB). Both the local-config branch
   * and the env-URL heal branch converge here so the sequence cannot drift.
   */
  private async runReadyPipeline(databaseUrl: string, config: any): Promise<void> {
    // ── Verify database is reachable ─────────────────────────────────
    await this.startupGuard.ensureDatabaseAvailable(this.pool);

    // ── Auto-migrate global Postgres (idempotent) ────────────────────
    await this.runGlobalMigrations();

    // ── Policy-gated bootstrap: default admin after migrations ───────
    await this.bootstrapSeededAdmin(databaseUrl);

    this.lifecycle.transition(AppLifecyclePhase.READY, {
      message: "Database reachable, proceeding to mesh-init → main-app",
      databaseReachable: true,
    });
    // ── Mesh init ────────────────────────────────────────────────────
    this.emitSetupWizardBridge(databaseUrl, config);
    await this.runMeshInitializer();

    // ── Main app ─────────────────────────────────────────────────────
    await this.startMainApp();
  }

  /**
   * Policy-gated bootstrap: ensure the default admin exists after migrations.
   *
   * The decision comes from ProvisioningPolicy (ADMIN_BOOTSTRAP, with
   * ENABLE_DEV_BOOTSTRAP / ENABLE_SEEDING honoured as deprecated aliases):
   *   - always      → ensure the admin on every ready boot (compose/explicit
   *                   modes — no wizard fallback).
   *   - when_empty  → the wizard seeds an empty DB; this idempotent ensure
   *                   covers the healed/restart path (managed/manual modes).
   *   - never       → skip entirely (operator opted out).
   *
   * The default admin is created via ensureDefaultAdmin (Better Auth — the
   * single source of truth for credential hashing). NON-SILENT: when the
   * decision requires an admin and creation fails, the boot FAILS — a node
   * that must be usable but has no credentials is an orphaned install.
   */
  private async bootstrapSeededAdmin(databaseUrl: string): Promise<void> {
    const managed = splitManagedEnv(
      process.env as unknown as Record<string, unknown>,
    ).globalDb;
    const policy = provisioningPolicyFromProcessEnv(managed);
    const { admin, adminReason } = policy;

    if (admin === "never") {
      this.logger.log(`⏭  Default-admin bootstrap skipped (${adminReason})`);
      return;
    }
    if (adminReason.includes("deprecated alias")) {
      this.logger.warn(
        `⚠️  ${adminReason} — prefer ADMIN_BOOTSTRAP=auto|true|false`,
      );
    }

    this.logger.log(`🔐 Ensuring default admin (decision=${admin}: ${adminReason})…`);
    const result = await ensureDefaultAdmin(databaseUrl);
    if (result.outcome === "failed") {
      // Never boot a node whose required admin is missing — surface loudly.
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

  // ─── Step 2: Setup Wizard (HTTP, conditional) ──────────────────────

  private async startSetupWizard(): Promise<void> {
    this.logger.log("▶️ Starting setup-wizard (port 3010)…");
    const { app } = await runSubApp(
      { id: "setup-wizard", module: SetupSubAppModule, port: 3010 },
      this.registry,
    );
    this.setupApp = app;
    this.logger.log("✅ Setup wizard running — awaiting event-driven continuation");
  }

  // ─── Step 3: Mesh Initializer ──────────────────────────────────────

  private async runMeshInitializer(): Promise<void> {
    this.logger.log("▶️ Starting mesh-initializer (port 3011)…");
    this.lifecycle.transition(AppLifecyclePhase.JOINING_MESH, {
      message: "Connecting to mesh peers…",
    });

    await runSubApp(
      { id: "mesh-initializer", module: MeshInitializerAppModule, port: 3011, initBeforeExtract: true },
      this.registry,
    );
    // Wait for the bridge (fired when mesh init completes)
    const meshBridge = new MeshInitializerBridge();
    const result = await meshBridge.waitFor();
    this.logger.log(`✅ Mesh init done (strategy=${result.strategy}, meshConnected=${String(result.meshConnected)})`);

    // ── Sync discovered mesh peers to local SQLite ──────────────
    // Persist discovered peer URLs to node_config.meshUrlsSnapshot
    // so they survive restarts. The bridge result carries the mesh
    // info; we also persist the current peer list from config.
    if (result.meshConnected) {
      this.lifecycle.markMeshConnected(true);
      this.lifecycle.transition(AppLifecyclePhase.READY, {
        message: "Mesh connected, database reachable",
        meshConnected: true,
      });
      try {
        await this.syncMeshPeersToLocalConfig();
      } catch (err: unknown) {
        this.logger.warn(`Mesh peer sync failed: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Persist currently known mesh peer URLs to local SQLite node_config.
   * This ensures meshUrlsSnapshot survives restarts.
   */
  private async syncMeshPeersToLocalConfig(): Promise<void> {
    const config = this.nodeConfigRepository.find();
    const existingPeers = config?.meshUrlsSnapshot ?? [];

    // Use the updateMeshPeers method that merges new peers with existing ones
    if (existingPeers.length > 0) {
      this.nodeConfigRepository.updateMeshPeers(existingPeers);
      this.logger.log(`✅ Persisted ${existingPeers.length} mesh peer(s) to local config`);
    } else {
      this.logger.warn("No mesh peers found to persist to local config");
    }
  }

  // ─── Event-driven: Setup → Mesh → Main App ────────────────────────

  private async waitForSetupAndContinue(): Promise<void> {
    const { InitializationService } = await import(
      "../modules/setup/services/initialization.service"
    );

    if (!this.setupApp) {
      throw new AppError("Setup-wizard app not available", "INTERNAL_ERROR");
    }

    // Get the SAME InitializationService from the running setup-wizard's DI
    const initService = this.setupApp.get(InitializationService);
    const status = await initService.waitForSetup();
    this.logger.log(`✅ Setup done (strategy=${status.strategy}) — firing bridge, starting mesh-init`);

    // A completed setup MUST carry a real database URL. Without it the app
    // would boot headless with no global Postgres — not allowed. Fail hard.
    if (!status.databaseUrl || status.databaseUrl.trim() === '') {
      throw new AppError(
        'Setup completed without a database URL — refusing to boot without a global Postgres database',
        'DATABASE_UNAVAILABLE',
      );
    }

    // Emit to SetupWizardBridge so mesh-init picks up the DB URL
    this.emitSetupWizardBridge(status.databaseUrl, {
      strategy: status.strategy,
      nodeId: status.nodeId,
    });

    await this.runMeshInitializer();
    await this.startMainApp();
  }

  // ─── Step 4: Main App (last, all feature modules) ─────────────────

  private async startMainApp(): Promise<void> {
    this.logger.log("🚀 Launching main-app (AppModule)…");    // Setup is complete → the DB exists → write the LIVE Traefik config now
    // (the core module owns config; the supervisor only ensures the process).
    try {
      await this.ingressConfig.writePlatformConfigs();
    } catch (error: unknown) {
      this.logger.warn(`Ingress config write skipped: ${error instanceof Error ? error.message : String(error)}`);
    }    const { registration } = await runSubApp(
      {
        id: "main-app", module: AppModule, port: 3012,
        initBeforeExtract: true,
        afterInit: async (subApp, subAppServer) => {
          try {
            subApp.useGlobalFilters(
              subApp.get(APIErrorExceptionFilter),
              subApp.get(InternalErrorExceptionFilter),
            );
          } catch (e: unknown) {
            this.logger.warn(`Filters: ${e instanceof Error ? e.message : String(e)}`);
          }
          subAppServer.get("/openapi.json", async (_req, res) => {
            try {
              const { generateSpec } = await import("../../openapi");
              const spec = await generateSpec();
              res.setHeader("Content-Type", "application/json");
              res.status(200).send(JSON.stringify(spec));
            } catch (err) {
              res.status(500).send({ error: err instanceof Error ? err.message : "Failed" });
            }
          });
          const { apiReference } = await import("@scalar/nestjs-api-reference");
          subAppServer.use("/reference", apiReference({ url: "/openapi.json" }));
        },
      },
      this.registry,
    );
    this.logger.log(`✅ main-app launched — ${registration.routes.length} routes`);
    this.registry.setFallback({ targetUrl: "http://127.0.0.1:3012/", subAppId: "main-app" });
    this.logger.log("🔄 Fallback → main-app");

    // NOTE: supervisor re-convergence after setup happens automatically — the
    // main sub-app boots its own (shared) SupervisorOrchestratorService whose
    // onApplicationBootstrap re-converges every registered supervisor once the
    // global DB exists (managed web spawns, global-db takes over Postgres,
    // ingress settles). Keep convergence in the framework, not here.
  }
}
