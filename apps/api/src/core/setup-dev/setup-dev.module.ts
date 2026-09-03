/**
 * SetupDevModule — Lightweight pre-bootstrap module for database URL resolution.
 *
 * This module is loaded as a standalone NestJS application context in Phase 0
 * of main.ts, BEFORE the gateway Express server or any sub-app cascade starts.
 *
 * Its single purpose is to ensure the database URL is persisted to the local
 * SQLite node_config table so that all GlobalDatabaseModule factories (which
 * read from node_config via NodeConfigRepository) produce a real connection
 * instead of null.
 *
 * Resolution happens in SetupDevService.onApplicationBootstrap():
 *   1. Read node_config from local SQLite → if URL exists, done
 *   2. If SETUP_AUTO=true and SETUP_AUTO_DATABASE_URL (or SETUP_DATABASE_URL)
 *      → probe the URL; reachable → persist; unreachable → FAIL (no backoff,
 *      the global DB is mandatory even in dev)
 *   3. If SETUP_AUTO=true without a URL → persist nothing; the setup wizard's
 *      SETUP_AUTO branch auto-provisions Postgres (container create, migrate,
 *      seed) — there is NO "local-only" (no-Postgres) boot mode
 *
 * IMPORTANT: process.env.DATABASE_URL is NEVER read or set at runtime.
 *
 * After completion, this context is destroyed and the gateway starts fresh.
 *
 * @module SetupDevModule
 */

import { Module } from "@nestjs/common";
import { LocalDatabaseModule } from "../modules/database/local/local-database.module";
import { NodeConfigRepository } from "../modules/setup/repositories/node-config.repository";
import { SetupDevService } from "./setup-dev.service";
import { EnvModule } from "@/config/env/env.module";

@Module({
  // EnvModule is @Global() in the main app, but this module is bootstrapped as
  // a STANDALONE context (Phase 0, before the gateway) — EnvService must be
  // explicitly imported here so the compose-managed DB config
  // (MANAGED_GLOBAL_DB_ENABLED / MANAGED_GLOBAL_DB_*) is
  // readable during DB URL resolution.
  imports: [LocalDatabaseModule, EnvModule],
  providers: [
    NodeConfigRepository,
    SetupDevService,
  ],
})
export class SetupDevModule {}
