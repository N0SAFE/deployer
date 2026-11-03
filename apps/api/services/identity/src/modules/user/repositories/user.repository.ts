import { randomUUID } from 'node:crypto'

import { and, asc, count, desc, eq } from 'drizzle-orm'
import { Context, Effect } from 'effect'

import { serviceOver } from "@deployer/effect-core"
import { account, apikey, session, user } from '@deployer/nest-schema/global/identity/auth'

import {
    DatabasePort,
    type DatabaseShape,
} from '@identity/core/database/database.port'

import { userRules } from '../domain/user.rules'
import { UserRepositoryFailure } from '../user.failures'

import { buildWhere, toUser, USER_SORT_COLUMNS } from './user.repository.sql'
import { attempt } from './user.repository.utils'

import type {
    UserFilter,
    UserListFilter,
    UserPage,
} from './user.repository.types'
import type { NewUser, SelfExportData, User, UserPatch, UserSessionRow } from '../domain/user.types'

/** The repository contract, declared BEFORE the implementation. */
export type UserRepositoryShape = {
    readonly findById: (
        id: string
    ) => Effect.Effect<User | null, UserRepositoryFailure, DatabasePort>
    readonly findByEmail: (
        email: string
    ) => Effect.Effect<User | null, UserRepositoryFailure, DatabasePort>
    readonly emailExists: (
        email: string,
        excludingId?: string
    ) => Effect.Effect<boolean, UserRepositoryFailure, DatabasePort>
    readonly list: (
        filter: UserListFilter
    ) => Effect.Effect<UserPage, UserRepositoryFailure, DatabasePort>
    readonly count: (
        filter: UserFilter
    ) => Effect.Effect<number, UserRepositoryFailure, DatabasePort>
    readonly insert: (
        input: NewUser & { email: string }
    ) => Effect.Effect<User, UserRepositoryFailure, DatabasePort>
    readonly update: (
        id: string,
        patch: UserPatch
    ) => Effect.Effect<User, UserRepositoryFailure, DatabasePort>
    /**
     * Update a row AND end the credentials the change invalidates, in ONE transaction (`SEC-054`).
     *
     * A session carries the role and a key resolves to one, so a demotion or a ban that commits while its credentials
     * survive leaves a live credential with the OLD authority. Two statements would leave exactly that window; one
     * transaction closes it.
     */
    readonly applySecurityChange: (
        id: string,
        patch: UserPatch
    ) => Effect.Effect<User, UserRepositoryFailure, DatabasePort>
    readonly delete: (id: string) => Effect.Effect<void, UserRepositoryFailure, DatabasePort>
    /**
     * Ends every credential a user holds: their sessions and their API keys.
     *
     * A session carries the platform role, and an API key resolves to a session of its own, so neither can outlive a ban
     * or a role change — otherwise the change waits for the credential to expire.
     */
    /**
     * The caller's own sessions and API keys, for a data export (`AUTH-032`).
     *
     * Metadata only: `session.token` and `apikey.key` are credential material and are not selected at all, so no
     * serialization mistake can leak them.
     */
    /** How many accounts hold `role` — the last-super-admin guard reads it before a self-delete. */
    readonly countByRole: (
        role: string
    ) => Effect.Effect<number, UserRepositoryFailure, DatabasePort>
    readonly exportFor: (
        userId: string
    ) => Effect.Effect<SelfExportData, UserRepositoryFailure, DatabasePort>
    /** One user's sessions, newest first. No token: the row describes the credential, it is not it. */
    readonly listSessions: (
        userId: string
    ) => Effect.Effect<UserSessionRow[], UserRepositoryFailure, DatabasePort>
    /** End ONE session, scoped to its owner so a wrong id cannot reach somebody else's row. */
    readonly revokeSession: (
        userId: string,
        sessionId: string
    ) => Effect.Effect<boolean, UserRepositoryFailure, DatabasePort>
    readonly revokeCredentials: (
        id: string
    ) => Effect.Effect<void, UserRepositoryFailure, DatabasePort>
    /**
     * Store (or replace) the user's credential password.
     *
     * Better Auth keeps a password in the `credential` ACCOUNT row, not on `user`; the hash is produced by Better Auth's
     * own crypto so its sign-in verification keeps working.
     */
    readonly setPassword: (
        userId: string,
        passwordHash: string
    ) => Effect.Effect<void, UserRepositoryFailure, DatabasePort>
}

/** Tag and implementation together: the tag is the contract, `Live` the Drizzle implementation. */
export class UserRepository extends Context.Service<
    UserRepository,
    UserRepositoryShape
>()('identity/UserRepository') {
    /** The database is yielded when a method runs, so this is a constant the module provides with `useValue`. */
    static readonly live = serviceOver(DatabasePort, ({ db }) => makeUserRepository(db));

}

/** The column set one patch maps to. Shared by `update` and the atomic `applySecurityChange`. */
function userPatchSet(patch: UserPatch) {
    return {
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.email === undefined ? {} : { email: patch.email }),
        ...(patch.emailVerified === undefined ? {} : { emailVerified: patch.emailVerified }),
        ...(patch.role === undefined ? {} : { role: patch.role }),
        ...(patch.banned === undefined ? {} : { banned: patch.banned }),
        updatedAt: new Date(),
    }
}

/** Drizzle implementation over one database handle. */
function makeUserRepository(
    db: DatabaseShape['db']
): UserRepositoryShape {
    return {
        countByRole: (role: string) =>
            attempt(async () => {
                const rows = await db
                    .select({ value: count() })
                    .from(user)
                    .where(eq(user.role, role))
                return rows[0]?.value ?? 0
            }),

        exportFor: (userId: string) =>
            attempt(async () => {
                const [sessions, apiKeys] = await Promise.all([
                    db
                        .select({
                            id: session.id,
                            createdAt: session.createdAt,
                            expiresAt: session.expiresAt,
                            ipAddress: session.ipAddress,
                            userAgent: session.userAgent,
                            impersonatedBy: session.impersonatedBy,
                        })
                        .from(session)
                        .where(eq(session.userId, userId))
                        .orderBy(desc(session.createdAt)),
                    db
                        .select({
                            id: apikey.id,
                            name: apikey.name,
                            createdAt: apikey.createdAt,
                            expiresAt: apikey.expiresAt,
                            lastUsedAt: apikey.lastRequest,
                            enabled: apikey.enabled,
                        })
                        .from(apikey)
                        .where(eq(apikey.referenceId, userId))
                        .orderBy(desc(apikey.createdAt)),
                ])

                return {
                    sessions,
                    apiKeys: apiKeys.map((key) => ({ ...key, enabled: key.enabled ?? true })),
                }
            }),

        findById: (id: string) =>
            attempt(async () => {
                const rows = await db
                    .select()
                    .from(user)
                    .where(eq(user.id, id))
                    .limit(1)
                const row = rows[0]
                return row === undefined ? null : toUser(row)
            }),

        findByEmail: (email: string) =>
            attempt(async () => {
                const rows = await db
                    .select()
                    .from(user)
                    .where(eq(user.email, userRules.normaliseEmail(email)))
                    .limit(1)
                const row = rows[0]
                return row === undefined ? null : toUser(row)
            }),

        emailExists: (email: string, excludingId?: string) =>
            attempt(async () => {
                const rows = await db
                    .select({ id: user.id })
                    .from(user)
                    .where(eq(user.email, userRules.normaliseEmail(email)))
                    .limit(2)
                return rows.some((row) => row.id !== excludingId)
            }),

        list: (filter: UserListFilter) =>
            attempt(async () => {
                const where = buildWhere(filter)
                const column = USER_SORT_COLUMNS[filter.sortField]
                const order =
                    filter.sortDirection === 'asc' ? asc(column) : desc(column)

                const [rows, total] = await Promise.all([
                    db
                        .select()
                        .from(user)
                        .where(where)
                        .orderBy(order)
                        .limit(filter.limit)
                        .offset(filter.offset),
                    db.select({ value: count() }).from(user).where(where),
                ])

                return { data: rows.map(toUser), total: total[0]?.value ?? 0 }
            }),

        count: (filter: UserFilter) =>
            attempt(async () => {
                const rows = await db
                    .select({ value: count() })
                    .from(user)
                    .where(buildWhere(filter))
                return rows[0]?.value ?? 0
            }),

        insert: (input: NewUser & { email: string }) =>
            attempt(async () => {
                const rows = await db
                    .insert(user)
                    .values({
                        id: crypto.randomUUID(),
                        name: input.name,
                        email: input.email,
                        image: input.image ?? null,
                        emailVerified: false,
                        ...(input.role === undefined
                            ? {}
                            : { role: input.role }),
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    })
                    .returning()

                const row = rows[0]
                if (row === undefined)
                    throw new Error('insert into user returned no row')
                return toUser(row)
            }),

        update: (id: string, patch: UserPatch) =>
            attempt(async () => {
                const rows = await db
                    .update(user)
                    .set(userPatchSet(patch))
                    .where(eq(user.id, id))
                    .returning()

                const row = rows[0]
                if (row === undefined)
                    throw new Error(
                        `user ${id} disappeared between read and write`
                    )
                return toUser(row)
            }),

        delete: (id: string) =>
            attempt(async () => {
                await db.delete(user).where(eq(user.id, id))
            }),

        setPassword: (userId: string, passwordHash: string) =>
            attempt(async () => {
                const existing = await db
                    .select({ id: account.id })
                    .from(account)
                    .where(eq(account.userId, userId))
                    .limit(1)
                const row = existing[0]
                if (row === undefined) {
                    await db.insert(account).values({
                        id: randomUUID(),
                        accountId: userId,
                        providerId: 'credential',
                        userId,
                        password: passwordHash,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    })
                    return
                }
                await db
                    .update(account)
                    .set({ password: passwordHash, updatedAt: new Date() })
                    .where(eq(account.id, row.id))
            }),

        applySecurityChange: (id: string, patch: UserPatch) =>
            attempt(() =>
                db.transaction(async (tx) => {
                    const rows = await tx
                        .update(user)
                        .set(userPatchSet(patch))
                        .where(eq(user.id, id))
                        .returning()

                    const row = rows[0]
                    if (row === undefined) throw new Error(`user "${id}" was not found`)

                    // A role change invalidates every session; a ban additionally invalidates every key. An unban
                    // invalidates nothing, so signing back in still works.
                    if (patch.role !== undefined || patch.banned === true) {
                        await tx.delete(session).where(eq(session.userId, id))
                        await tx.delete(apikey).where(eq(apikey.referenceId, id))
                    }

                    return toUser(row)
                }),
            ),

        listSessions: (userId: string) =>
            attempt(async () => {
                const rows = await db
                    .select({
                        id: session.id,
                        createdAt: session.createdAt,
                        expiresAt: session.expiresAt,
                        ipAddress: session.ipAddress,
                        userAgent: session.userAgent,
                        impersonatedBy: session.impersonatedBy,
                    })
                    .from(session)
                    .where(eq(session.userId, userId))
                    .orderBy(desc(session.createdAt))
                return rows
            }),

        revokeSession: (userId: string, sessionId: string) =>
            attempt(async () => {
                const deleted = await db
                    .delete(session)
                    .where(and(eq(session.id, sessionId), eq(session.userId, userId)))
                    .returning({ id: session.id })
                return deleted.length > 0
            }),

        revokeCredentials: (id: string) =>
            attempt(async () => {
                await db.delete(session).where(eq(session.userId, id))
                await db.delete(apikey).where(eq(apikey.referenceId, id))
            }),
    }
}
