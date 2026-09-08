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
 * IMPORTANT — a PROVIDED database is NOT a completed setup. When a URL comes
 * from the environment (compose-managed MANAGED_GLOBAL_DB_* or an explicit
 * SETUP_AUTO_URL) it is persisted only as a SETUP CANDIDATE: setup_state
 * stays `not_started` and configuredAt stays null, so the node still runs
 * the real setup (migrate → seed admin → register node) through
 * LocalInitializationService, which uses the candidate as its default DB.
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
import { splitManagedEnv } from "@repo/env";
import {
  describePolicy,
  provisioningPolicyFromProcessEnv,
} from "./provisioning-policy";

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

    // ── Single derived boot decision (ProvisioningPolicy) ────────────────
    const managed = splitManagedEnv(this.env).globalDb;
    const policy = provisioningPolicyFromProcessEnv(managed);
    this.logger.log(`[ProvisioningPolicy] ${describePolicy(policy)}`);

    this.logger.log("🔧 Dev bootstrap: injecting config from environment if needed…");

    // Current state of the local node_config — reused by every branch below.
    const config = this.nodeConfigRepository.find();
    const alreadyConfigured =
      Boolean(config?.configuredAt) || config?.setupState === "setup_done";

    // ── CASE 0: COMPOSE-MANAGED global DB (dev stack) ────────────────────
    // MANAGED_GLOBAL_DB_ENABLED=true → Docker Compose owns the Postgres. A
    // managed DB being PROVIDED is NOT a completed setup (schema + admin may
    // still be missing), so the URL is persisted only as a SETUP CANDIDATE —
    // setup_state stays not_started, configuredAt omitted. The real setup
    // (migrate → seed admin → register node) runs afterwards through
    // LocalInitializationService, which treats the candidate as its default
    // database instead of provisioning a second container.
    if (policy.mode === "compose_managed") {
      const url = policy.providedUrl ?? "";

      // Never downgrade a fully-configured node (idempotent restarts).
      if (alreadyConfigured) {
        this.logger.log(
          "🐘 Compose-managed global DB detected — node already configured, leaving setup state untouched",
        );
        return;
      }
      // Candidate URL already persisted by a previous boot — nothing to do
      // here; the orchestrator/wizard completes the setup against it.
      if (config?.databaseUrl?.trim()) {
        this.logger.log(
          "🐘 Compose-managed global DB detected — candidate URL already persisted (setup still pending)",
        );
        return;
      }

      const reachable = await this.probe(url);
      if (!reachable) {
        if (policy.fatalIfUnreachable) {
          // SETUP_AUTO with a provided-but-dead DB must fail fast — never
          // degrade into a half-configured node (matches explicit-URL mode).
          const message =
            `Compose-managed global DB is unreachable — refusing to start without a ` +
            `global database. Is the global-db service up? ` +
            `(${url.replace(/:[^:@]+@/, ":***@")})`;
          this.logger.error(message);
          throw new Error(message);
        }
        this.logger.error(
          `Compose-managed database URL is unreachable — is the global-db service up? (${url.replace(/:[^:@]+@/, ":***@")})`,
        );
      }
      this.nodeConfigRepository.upsert({
        nodeId: config?.nodeId ?? randomUUID(),
        strategy: (config?.strategy as "local" | "remote") ?? "local",
        // NOT setup_done — providing a DB is not provisioning it.
        setupState: "not_started",
        deployerVersion: DEPLOYER_VERSION,
        databaseUrl: url,
        // Compose-managed → externally managed from the API's perspective —
        // never supervised, never spawned by the API.
        databaseProvisioning: "external" as const,
        // configuredAt intentionally omitted → needsSetup stays true.
        meshUrlsSnapshot: config?.meshUrlsSnapshot ?? [],
        updatedAt: new Date().toISOString(),
      });
      this.logger.log(
        "✅ Compose-managed global DB URL persisted as SETUP CANDIDATE — " +
          "setup (migrations + admin) still runs against it",
      );
      return;
    }

    // ── CASE 1: URL already persisted in SQLite node_config ──────────────
    // Whether it is a completed config or a leftover candidate, Phase 0 has
    // nothing to add — the orchestrator heals or runs the wizard against it.
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
    // Same as CASE 0: the URL is persisted as a SETUP CANDIDATE only — a
    // reachable provided DB does not mean migrations/admin are done.
    if (policy.mode === "explicit_url") {
      const url = policy.providedUrl ?? "";
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
        "✅ Database URL reachable — persisting as SETUP CANDIDATE (setup still pending)",
      );
      this.nodeConfigRepository.upsert({
        nodeId: config?.nodeId ?? randomUUID(),
        strategy: (config?.strategy as "local" | "remote") ?? "local",
        // NOT setup_done — providing a DB is not provisioning it.
        setupState: "not_started",
        deployerVersion: DEPLOYER_VERSION,
        databaseUrl: url,
        // Operator-supplied URL — externally managed, NOT supervised by the
        // API (GlobalDbSupervisorService ignores external databases).
        databaseProvisioning: "external" as const,
        // configuredAt intentionally omitted → needsSetup stays true.
        meshUrlsSnapshot: config?.meshUrlsSnapshot ?? [],
        updatedAt: new Date().toISOString(),
      });
      this.logger.log("✅ Dev bootstrap complete — URL persisted as setup candidate");
      return;
    }

    // ── CASE 3: SETUP_AUTO=true but NO URL → wizard auto-provisions ──────
    // We deliberately persist NOTHING here (no "local-only" config). The
    // setup-wizard's SETUP_AUTO branch runs LocalInitializationService which
    // creates the Postgres container, runs migrations and seeds the admin —
    // the complete mandated boot path for a fresh node.
    if (policy.mode === "managed") {
      this.logger.log(
        "📝 SETUP_AUTO=true without a database URL — " +
          "leaving config empty so the setup wizard auto-provisions Postgres",
      );
      return;
    }

    // ── Fallback: no database available (manual wizard) ─────────────────
    this.logger.log(
      "ℹ️  No database URL configured and SETUP_AUTO not enabled. " +
        "The main pipeline will find no URL in SQLite and enter setup wizard.",
    );
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
