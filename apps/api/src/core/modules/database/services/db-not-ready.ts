import { isTransientDatabaseError } from "@repo/nest-events";

/**
 * Database-not-ready handling for the PLATFORM BOOT SEQUENCE.
 *
 * MOVED HERE from `@repo/nest-events`. The generic "is this a transient storage
 * error" rule stayed in the package (`isTransientDatabaseError`); what lives
 * HERE is the platform's own concern: our boot writes the schema through
 * migrations that run inside the orchestrator/setup pipeline, so mesh and swarm
 * services can query the global DB before it exists. That is business logic —
 * it describes OUR sequence — so it belongs in the app, not in a shared package.
 *
 * This delegates the classification itself; it does not re-implement the
 * SQLSTATE list.
 */
export function isDatabaseNotReadyError(error: unknown): boolean {
    return isTransientDatabaseError(error);
}

/**
 * Once-then-debug reporter for the KNOWN db-not-ready window: the first
 * occurrence produces ONE readable WARN, repeats downgrade to debug so boot
 * logs stay clean while the DB/schema comes up. Real (non-db-not-ready)
 * errors always warn.
 */
export class DatabaseNotReadyReporter {
    private warned = false;

    report(
        logger: { warn: (message: string) => void; debug: (message: string) => void },
        label: string,
        message: string,
        error?: unknown,
    ): void {
        if (error !== undefined && !isDatabaseNotReadyError(error)) {
            logger.warn(`${label}: ${message}`);
            return;
        }
        if (this.warned) {
            logger.debug(`${label} (db not ready): ${message}`);
            return;
        }
        this.warned = true;
        logger.warn(`${label} (db not ready yet — retrying as it comes up): ${message}`);
    }
}
