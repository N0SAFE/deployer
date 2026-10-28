/**
 * Transient-database-error classification — a FRAMEWORK PRIMITIVE.
 *
 * The event services persist and replay through a database that may legitimately
 * not be up yet (the schema is created by migrations, and the URL may not be
 * resolved on first boot). Distinguishing "the database is not there yet" from
 * "the query is wrong" is what lets them downgrade the former to debug and keep
 * the latter at warn.
 *
 * SCOPE: this is the generic, storage-level rule — SQLSTATEs and driver codes
 * that mean "not ready", nothing else. It names no platform phase, no
 * orchestrator and no setup wizard, which is what makes it safe to export from
 * a shared package. The platform's own boot SEQUENCE rules live in the app
 * (`apps/api/src/core/modules/database/services/db-not-ready.ts`).
 *
 * Drizzle wraps the driver's original error into `DrizzleQueryError`
 * (message: `Failed query: <sql>`, `.cause` = driver error), so both the
 * wrapper and the cause are inspected.
 */
export function isTransientDatabaseError(error: unknown): boolean {
    const cause = extractErrorCause(error);
    const code = cause?.code;
    // Postgres SQLSTATEs: 42P01 undefined_table, 3D000 invalid_catalog_name,
    // 3F000 invalid_schema_name, 57P03 cannot_connect_now, 08001/08006
    // connection failure. Node net codes: ECONNREFUSED/ETIMEDOUT/ENOTFOUND/
    // EAI_AGAIN (daemon/DB not up yet). SQLite errors carry no code → message.
    if (
        code === "42P01" ||
        code === "3D000" ||
        code === "3F000" ||
        code === "57P03" ||
        code === "08001" ||
        code === "08006" ||
        code === "ECONNREFUSED" ||
        code === "ETIMEDOUT" ||
        code === "ENOTFOUND" ||
        code === "EAI_AGAIN"
    ) {
        return true;
    }
    const message =
        (error instanceof Error ? error.message : String(error)) +
        " " +
        (cause?.message ?? "");
    return /relation "[^"]+" does not exist|no such table|undefined_table|connect ECONNREFUSED|connection terminated|could not connect|getaddrinfo ENOTFOUND|has not been initialized yet/.test(
        message,
    );
}

function extractErrorCause(error: unknown): { code?: string; message?: string } | null {
    if (typeof error !== "object" || error === null) return null;
    const cause = (error as { cause?: unknown }).cause;
    if (typeof cause !== "object" || cause === null) return null;
    const record = cause as { code?: unknown; message?: unknown };
    return {
        ...(typeof record.code === "string" ? { code: record.code } : {}),
        ...(typeof record.message === "string" ? { message: record.message } : {}),
    };
}
