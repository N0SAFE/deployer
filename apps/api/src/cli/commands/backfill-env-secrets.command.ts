import { Command, CommandRunner } from 'nest-commander'
import { Injectable, Logger } from '@nestjs/common'
import { eq, sql } from 'drizzle-orm'
import * as globalSchema from '@deployer/nest-schema/global'
import { GlobalDatabaseService } from '@/core/modules/database/global/global-database.service';

/*
 * ─── Backfill: encrypt environment_variables.value ───────────────────────────
 *
 * WHY THIS EXISTS
 *
 * `environmentVariables.value` was `text("value").notNull()` — plaintext — while
 * every other credential column in the schema used `encryptedText`. It is now
 * `encryptedText("value")`, which encrypts on write and decrypts on read.
 *
 * The driver type did not change (both are `text`), so there is no DDL diff and
 * `db:generate` emits nothing. That is the trap: rows written BEFORE the change
 * are still plaintext, and `decryptSecret()` throws "Invalid encrypted data
 * format" on them because it cannot find the four `:`-separated segments.
 *
 * The database cannot do this conversion itself: the ciphertext is
 * `salt:iv:authTag:data` with a per-row scrypt-derived key, and the master key is
 * application-held. So the backfill must run through the Drizzle column, which
 * is what applies `encryptSecret` on write.
 *
 * ─── WHY RE-WRITING THE SAME VALUE IS ENOUGH ────────────────────────────────
 *
 * `toDriver` on `encryptedText` encrypts whatever is written. Inserting the
 * CURRENT value back therefore encrypts it, with no plaintext ever leaving the
 * process. Already-encrypted rows are skipped by the shape check, so the command
 * is idempotent and safe to re-run.
 *
 * ─── EXIT CODES ─────────────────────────────────────────────────────────────
 *
 *  0  Nothing to do, or every plaintext row migrated
 *  1  Some rows failed — details logged, non-zero so CI refuses to call it done
 */

/** Stored ciphertext shape: exactly four `:`-separated segments. */
function looksEncrypted(value: string): boolean {
    return value.split(':').length === 4
}

@Injectable()
@Command({
    name: 'backfill-env-secrets',
    description: 'Encrypt existing plaintext environment_variables.value rows at rest',
})
export class BackfillEnvSecretsCommand extends CommandRunner {
    private readonly logger = new Logger(BackfillEnvSecretsCommand.name)

    constructor(private readonly globalDatabaseService: GlobalDatabaseService) {
        super()
    }

    async run(): Promise<void> {
        const db = this.globalDatabaseService.db

        // Read ids + values only. Reading through the column would already attempt
        // decryption, which throws on exactly the rows this command must find, so
        // the raw driver value is selected explicitly.
        const rows = await db
            .select({
                id: globalSchema.environmentVariables.id,
                rawValue: sql<string>`${globalSchema.environmentVariables.value}`.as('raw_value'),
            })
            .from(globalSchema.environmentVariables)

        const plaintext = rows.filter((row) => row.rawValue !== '' && !looksEncrypted(row.rawValue))

        if (plaintext.length === 0) {
            this.logger.log(`✅ No plaintext environment variables. Checked ${rows.length} row(s).`)
            return
        }

        this.logger.warn(
            `⚠  ${plaintext.length} of ${rows.length} environment variable row(s) hold plaintext. Encrypting...`,
        )

        let migrated = 0
        for (const row of plaintext) {
            try {
                // Assigning the current value re-runs `toDriver`, which encrypts.
                await db
                    .update(globalSchema.environmentVariables)
                    .set({ value: row.rawValue })
                    .where(eq(globalSchema.environmentVariables.id, row.id))
                migrated += 1
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                // The row id is safe to log; the value never is.
                this.logger.error(`❌ Failed to encrypt environment variable ${row.id}: ${message}`)
            }
        }

        if (migrated !== plaintext.length) {
            this.logger.error(
                `❌ Encrypted ${migrated}/${plaintext.length}. Re-run after fixing the errors above.`,
            )
            process.exit(1)
        }

        this.logger.log(`✅ Encrypted ${migrated} environment variable value(s).`)
    }
}
