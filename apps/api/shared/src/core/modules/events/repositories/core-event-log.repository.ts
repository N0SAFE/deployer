import { and, desc, eq } from 'drizzle-orm'
import { Context, Effect } from 'effect'

import { coreEventLogs } from '@deployer/nest-schema/global/platform/events'

import {
    storage,
    type DatabasePort,
    type StorageFailure,
} from '../../database/storage'

export type CoreEventLogPersistInput = {
    namespace: string
    eventName: string
    eventKey: string
    sequence: number
    input: Record<string, unknown>
    output: Record<string, unknown>
    emittedAt: Date
}

export type CoreEventLogRecord = {
    namespace: string
    eventName: string
    eventKey: string
    sequence: number
    input: Record<string, unknown>
    output: Record<string, unknown>
    emittedAt: Date
}

/**
 * Strip NUL characters, which PostgreSQL CANNOT STORE, from a value of any shape.
 *
 * ── THE FAILURE THIS PREVENTS (observed, not theoretical) ───────────────────
 * `jsonb` and `text` reject U+0000 outright:
 *
 *   ERROR:  unsupported Unicode escape sequence
 *   DETAIL:  \u0000 cannot be converted to text.
 *   CONTEXT:  JSON data, line 1: ...stepId":"provis
 *
 * A single NUL anywhere in ONE row's payload therefore fails the ENTIRE
 * `insertMany` batch, and `BaseEventService` keeps the batch queued and retries
 * it forever — so the audit log stayed unwritable while the queue grew
 * ("Event log persistence still unavailable (86 queued)") and every subsequent
 * insert was blocked behind the same poisoned row.
 *
 * The NUL arrives from upstream: command output and container logs are captured
 * as raw bytes and decoded to strings, and a NUL is a normal thing to find in
 * that stream. The audit log is not the right place to fail over it — dropping
 * the byte keeps the event, where rejecting the batch loses every event in it.
 *
 * Rebuilt structurally rather than via `JSON.parse(JSON.stringify(...))`: that
 * round-trip is both slower and lossy for non-JSON values (`Date` becomes a
 * string, `undefined` fields vanish, huge numbers lose precision), and event
 * payloads legitimately contain Dates.
 */
export function sanitizeForPostgres<T>(value: T): T {
    if (typeof value === 'string') {
        // eslint-disable-next-line no-control-regex -- matching U+0000 is the point
        return (
            value.includes('\u0000') ? value.replace(/\u0000/g, '') : value
        ) as T
    }
    if (Array.isArray(value)) {
        return value.map((entry) => sanitizeForPostgres(entry)) as T
    }
    // Plain objects only: a Date / Buffer / class instance must pass through
    // untouched, or the driver loses its type.
    if (
        value !== null &&
        typeof value === 'object' &&
        Object.getPrototypeOf(value) === Object.prototype
    ) {
        const out: Record<string, unknown> = {}
        for (const [key, entry] of Object.entries(value)) {
            // The KEY is a string too, and a NUL in a key breaks the same way.
            out[sanitizeForPostgres(key)] = sanitizeForPostgres(entry)
        }
        return out as T
    }
    return value
}

export type CoreEventLogRepositoryShape = {
    readonly insertMany: (
        logs: CoreEventLogPersistInput[]
    ) => Effect.Effect<void, StorageFailure>
    /** The most recent events of one key, oldest first. */
    readonly findRecentByEventKey: (input: {
        namespace: string
        eventName: string
        eventKey: string
        limit: number
    }) => Effect.Effect<CoreEventLogRecord[], StorageFailure>
    /** The most recent events of one name, oldest first. */
    readonly findRecentByEventName: (input: {
        namespace: string
        eventName: string
        limit: number
    }) => Effect.Effect<CoreEventLogRecord[], StorageFailure>
}

const toRecord = (
    row: typeof coreEventLogs.$inferSelect
): CoreEventLogRecord => ({
    namespace: row.namespace,
    eventName: row.eventName,
    eventKey: row.eventKey,
    sequence: row.sequence,
    input: row.input,
    output: row.output,
    emittedAt: row.emittedAt,
})

export function makeCoreEventLogRepository(
    database: Context.Service.Shape<typeof DatabasePort>
): CoreEventLogRepositoryShape {
    return {
        insertMany: (logs) =>
            logs.length === 0
                ? Effect.void
                : storage(database, (db) =>
                      db.insert(coreEventLogs).values(
                          logs.map((log) => ({
                              namespace: sanitizeForPostgres(log.namespace),
                              eventName: sanitizeForPostgres(log.eventName),
                              eventKey: sanitizeForPostgres(log.eventKey),
                              sequence: log.sequence,
                              input: sanitizeForPostgres(log.input),
                              output: sanitizeForPostgres(log.output),
                              emittedAt: log.emittedAt,
                              createdAt: new Date(),
                          }))
                      )
                  ).pipe(Effect.asVoid),

        findRecentByEventKey: (input) =>
            storage(database, (db) =>
                db
                    .select()
                    .from(coreEventLogs)
                    .where(
                        and(
                            eq(coreEventLogs.namespace, input.namespace),
                            eq(coreEventLogs.eventName, input.eventName),
                            eq(coreEventLogs.eventKey, input.eventKey)
                        )
                    )
                    .orderBy(
                        desc(coreEventLogs.emittedAt),
                        desc(coreEventLogs.sequence)
                    )
                    .limit(input.limit)
            ).pipe(Effect.map((rows) => rows.map(toRecord).reverse())),

        findRecentByEventName: (input) =>
            storage(database, (db) =>
                db
                    .select()
                    .from(coreEventLogs)
                    .where(
                        and(
                            eq(coreEventLogs.namespace, input.namespace),
                            eq(coreEventLogs.eventName, input.eventName)
                        )
                    )
                    .orderBy(
                        desc(coreEventLogs.emittedAt),
                        desc(coreEventLogs.sequence)
                    )
                    .limit(input.limit)
            ).pipe(Effect.map((rows) => rows.map(toRecord).reverse())),
    }
}

export class CoreEventLogRepository extends Context.Service<
    CoreEventLogRepository,
    CoreEventLogRepositoryShape
>()('shared/CoreEventLogRepository') {}
