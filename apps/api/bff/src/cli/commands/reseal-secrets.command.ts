import { Inject, Injectable, Logger } from "@nestjs/common";
import { Command, CommandRunner, Option } from "nest-commander";
import type { Pool } from "pg";
import { GLOBAL_DATABASE_POOL } from "@deployer/nest-database-core/database-connection";
import * as globalSchema from "@deployer/nest-schema/global";
import {
  findEncryptedColumns,
  makePgResealStore,
  resealEncryptedColumns,
  type ColumnReport,
} from "@deployer/nest-schema/codecs/reseal";
import { registerSchemaCodecs } from "@/config/drizzle/schema-codecs";

/*
 * ─── Exit codes ──────────────────────────────────────────────────────────────
 *
 *  0  Done. With --apply, every row that could be upgraded was; without it, a dry-run report.
 *  1  Some rows could not be decrypted (wrong key / tampered), or the run itself failed.
 *  2  Rows remain that are neither sealed nor legacy ciphertext (plaintext): re-run with
 *     --seal-plaintext after checking them.
 */

type ResealOptions = {
  apply?: boolean;
  sealPlaintext?: boolean;
  batchSize?: number;
};

/**
 * Re-encrypt every legacy secret under the current root secret (SEC-016).
 *
 * Dry-run by default: it prints what WOULD change and writes nothing. It never prints a
 * value, only table, column and primary key. Idempotent; safe to re-run or interrupt.
 *
 *   bun --bun src/cli.ts reseal-secrets             # report
 *   bun --bun src/cli.ts reseal-secrets --apply     # rewrite
 *
 * The run is finished when `remaining` is 0 in every column: from then on the legacy read
 * path (and AUTH_SECRET as a key) can be removed. Credentials that were stored under an
 * empty key (an AUTH_SECRET that is not hex) were effectively unprotected until now, so
 * rotate them at their provider after this runs (docs/runbooks/secrets-encryption.md).
 */
@Injectable()
@Command({
  name: "reseal-secrets",
  description: "Re-encrypt legacy ciphertext in every encrypted column (dry-run unless --apply)",
})
export class ResealSecretsCommand extends CommandRunner {
  private readonly logger = new Logger(ResealSecretsCommand.name);

  constructor(@Inject(GLOBAL_DATABASE_POOL) private readonly pool: Pool) {
    super();
  }

  @Option({ flags: "--apply", description: "Write the changes (default: dry-run, nothing is written)" })
  parseApply(): boolean {
    return true;
  }

  @Option({
    flags: "--seal-plaintext",
    description: "Also seal values that are neither sealed nor legacy ciphertext (for example env vars stored before encryption)",
  })
  parseSealPlaintext(): boolean {
    return true;
  }

  @Option({ flags: "--batch-size <n>", description: "Rows per batch (default 200)" })
  parseBatchSize(value: string): number {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 5000) throw new Error("--batch-size must be an integer between 1 and 5000");
    return n;
  }

  async run(_passedParams: string[], options?: ResealOptions): Promise<void> {
    const dryRun = options?.apply !== true;
    try {
      // The CLI is its own Nest context: the codecs the services configure at boot are not set here.
      registerSchemaCodecs();

      const { targets, skipped } = findEncryptedColumns(globalSchema);
      for (const s of skipped) this.logger.warn(`Skipping ${s.table}.${s.column}: ${s.reason}`);
      this.logger.log(`${dryRun ? "DRY RUN" : "APPLY"}: ${String(targets.length)} encrypted column(s) found`);

      const report = await resealEncryptedColumns(makePgResealStore(this.pool), targets, {
        dryRun,
        ...(options?.sealPlaintext === true ? { sealPlaintext: true } : {}),
        ...(options?.batchSize === undefined ? {} : { batchSize: options.batchSize }),
      });

      for (const column of report.columns) this.logger.log(this.line(column, dryRun));
      this.logger.log(
        report.totalRemaining === 0
          ? "✅ No legacy ciphertext remains. The legacy read path is no longer needed."
          : `${dryRun ? "ℹ️ " : "⚠️ "} ${String(report.totalRemaining)} value(s) are not sealed yet.`,
      );

      if (report.columns.some((c) => c.failed.length > 0)) process.exitCode = 1;
      else if (report.columns.some((c) => c.unrecognised.length > 0)) process.exitCode = 2;
    } catch (error) {
      this.logger.error(`reseal-secrets failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }

  private line(c: ColumnReport, dryRun: boolean): string {
    const parts = [
      `${c.table}.${c.column}:`,
      `scanned=${String(c.scanned)}`,
      `${dryRun ? "would-reseal" : "resealed"}=${String(dryRun ? c.scanned - c.failed.length - c.unrecognised.length : c.resealed)}`,
      `remaining=${String(c.remaining)}`,
    ];
    if (c.conflicts > 0) parts.push(`conflicts=${String(c.conflicts)} (re-run to pick them up)`);
    if (c.failed.length > 0) parts.push(`UNDECRYPTABLE ids=[${c.failed.slice(0, 10).join(",")}${c.failed.length > 10 ? ",…" : ""}]`);
    if (c.unrecognised.length > 0) {
      parts.push(`plaintext-or-foreign ids=[${c.unrecognised.slice(0, 10).join(",")}${c.unrecognised.length > 10 ? ",…" : ""}]`);
    }
    return parts.join(" ");
  }
}
