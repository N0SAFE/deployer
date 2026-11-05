import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator'

import { AppError } from '@deployer/errors'
import { isRecord } from '@deployer/type-guards'

import type { GlobalDatabase } from '../global/global-database.service'

/**
 * What a migration run did.
 *
 * ── WHY THIS IS A VALUE AND NOT A LOG LINE ──────────────────────────────────
 * The boot path used to classify a migration error by SUBSTRING ("already",
 * "duplicate") on the error message and then swallow everything it did not
 * recognise as "non-fatal". Two failures came out of that:
 *
 *   - a genuinely failed migration (a missing column, a broken SQL statement)
 *     booted the platform against a schema nobody had verified;
 *   - the classification was text, so a driver message changing its wording
 *     silently flipped a fatal error to a warning.
 *
 * The outcome is now a returned value with two cases, and a real failure is a
 * typed error. `already-applied` is decided by Postgres SQLSTATE, which is part
 * of the protocol and does not move with the message.
 */
export type GlobalMigrationOutcome = 'applied' | 'already-applied'

/**
 * Postgres SQLSTATEs that mean "this migration's DDL is already in place".
 *
 * A migration journal (`__drizzle_migrations`) recorded a file as applied on a
 * previous boot, but the DDL ran outside it (a manual `db:push`, a restored
 * volume): re-running the file then fails on the duplicate object rather than
 * on anything the operator needs to fix. Any OTHER SQLSTATE is a real failure.
 */
const ALREADY_APPLIED_SQLSTATES: ReadonlySet<string> = new Set([
    '42P07', // duplicate_table
    '42701', // duplicate_column
    '42710', // duplicate_object (index, constraint, trigger, enum value…)
    '42723', // duplicate_function
    '42P06', // duplicate_schema
    '42P04', // duplicate_database
])

/** A migration that failed for a reason the schema is NOT already in place for. */
export class MigrationFailedError extends AppError {
    constructor(
        readonly sqlState: string | null,
        cause: unknown
    ) {
        const message = cause instanceof Error ? cause.message : String(cause)
        super(
            `Global migrations failed${sqlState === null ? '' : ` (SQLSTATE ${sqlState})`}: ${message}`,
            'INTERNAL_ERROR',
            { sqlState, cause: message }
        )
        this.name = 'MigrationFailedError'
    }
}

/** The SQLSTATE of a driver error, when the object carries one. */
function sqlStateOf(error: unknown): string | null {
    if (!isRecord(error)) return null
    return typeof error.code === 'string' ? error.code : null
}

/**
 * Apply pending global migrations.
 *
 * Throws {@link MigrationFailedError} on a real failure — the boot path is
 * expected to let it out so the process exits non-zero. `migrate` is injectable
 * only so a spec can drive both outcomes without a database.
 */
export async function applyGlobalMigrations(
    db: GlobalDatabase,
    options: { migrationsFolder: string; migrate?: typeof migratePg }
): Promise<GlobalMigrationOutcome> {
    const migrate = options.migrate ?? migratePg

    try {
        await migrate(db, { migrationsFolder: options.migrationsFolder })
        return 'applied'
    } catch (error: unknown) {
        const sqlState = sqlStateOf(error)
        if (sqlState !== null && ALREADY_APPLIED_SQLSTATES.has(sqlState)) {
            return 'already-applied'
        }
        throw new MigrationFailedError(sqlState, error)
    }
}
