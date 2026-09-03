/**
 * Setup Database CLI Command
 *
 * Saves the Postgres database URL to the local SQLite node config.
 * Used in dev mode when Docker Compose provides Postgres — the user
 * runs this once to persist the URL so the app can read it on startup
 * without needing an env var.
 *
 * Usage:
 *   bun --bun src/cli.ts setup-db                # reads from SETUP_DATABASE_URL env
 *   bun --bun src/cli.ts setup-db --url="postgres://..."  # explicit URL
 *
 * Exit codes:
 *   0  URL saved successfully
 *   1  No URL provided and SETUP_DATABASE_URL not set
 */

import { Command, CommandRunner, Option } from "nest-commander";
import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { NodeConfigRepository } from "@/core/modules/setup/repositories/node-config.repository";
import type { SetupState } from "@/config/drizzle/local/schema/node-config";

interface SetupDbOptions {
  url?: string;
}

@Command({
  name: "setup-db",
  description: "Save the Postgres database URL to local node config",
})
@Injectable()
export class SetupDbCommand extends CommandRunner {
  private readonly logger = new Logger(SetupDbCommand.name);

  constructor(
    private readonly nodeConfigRepository: NodeConfigRepository,
  ) {
    super();
  }

  @Option({
    flags: "-u, --url <url>",
    description: "Postgres connection URL (e.g. postgres://user:pass@host:5432/db)",
  })
  parseUrl(val: string): string {
    return val;
  }

  async run(_passedParams: string[], options?: SetupDbOptions): Promise<void> {
    // 1. Resolve the URL: CLI arg → SETUP_DATABASE_URL env var
    const databaseUrl = options?.url ?? process.env.SETUP_DATABASE_URL;
    if (!databaseUrl) {
      this.logger.error(
        "❌ No database URL provided.\n" +
        "  Provide one via --url flag or SETUP_DATABASE_URL environment variable.\n" +
        "  Example: bun --bun src/cli.ts setup-db --url=\"postgres://user:pass@localhost:5432/deployer\"",
      );
      process.exit(1);
    }

    // 2. Read existing config (if any) to preserve fields
    const existing = this.nodeConfigRepository.find();

    // 3. Upsert with the new database URL
    const updated = this.nodeConfigRepository.upsert({
      nodeId: existing?.nodeId ?? randomUUID(),
      strategy: existing?.strategy ?? "local",
      setupState: (existing?.setupState ?? "not_started") as SetupState,
      databaseUrl,
      // CLI-supplied URL — externally managed, NOT supervised by the API.
      databaseProvisioning: "external" as const,
      deployerVersion: existing?.deployerVersion ?? null,
      upgradedAtVersion: existing?.upgradedAtVersion ?? null,
      meshUrlsSnapshot: existing?.meshUrlsSnapshot ?? [],
      configuredAt: existing?.configuredAt ?? null,
      peerServiceToken: existing?.peerServiceToken ?? null,
      peerServiceTokenExpiresAt: existing?.peerServiceTokenExpiresAt ?? null,
      meshSharedSecret: existing?.meshSharedSecret ?? null,
      meshSharedSecretUpdatedAt: existing?.meshSharedSecretUpdatedAt ?? null,
      updatedAt: new Date().toISOString(),
    });

    this.logger.log(`✅ Database URL saved to local node config (nodeId: ${updated.nodeId})`);
  }
}
