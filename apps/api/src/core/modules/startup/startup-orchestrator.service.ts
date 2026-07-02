/**
 * Startup Orchestrator Service
 *
 * Handles all startup tasks directly in NestJS lifecycle hooks — no CLI
 * commands needed. This replaces the external entrypoint protocol for
 * production use.
 *
 * In production (single container), the NestJS app:
 *   1. Runs pending Drizzle migrations on startup
 *   2. Creates default admin user (if configured)
 *   3. Registers this node in the mesh
 *   4. Reports schema version to the global DB
 *
 * Each step is independent — failures in later steps don't block earlier
 * ones, but critical steps (migrations, mesh registration) are required
 * for the app to be healthy.
 */

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { GlobalDatabaseService } from "@/core/modules/database/global/global-database.service";
import { EnvService } from "@/config/env/env.service";
import { MigrationJournalService } from "@/core/utils/migration-journal.service";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";

// Resolve app version from package.json at build time
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const APP_VERSION: string = (() => {
  try {
    const pkgPath = join(__dirname, "..", "..", "..", "..", "..", "package.json");
    const raw = readFileSync(pkgPath, "utf-8");
    return JSON.parse(raw).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

@Injectable()
export class StartupOrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(StartupOrchestratorService.name);

  // Track what has been done — used by health check to report startup readiness
  private startupComplete = false;
  private startupErrors: string[] = [];

  constructor(
    private readonly globalDatabaseService: GlobalDatabaseService,
    private readonly envService: EnvService,
    private readonly journalService: MigrationJournalService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log(`🚀 Starting with app version ${APP_VERSION}`);

    // Step 1: Run pending Drizzle migrations (critical)
    try {
      await this.runMigrations();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`❌ Migration step failed: ${msg}`);
      this.startupErrors.push(`migrations: ${msg}`);
    }

    // Step 2: Create default admin user (if configured)
    try {
      this.registerDefaultAdmin();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`⚠️  Default admin step failed (non-critical): ${msg}`);
    }

    // Step 3: Register this node in the mesh
    try {
      await this.registerMeshNode();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`⚠️  Mesh node registration step failed: ${msg}`);
      this.startupErrors.push(`mesh-registration: ${msg}`);
    }

    // Step 4: Report schema version to global DB
    try {
      await this.reportSchemaVersion();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`⚠️  Schema version reporting failed: ${msg}`);
    }

    this.startupComplete = true;
    this.logger.log(`✅ Startup orchestration complete`);

    if (this.startupErrors.length > 0) {
      this.logger.warn(
        `⚠️  ${this.startupErrors.length} startup error(s): ${this.startupErrors.join("; ")}`,
      );
    }
  }

  // ─── Public status helpers ─────────────────────────────────────────────

  isStartupComplete(): boolean {
    return this.startupComplete;
  }

  getStartupErrors(): string[] {
    return [...this.startupErrors];
  }

  getAppVersion(): string {
    return APP_VERSION;
  }

  // ─── Step 1: Run pending Drizzle migrations ────────────────────────────

  private async runMigrations(): Promise<void> {
    this.logger.log("📦 Running database migrations...");

    // Check connectivity first
    try {
      await this.globalDatabaseService.db.execute(sql`SELECT 1`);
      this.logger.log("✅ Postgres connection verified");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot reach global Postgres: ${msg}`);
    }

    const migrationsFolder = fileURLToPath(
      new URL("../../../config/drizzle/global/migrations", import.meta.url),
    );

    try {
      await migratePg(this.globalDatabaseService.db, { migrationsFolder });
      this.logger.log("✅ Database migrations completed successfully");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      if (msg.includes("ECONNREFUSED")) {
        throw new Error(`Postgres connection lost during migration: ${msg}`);
      }
      if (msg.includes("migration")) {
        throw new Error(`Migration file error: ${msg}`);
      }
      if (msg.includes("duplicate") || msg.includes("already exists")) {
        this.logger.warn(
          `⚠️  Migration reports duplicate objects — partial previous apply? ${msg}`,
        );
        return; // Not fatal — migrations may have been applied by another node
      }
      throw error;
    }

    // Log what was applied by reading the journal
    try {
      const journal = this.journalService.load();
      this.logger.log(
        `📖 Migration journal: ${journal.entries.length} migration(s), schema version ${journal.version}`,
      );
    } catch {
      // Journal read is non-critical after successful migration
    }
  }

  // ─── Step 2: Create default admin ─────────────────────────────────────

  private registerDefaultAdmin(): void {
    const email = this.envService.get("DEFAULT_ADMIN_EMAIL")?.toString().trim();
    if (!email) {
      this.logger.log("⏭️  DEFAULT_ADMIN_EMAIL not set — skipping default admin creation");
      return;
    }

    this.logger.log(`👤 Ensuring default admin user: ${email}...`);

    // Shell out to the CLI since CliAuthService requires a full BetterAuth
    // initialization context. In the single-container setup, dist/cli.js exists.
    const cliEntrypoint = "dist/cli.js";
    if (!existsSync(cliEntrypoint)) {
      this.logger.log(`⚠️  CLI entrypoint not found at ${cliEntrypoint} — skipping admin creation`);
      return;
    }

    try {
      execSync(`bun --bun ${cliEntrypoint} create-default-admin`, {
        stdio: "inherit",
        env: process.env,
      });
      this.logger.log("✅ Default admin user ensured");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`⚠️  Failed to create default admin: ${msg}`);
    }
  }

  // ─── Step 3: Register mesh node ───────────────────────────────────────

  private async registerMeshNode(): Promise<void> {
    const nodeId = this.envService.get("MESH_NODE_ID")?.toString().trim();
    if (!nodeId) {
      this.logger.log("⏭️  MESH_NODE_ID not set — skipping mesh registration");
      return;
    }

    this.logger.log(`🌐 Registering mesh node: ${nodeId}...`);

    const serverUrlRaw =
      this.envService.get("MESH_NODE_SERVER_URL")?.toString().trim() ??
      this.envService.get("APP_URL")?.toString().trim() ??
      null;

    const serverUrl = serverUrlRaw
      ? this.toNodeServerUrl(serverUrlRaw)
      : `http://api:${this.envService.get("API_PORT")?.toString().trim() ?? "3001"}`;

    // Check if already registered
    try {
      const existing = await this.globalDatabaseService.db.execute<{ node_id: string }>(
        sql`SELECT node_id FROM cluster_nodes WHERE node_id = ${nodeId} LIMIT 1`,
      );

      if (existing.rows.length > 0) {
        this.logger.log(`✅ Mesh node already registered: ${nodeId}`);
        return;
      }
    } catch {
      this.logger.warn("⚠️  Could not check existing registration — cluster_nodes table may not exist");
      // Continue to try inserting
    }

    // Register
    try {
      await this.globalDatabaseService.db.execute(sql`
        INSERT INTO cluster_nodes (node_id, server_url, status, healthy, metadata, last_seen_at)
        VALUES (
          ${nodeId},
          ${serverUrl},
          'active',
          true,
          ${JSON.stringify({ source: "startup-orchestrator" })},
          NOW()
        )
      `);
      this.logger.log(`✅ Mesh node registered: ${nodeId} (${serverUrl})`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("duplicate key") || msg.includes("unique constraint") || msg.includes("23505")) {
        this.logger.warn(
          `⚠️  Node ${nodeId} was just registered by a concurrent process — treating as success`,
        );
        return;
      }
      throw new Error(`Mesh registration failed: ${msg}`);
    }
  }

  // ─── Step 4: Report schema version ────────────────────────────────────

  private async reportSchemaVersion(): Promise<void> {
    try {
      let appliedVersions: string[];
      try {
        const migrations = await this.globalDatabaseService.db.execute<{ version: string }>(
          sql`SELECT version FROM "__drizzle_migrations" ORDER BY version`,
        );
        appliedVersions = migrations.rows.map((r) => r.version);
      } catch {
        this.logger.log("ℹ️  No __drizzle_migrations table — no migrations applied yet");
        appliedVersions = [];
      }

      const nodeId = this.envService.get("MESH_NODE_ID")?.toString().trim() ?? "unknown";
      const latestVersion = appliedVersions.at(-1) ?? "0000";

      try {
        await this.globalDatabaseService.db.execute(sql`
          INSERT INTO schema_version (node_id, schema_version, applied_migrations, app_version, last_verification)
          VALUES (
            ${nodeId},
            ${latestVersion},
            ${JSON.stringify(appliedVersions)},
            ${APP_VERSION},
            NOW()
          )
          ON CONFLICT (node_id) DO UPDATE SET
            schema_version = EXCLUDED.schema_version,
            applied_migrations = EXCLUDED.applied_migrations,
            app_version = EXCLUDED.app_version,
            last_verification = NOW(),
            updated_at = NOW()
        `);
        this.logger.log(
          `📋 Schema version reported: ${latestVersion} (${appliedVersions.length} migration(s) applied)`,
        );
      } catch {
        this.logger.warn("⚠️  Could not report schema version — schema_version table may not exist yet");
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`⚠️  Schema version reporting failed: ${msg}`);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private toNodeServerUrl(input: string): string {
    try {
      const parsed = new URL(input);
      if (parsed.protocol === "ws:") return `http://${parsed.host}`;
      if (parsed.protocol === "wss:") return `https://${parsed.host}`;
      return parsed.origin;
    } catch {
      return input;
    }
  }
}
