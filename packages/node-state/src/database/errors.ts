import { domainError } from '@deployer/effect-core'

/** The local SQLite database could not be opened, migrated or queried. */
export class LocalDatabaseError extends domainError(
    'LocalDatabaseError',
    'dependency_missing'
)<{
    readonly operation: string
    readonly reason: string
}>() {
    override publicMessage() {
        return `Local database ${this.operation} failed`
    }
}

/**
 * The local database has no table by that name yet, which a fresh install reports until it is migrated.
 *
 * The chain is walked because drizzle wraps a driver failure in `DrizzleQueryError` whose `message`
 * is the SQL it tried to run — the engine's own words ("no such table: …") live in `cause`.
 */
export const isMissingTable = (error: unknown, table: string): boolean => {
    const needle = `no such table: ${table}`
    let current: unknown = error
    for (let depth = 0; current !== undefined && depth < 5; depth += 1) {
        const message =
            current instanceof Error ? current.message : String(current)
        if (message.includes(needle)) return true
        current =
            current instanceof Error
                ? (current as Error & { cause?: unknown }).cause
                : undefined
    }
    return false
}

/** A write the database accepted could not be read back, which means another writer changed the row. */
export class NodeStateConflict extends domainError(
    'NodeStateConflict',
    'conflict'
)<{
    readonly reason: string
}>() {
    override publicMessage() {
        return this.reason
    }
}
