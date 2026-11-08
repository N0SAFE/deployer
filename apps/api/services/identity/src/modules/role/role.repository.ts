import { and, asc, count, desc, eq, sql } from 'drizzle-orm'
import { Context, Effect } from 'effect'

import type { ScopeKind } from '@deployer/auth/authz'
import {
    authzEpoch,
    roles,
    user,
} from '@deployer/nest-schema/global/identity/index'

import {
    DatabasePort,
    type DatabaseShape,
} from '@identity/core/database/database.port'

/** One role, as the table stores it. */
export type RoleRow = {
    readonly id: string
    readonly name: string
    readonly scope: ScopeKind
    readonly rank: number
    readonly label: string
    readonly description: string | null
    readonly color: string | null
    readonly isSystem: boolean
    readonly permissions: string[]
}

/** A role without its generated id: what the seed and a custom-role editor write. */
export type RoleSeedRow = Omit<RoleRow, 'id'>

export type RoleRepositoryShape = {
    readonly list: (
        scope?: ScopeKind
    ) => Effect.Effect<RoleRow[], never, DatabasePort>
    /**
     * Whether `name` is a platform role this deployment knows.
     *
     * The seed is the source of truth for what exists, so a request naming a role that was removed is refused here
     * rather than written into `user.role` as a string nothing can interpret.
     */
    readonly isKnownPlatformRole: (
        name: string
    ) => Effect.Effect<boolean, never, DatabasePort>
    /** Upsert on `(scope, name)`: re-seeding refreshes the built-in roles and never duplicates one. */
    readonly seed: (
        rows: readonly RoleSeedRow[]
    ) => Effect.Effect<void, never, DatabasePort>
    readonly findById: (
        id: string
    ) => Effect.Effect<RoleRow | null, never, DatabasePort>
    readonly create: (
        row: RoleSeedRow
    ) => Effect.Effect<RoleRow, never, DatabasePort>
    /** Only the fields a custom role may change: the name is what `user.role` stores. */
    readonly update: (
        id: string,
        patch: RolePatch
    ) => Effect.Effect<RoleRow | null, never, DatabasePort>
    readonly delete: (id: string) => Effect.Effect<void, never, DatabasePort>
    /** Every platform role with its permissions, for the authorization snapshot (`SEC-055`). */
    readonly loadCatalogue: () => Effect.Effect<
        {
            epoch: number
            roles: { name: string; permissions: readonly string[] }[]
        },
        never,
        DatabasePort
    >
    /** Bump the catalogue version; readers reload when it moves. */
    readonly bumpEpoch: () => Effect.Effect<void, never, DatabasePort>
    /** How many accounts hold this role — a delete is refused while any does. */
    readonly countUsersWithRole: (
        name: string
    ) => Effect.Effect<number, never, DatabasePort>
}

/** The upsert itself, over a database handle: the seeder and the repository share it, so there is one statement. */
export async function upsertRoles(
    db: DatabaseShape['db'],
    rows: readonly RoleSeedRow[]
): Promise<void> {
    if (rows.length === 0) return
    await db
        .insert(roles)
        .values(
            rows.map((row) => ({ ...row, permissions: [...row.permissions] }))
        )
        .onConflictDoUpdate({
            target: [roles.scope, roles.name],
            // `excluded` is the row that WOULD have been inserted. Referencing `roles.rank` here would set the column to
            // itself and silently freeze every built-in role at its first-seeded permissions.
            set: {
                rank: sql`excluded.rank`,
                label: sql`excluded.label`,
                description: sql`excluded.description`,
                color: sql`excluded.color`,
                isSystem: sql`excluded.is_system`,
                permissions: sql`excluded.permissions`,
                updatedAt: new Date(),
            },
        })
}

/** The table row as the domain reads it. */
function toRoleRow(row: typeof roles.$inferSelect): RoleRow {
    return {
        id: row.id,
        name: row.name,
        scope: row.scope as ScopeKind,
        rank: row.rank,
        label: row.label,
        description: row.description,
        color: row.color,
        isSystem: row.isSystem,
        permissions: [...row.permissions],
    }
}

/**
 * The role catalogue: reads for the picker, and the idempotent seed that keeps the built-ins in sync.
 *
 * The database is yielded inside the method that queries with it, so this is a class the module provides
 * with `useClass` — no `serviceOver` closure and no factory holding the queries.
 */
export class RoleRepository extends Context.Service<
    RoleRepository,
    RoleRepositoryShape
>()('identity/RoleRepository') {
    static readonly live = class RoleRepositoryImpl
        implements RoleRepositoryShape
    {
        isKnownPlatformRole(name): ReturnType<RoleRepositoryShape['isKnownPlatformRole']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                return yield* Effect.promise(async () => {
                    const rows = await database.db
                        .select({ id: roles.id })
                        .from(roles)
                        .where(and(eq(roles.scope, 'platform'), eq(roles.name, name)))
                        .limit(1)
                    return rows.length > 0
                })
            })
        }

        list(scope): ReturnType<RoleRepositoryShape['list']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                return yield* Effect.promise(async () => {
                    const rows = await database.db
                        .select()
                        .from(roles)
                        .where(scope === undefined ? undefined : eq(roles.scope, scope))
                        // Highest rank first: the picker reads the strongest role at the top, and `platform` sorts before the rest.
                        .orderBy(asc(roles.scope), desc(roles.rank), asc(roles.name))

                    return rows.map((row) => ({
                        id: row.id,
                        name: row.name,
                        scope: row.scope as ScopeKind,
                        rank: row.rank,
                        label: row.label,
                        description: row.description,
                        color: row.color,
                        isSystem: row.isSystem,
                        // Copied into a mutable array: the contract's output type is `string[]`, and a `readonly` mismatch here
                        // poisons the handler's inferred requirements (`any`), which the boot gate then refuses.
                        permissions: [...row.permissions],
                    }))
                })
            })
        }

        seed(rows): ReturnType<RoleRepositoryShape['seed']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                return yield* Effect.promise(() => upsertRoles(database.db, rows))
            })
        }

        findById(id): ReturnType<RoleRepositoryShape['findById']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                return yield* Effect.promise(async () => {
                    const [row] = await database.db
                        .select()
                        .from(roles)
                        .where(eq(roles.id, id))
                        .limit(1)
                    return row === undefined ? null : toRoleRow(row)
                })
            })
        }

        create(row): ReturnType<RoleRepositoryShape['create']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                return yield* Effect.promise(async () => {
                    const [created] = await database.db
                        .insert(roles)
                        .values({ ...row, permissions: [...row.permissions] })
                        .returning()
                    if (created === undefined)
                        throw new Error('role insert returned no row')
                    return toRoleRow(created)
                })
            })
        }

        update(id, patch): ReturnType<RoleRepositoryShape['update']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                return yield* Effect.promise(async () => {
                    const [updated] = await database.db
                        .update(roles)
                        .set({
                            ...(patch.rank === undefined ? {} : { rank: patch.rank }),
                            ...(patch.label === undefined
                                ? {}
                                : { label: patch.label }),
                            ...(patch.description === undefined
                                ? {}
                                : { description: patch.description }),
                            ...(patch.color === undefined
                                ? {}
                                : { color: patch.color }),
                            ...(patch.permissions === undefined
                                ? {}
                                : { permissions: [...patch.permissions] }),
                            updatedAt: new Date(),
                        })
                        .where(eq(roles.id, id))
                        .returning()
                    return updated === undefined ? null : toRoleRow(updated)
                })
            })
        }

        delete(id): ReturnType<RoleRepositoryShape['delete']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                return yield* Effect.promise(async () => {
                    await database.db.delete(roles).where(eq(roles.id, id))
                })
            })
        }

        loadCatalogue(): ReturnType<RoleRepositoryShape['loadCatalogue']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                return yield* Effect.promise(async () => {
                    const [epochRow] = await database.db
                        .select()
                        .from(authzEpoch)
                        .where(eq(authzEpoch.id, 'global'))
                        .limit(1)
                    const rows = await database.db
                        .select({ name: roles.name, permissions: roles.permissions })
                        .from(roles)
                        .where(eq(roles.scope, 'platform'))
                    return {
                        epoch: epochRow?.value ?? 1,
                        roles: rows.map((row) => ({
                            name: row.name,
                            permissions: [...row.permissions],
                        })),
                    }
                })
            })
        }

        bumpEpoch(): ReturnType<RoleRepositoryShape['bumpEpoch']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                return yield* Effect.promise(async () => {
                    await database.db
                        .insert(authzEpoch)
                        .values({ id: 'global', value: 1 })
                        .onConflictDoUpdate({
                            target: authzEpoch.id,
                            set: {
                                value: sql`${authzEpoch.value} + 1`,
                                updatedAt: new Date(),
                            },
                        })
                })
            })
        }

        countUsersWithRole(name): ReturnType<RoleRepositoryShape['countUsersWithRole']> {
            return Effect.gen(function* () {
                const database = yield* DatabasePort
                return yield* Effect.promise(async () => {
                    const [row] = await database.db
                        .select({ value: count() })
                        .from(user)
                        .where(eq(user.role, name))
                    return row?.value ?? 0
                })
            })
        }
    }
}

/** The fields an update may change. */
export type RolePatch = {
    readonly rank?: number
    readonly label?: string
    readonly description?: string | null
    readonly color?: string | null
    readonly permissions?: readonly string[]
}
