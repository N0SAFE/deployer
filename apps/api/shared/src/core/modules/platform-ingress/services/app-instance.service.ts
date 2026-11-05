/**
 * AppInstanceService — identity layer for deployer web app installations.
 *
 * Tokens are opaque (32 random bytes, base64url). Only the SHA-256 hash is stored. The raw token is returned exactly once at
 * registration/provisioning. Heartbeats keep instances "active"; stale/revoked instances fail gateway verification immediately.
 */

import { randomBytes, createHash } from 'node:crypto'

import { and, eq, lt } from 'drizzle-orm'
import { Context, Effect } from 'effect'

import {
    appInstances,
    type AppInstanceEntity,
} from '@deployer/nest-schema/global/platform/app-instance'

import {
    storage,
    StorageFailure,
    type DatabasePort,
} from '../../database/storage'

/** Instances without a heartbeat for this long become stale. */
export const STALE_AFTER_MS = 30 * 60 * 1000
/** Stale instances older than this are auto-revoked by the sweeper. */
const AUTO_REVOKE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

export type MintedToken = {
    instanceId: string
    /** Raw token — handed to the caller once, never persisted in clear. */
    appToken: string
}

export type AppInstanceServiceShape = {
    /** Create an instance and mint its one-time token. */
    readonly create: (input: {
        label: string
        kind: 'managed' | 'external'
        createdByUserId?: string | null
    }) => Effect.Effect<MintedToken, StorageFailure>
    /** The instance for a raw token when it is active; null when unknown, revoked or stale-expired (gateway enforcement). */
    readonly verifyByToken: (
        rawToken: string
    ) => Effect.Effect<AppInstanceEntity | null, StorageFailure>
    /** Bump `lastSeenAt` and reactivate a stale instance; null when revoked or unknown. */
    readonly heartbeat: (
        rawToken: string
    ) => Effect.Effect<Date | null, StorageFailure>
    /** Every instance (admin surface); token hashes are never exposed by the callers. */
    readonly list: () => Effect.Effect<AppInstanceEntity[], StorageFailure>
    /** Revoke by id; idempotent. True when a live instance was revoked. */
    readonly revoke: (
        instanceId: string
    ) => Effect.Effect<boolean, StorageFailure>
    /** Mark silent instances stale and auto-revoke long-dead ones. Called periodically. */
    readonly sweepStale: (now?: Date) => Effect.Effect<void, StorageFailure>
    /** The managed instance (spawned by this API), if any. */
    readonly findManaged: () => Effect.Effect<
        AppInstanceEntity | null,
        StorageFailure
    >
}

const hash = (rawToken: string): string =>
    createHash('sha256').update(rawToken).digest('hex')

export function makeAppInstanceService(
    database: Context.Service.Shape<typeof DatabasePort>
): AppInstanceServiceShape {
    return {
        create: (input) =>
            Effect.gen(function* () {
                const raw = randomBytes(32).toString('base64url')
                const [row] = yield* storage(database, (db) =>
                    db
                        .insert(appInstances)
                        .values({
                            label: input.label,
                            kind: input.kind,
                            tokenHash: hash(raw),
                            status: 'active',
                            createdByUserId: input.createdByUserId ?? null,
                        })
                        .returning()
                )
                if (row === undefined)
                    return yield* new StorageFailure({
                        cause: new Error('app instance insert returned no row'),
                    })
                yield* Effect.logInfo(
                    `Created ${input.kind} app instance "${input.label}" (${row.id})`
                )
                return { instanceId: row.id, appToken: raw }
            }),

        verifyByToken: (rawToken) =>
            storage(database, (db) =>
                db
                    .select()
                    .from(appInstances)
                    .where(eq(appInstances.tokenHash, hash(rawToken)))
                    .limit(1)
            ).pipe(
                Effect.map((rows) => {
                    const row = rows[0]
                    return row?.status === 'active' ? row : null
                })
            ),

        heartbeat: (rawToken) =>
            Effect.gen(function* () {
                const tokenHash = hash(rawToken)
                const touch = (status: 'active' | 'stale') =>
                    storage(database, (db) =>
                        db
                            .update(appInstances)
                            .set({
                                lastSeenAt: new Date(),
                                status: 'active',
                                updatedAt: new Date(),
                            })
                            .where(
                                and(
                                    eq(appInstances.tokenHash, tokenHash),
                                    eq(appInstances.status, status)
                                )
                            )
                            .returning({ lastSeenAt: appInstances.lastSeenAt })
                    )
                const updated = (yield* touch('active'))[0]
                if (updated !== undefined) return updated.lastSeenAt
                // A stale-but-not-revoked heartbeat reactivates the instance.
                return (yield* touch('stale'))[0]?.lastSeenAt ?? null
            }),

        list: () => storage(database, (db) => db.select().from(appInstances)),

        revoke: (instanceId) =>
            Effect.gen(function* () {
                const updated = yield* storage(database, (db) =>
                    db
                        .update(appInstances)
                        .set({ status: 'revoked', updatedAt: new Date() })
                        .where(and(eq(appInstances.id, instanceId)))
                        .returning({
                            id: appInstances.id,
                            status: appInstances.status,
                        })
                )
                const row = updated[0]
                if (row?.status !== 'revoked') return false
                yield* Effect.logWarning(`Revoked app instance ${instanceId}`)
                return true
            }),

        sweepStale: (now = new Date()) =>
            Effect.gen(function* () {
                yield* storage(database, (db) =>
                    db
                        .update(appInstances)
                        .set({ status: 'stale', updatedAt: now })
                        .where(
                            and(
                                eq(appInstances.status, 'active'),
                                lt(
                                    appInstances.lastSeenAt,
                                    new Date(now.getTime() - STALE_AFTER_MS)
                                )
                            )
                        )
                )
                yield* storage(database, (db) =>
                    db
                        .update(appInstances)
                        .set({ status: 'revoked', updatedAt: now })
                        .where(
                            and(
                                eq(appInstances.status, 'stale'),
                                lt(
                                    appInstances.updatedAt,
                                    new Date(
                                        now.getTime() - AUTO_REVOKE_AFTER_MS
                                    )
                                )
                            )
                        )
                )
            }),

        findManaged: () =>
            storage(database, (db) =>
                db
                    .select()
                    .from(appInstances)
                    .where(
                        and(
                            eq(appInstances.kind, 'managed'),
                            eq(appInstances.status, 'active')
                        )
                    )
                    .limit(1)
            ).pipe(Effect.map((rows) => rows[0] ?? null)),
    }
}

export class AppInstanceService extends Context.Service<
    AppInstanceService,
    AppInstanceServiceShape
>()('shared/AppInstanceService') {}
