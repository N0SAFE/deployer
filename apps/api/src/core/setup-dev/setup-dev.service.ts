/**
 * SetupDevService — Database URL resolver that runs as Phase 0 in main.ts.
 *
 * This service runs inside a lightweight standalone NestJS application context
 * BEFORE the gateway is created. Its single job is to ensure the database URL
 * is persisted to the local SQLite node_config so that all downstream
 * GlobalDatabaseModule factories (which read from node_config) get a real
 * connection instead of null.
 *
 * Resolution order:
 *   1. SQLite node_config already has a databaseUrl → nothing to do
 *   2. SETUP_AUTO=true and SETUP_DATABASE_URL set → persist to node_config
 *   3. SETUP_AUTO=true, no SETUP_DATABASE_URL → persist node_config with
 *      empty databaseUrl (local-only mode, no Postgres needed)
 *   4. Nothing available → log info, modules start without database
 *
 * The env var DATABASE_URL is NEVER read at runtime. It exists only for setup
 * as SETUP_DATABASE_URL, which is read ONCE by this service and persisted.
 *
 * After this service completes, the NestJS context is destroyed and the gateway
 * starts fresh, reading from SQLite node_config.
 */

import { Injectable, Logger } from "@nestjs/common";
import type { OnApplicationBootstrap } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { NodeConfigRepository } from "../modules/setup/repositories/node-config.repository";
import { DEPLOYER_VERSION } from "../utils/deployer-version";

@Injectable()
export class SetupDevService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SetupDevService.name);

  constructor(
    private readonly nodeConfigRepository: NodeConfigRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.logger.log("🔧 Resolving database URL before gateway init…");

    // ── CASE 1: URL already persisted in SQLite node_config ──────────────
    const config = this.nodeConfigRepository.find();
    if (config?.databaseUrl?.trim()) {
      this.logger.log(
        "✅ Database URL resolved from SQLite node_config " +
          "(previously provisioned database)",
      );
      return;
    }

    // ── CASE 2: SETUP_AUTO=true and SETUP_DATABASE_URL → persist ─────────
    if (
      process.env.SETUP_AUTO === "true" &&
      process.env.SETUP_DATABASE_URL?.trim()
    ) {
      const url = process.env.SETUP_DATABASE_URL.trim();
      this.logger.log(
        "📝 Persisting SETUP_DATABASE_URL from environment to SQLite node_config…",
      );
      this.nodeConfigRepository.upsert({
        nodeId: config?.nodeId ?? randomUUID(),
        strategy: (config?.strategy as "local" | "remote") ?? "local",
        setupState: "setup_done",
        deployerVersion: DEPLOYER_VERSION,
        databaseUrl: url,
        configuredAt: config?.configuredAt ?? new Date().toISOString(),
        meshUrlsSnapshot: config?.meshUrlsSnapshot ?? [],
        updatedAt: new Date().toISOString(),
      });
      this.logger.log("✅ Database URL persisted to SQLite node_config");
      return;
    }

    // ── CASE 3: SETUP_AUTO=true → local-only mode (no Postgres) ──────────
    if (process.env.SETUP_AUTO === "true") {
      this.logger.log(
        "📝 SETUP_AUTO=true without SETUP_DATABASE_URL — " +
        "marking setup as done with local SQLite only",
      );
      this.nodeConfigRepository.upsert({
        nodeId: config?.nodeId ?? randomUUID(),
        strategy: "local",
        setupState: "setup_done",
        deployerVersion: DEPLOYER_VERSION,
        databaseUrl: "",
        configuredAt: config?.configuredAt ?? new Date().toISOString(),
        meshUrlsSnapshot: config?.meshUrlsSnapshot ?? [],
        updatedAt: new Date().toISOString(),
      });
      this.logger.log(
        "✅ Local-only node_config persisted — " +
        "modules will start without a Postgres database",
      );
      return;
    }

    // ── Fallback: no database available ────────────────────────────────
    this.logger.log(
      "ℹ️  No database URL configured and SETUP_AUTO not enabled. " +
        "Modules will start without a database. " +
        "Use the setup wizard to configure manually.",
    );
  }
}
