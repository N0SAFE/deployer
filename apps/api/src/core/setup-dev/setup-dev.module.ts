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
 *   2. If SETUP_AUTO=true and SETUP_DATABASE_URL → persist to node_config
 *   3. If SETUP_AUTO=true → persist node_config with empty databaseUrl
 *      (local-only mode, no Postgres needed)
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

@Module({
  imports: [LocalDatabaseModule],
  providers: [
    NodeConfigRepository,
    SetupDevService,
  ],
})
export class SetupDevModule {}
