/**
 * DevBootstrapInjector — Dev-only DB URL injector that runs BEFORE the main pipeline.
 *
 * This service runs inside a lightweight standalone NestJS application context
 * BEFORE the gateway is created. Its single job is to ensure the database URL
 * is persisted to the local SQLite node_config so that all downstream
 * GlobalDatabaseModule factories (which read from node_config) get a real
 * connection instead of null.
 *
 * CRITICAL: This service ONLY runs in dev mode (NODE_ENV !== 'production').
 * In production, the database URL must come from mesh discovery or CLI setup-db.
 * The main app NEVER reads SETUP_AUTO_DATABASE_URL / SETUP_AUTO from the
 * environment.
 *
 * The global Postgres database is MANDATORY even in dev: there is no
 * "local-only" fallback. With SETUP_AUTO=true, either an explicit URL is
 * probed (fails hard when unreachable) or the setup wizard auto-provisions
 * a dedicated Postgres container.
 *
 * After this service completes, the NestJS context is destroyed and the gateway
 * starts fresh, reading from SQLite node_config exclusively.
 */

import { Injectable, Logger } from "@nestjs/common";
import type { OnApplicationBootstrap } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { NodeConfigRepository } from "../modules/setup/repositories/node-config.repository";
import { DEPLOYER_VERSION } from "../utils/deployer-version";
import { EnvService } from "@/config/env/env.service";
import { resolveManagedGlobalDbUrl, splitManagedEnv } from "@repo/env";

/** Single-attempt probe timeout — fails fast, no backoff. */
const PROBE_TIMEOUT_MS = 5_000;

@Injectable()
export class SetupDevService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SetupDevService.name);

  constructor(
    private readonly nodeConfigRepository: NodeConfigRepository,
    private readonly env: EnvService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // ── GUARD: Only run in dev mode ──────────────────────────────────────
    if (process.env.NODE_ENV === 'production') {
      this.logger.log('⏭ Production mode — skipping dev bootstrap injector');
      return;
    }

    this.logger.log("🔧 Dev bootstrap: injecting config from environment if needed…");

    // Current state of the local node_config — reused by every branch below.
    const config = this.nodeConfigRepository.find();

    // ── CASE 0: COMPOSE-MANAGED global DB (dev stack) ────────────────────
    // When MANAGED_GLOBAL_DB_ENABLED=true, Docker Compose owns the
    // Postgres service. The API does NOT supervise it — the URL is resolved
    // from managed.globalDb.* (MANAGED_GLOBAL_DB_*) and persisted as
    // "external" (GlobalDbSupervisorService skips externally-managed DBs).
    const managed = splitManagedEnv(this.env).globalDb;
    if (managed.enabled === true) {
      const url = this.resolveComposeManagedDbUrl();
      this.logger.log("🐘 Compose-managed global DB (MANAGED_GLOBAL_DB_ENABLED=true) — persisting resolved URL");
      const reachable = await this.probe(url);
      if (!reachable) {
        this.logger.error(
          `Compose-managed database URL is unreachable — is the global-db service up? (${url.replace(/:[^:@]+@/, ":***@")})`,
        );
      }
      this.nodeConfigRepository.upsert({
        nodeId: config?.nodeId ?? randomUUID(),
        strategy: (config?.strategy as "local" | "remote") ?? "local",
        setupState: "setup_done",
        deployerVersion: DEPLOYER_VERSION,
        databaseUrl: url,
        // Compose-managed → externally managed from the API's perspective —
        // never supervised, never spawned by the API.
        databaseProvisioning: "external" as const,
        configuredAt: config?.configuredAt ?? new Date().toISOString(),
        meshUrlsSnapshot: config?.meshUrlsSnapshot ?? [],
        updatedAt: new Date().toISOString(),
      });
      this.logger.log("✅ Dev bootstrap complete (compose-managed DB) — URL persisted to SQLite");
      return;
    }

    // ── CASE 1: URL already persisted in SQLite node_config ──────────────
    if (config?.databaseUrl?.trim()) {
      this.logger.log(
        "♻️ Database URL already in node_config — dev bootstrap skipped",
      );
      return;
    }

    // ── CASE 2: SETUP_AUTO=true with explicit URL → probe, then persist ──
    // The URL is authoritative: if the database is NOT reachable the app
    // FAILS immediately (single probe, no backoff). We never fall back to
    // "local-only" — the global DB is mandatory even in dev.
    if (process.env.SETUP_AUTO === "true") {
      const url = (
        process.env.SETUP_AUTO_DATABASE_URL ??
        process.env.SETUP_DATABASE_URL ??
        ""
      ).trim();

      if (url.length > 0) {
        this.logger.log("📡 SETUP_AUTO=true — probing requested database URL…");
        const reachable = await this.probe(url);
        if (!reachable) {
          const message =
            `SETUP_AUTO requested database URL but it is unreachable — ` +
            `refusing to start without a global database. ` +
            `Check SETUP_AUTO_DATABASE_URL / SETUP_DATABASE_URL.`;
          this.logger.error(message);
          throw new Error(message);
        }
        this.logger.log(
          "✅ Database URL reachable — persisting to node_config",
        );
        this.nodeConfigRepository.upsert({
          nodeId: config?.nodeId ?? randomUUID(),
          strategy: (config?.strategy as "local" | "remote") ?? "local",
          setupState: "setup_done",
          deployerVersion: DEPLOYER_VERSION,
          databaseUrl: url,
          // Operator-supplied URL — externally managed, NOT supervised by the
          // API (GlobalDbSupervisorService ignores external databases).
          databaseProvisioning: "external" as const,
          configuredAt: config?.configuredAt ?? new Date().toISOString(),
          meshUrlsSnapshot: config?.meshUrlsSnapshot ?? [],
          updatedAt: new Date().toISOString(),
        });
        this.logger.log("✅ Dev bootstrap complete — URL persisted to SQLite");
        return;
      }
    }

    // ── CASE 3: SETUP_AUTO=true but NO URL → wizard auto-provisions ──────
    // We deliberately persist NOTHING here (no "local-only" config). The
    // setup-wizard's SETUP_AUTO branch runs LocalInitializationService which
    // creates the Postgres container, runs migrations and seeds the admin —
    // the complete mandated boot path for a fresh node.
    if (process.env.SETUP_AUTO === "true") {
      this.logger.log(
        "📝 SETUP_AUTO=true without a database URL — " +
        "leaving config empty so the setup wizard auto-provisions Postgres",
      );
      return;
    }

    // ── Fallback: no database available ────────────────────────────────
    this.logger.log(
      "ℹ️  No database URL configured and SETUP_AUTO not enabled. " +
        "The main pipeline will find no URL in SQLite and enter setup wizard.",
    );
  }

  /**
   * Build the connection URL for the compose-managed global Postgres.
   * An explicit `MANAGED_GLOBAL_DB_URL` wins; otherwise the parts
   * (HOST/PORT/USER/PASSWORD/NAME) are assembled with sensible defaults.
   */
  private resolveComposeManagedDbUrl(): string {
    return resolveManagedGlobalDbUrl(splitManagedEnv(this.env).globalDb);
  }

  /** Single-attempt connectivity probe. No retry, no backoff. */
  private async probe(databaseUrl: string): Promise<boolean> {
    const pool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      connectionTimeoutMillis: PROBE_TIMEOUT_MS,
    });
    try {
      await pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    } finally {
      await pool.end().catch(() => undefined);
    }
  }
}
