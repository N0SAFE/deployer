import { eq, inArray } from 'drizzle-orm'
import { Context, Effect } from 'effect'

import type { ResourceRule } from '@deployer/auth/permissions'
import { serviceOver, type Over } from "@deployer/effect-core"
import { roleRules } from '@deployer/nest-schema/global/identity/permissions'

import {
    DatabasePort,
    type DatabaseShape,
} from '@identity/core/database/database.port'

import { PermissionRepositoryFailure } from '../permission.failures'

import type { RoleRuleRow } from '../permission.types'

/**
 * Handles raw DB queries for the PermissionEngine loaders.
 *
 * Two responsibilities:
 *  1. Load the user's platform-role-derived rules (mesh-wide single tenant).
 *  2. Read / write fine-grained ResourceRule configs from our `role_rules`
 *     table (we own lifecycle).
 */
export type PermissionRepositoryShape = {
    readonly getRoleRules: (
        roleNames: string[]
    ) => Effect.Effect<ResourceRule[], PermissionRepositoryFailure, DatabasePort>
    readonly upsertRoleRules: (
        roleName: string,
        rules: ResourceRule[]
    ) => Effect.Effect<void, PermissionRepositoryFailure, DatabasePort>
    readonly deleteRoleRules: (
        roleName: string
    ) => Effect.Effect<void, PermissionRepositoryFailure, DatabasePort>
    readonly listRoleRules: () => Effect.Effect<
        RoleRuleRow[],
        PermissionRepositoryFailure,
        DatabasePort
    >
}

/** Effect key = NestJS token. The Drizzle implementation is below. */
export class PermissionRepository extends Context.Service<
    PermissionRepository,
    PermissionRepositoryShape
>()('identity/PermissionRepository') {
    /** The database is yielded when a method runs, so this is a constant the module provides with `useValue`. */
    static readonly live = serviceOver(DatabasePort, ({ db }) => makePermissionRepository(db));

}

/** One async database boundary; driver errors become `PermissionRepositoryFailure`. */
function attempt<T>(
    operation: () => Promise<T>
): Effect.Effect<T, PermissionRepositoryFailure> {
    return Effect.tryPromise({
        try: operation,
        catch: (cause) => new PermissionRepositoryFailure({ cause }),
    })
}

/** Drizzle implementation over one database handle. */
function makePermissionRepository(
    db: DatabaseShape['db']
): PermissionRepositoryShape {
    return {
        /**
         * Returns the merged ResourceRule[] for all of the given role names.
         * Rules from multiple matched rows are concatenated.
         */
        getRoleRules: (roleNames) =>
            roleNames.length === 0
                ? Effect.succeed([])
                : attempt(async () => {
                      const rows = await db
                          .select({ resourceRules: roleRules.resourceRules })
                          .from(roleRules)
                          .where(inArray(roleRules.roleName, roleNames))

                      return rows.flatMap((r) => r.resourceRules ?? [])
                  }),

        upsertRoleRules: (roleName, rules) =>
            attempt(async () => {
                await db
                    .insert(roleRules)
                    .values({
                        id: crypto.randomUUID(),
                        roleName,
                        resourceRules: rules,
                    })
                    .onConflictDoUpdate({
                        target: [roleRules.roleName],
                        set: { resourceRules: rules, updatedAt: new Date() },
                    })
            }),

        deleteRoleRules: (roleName) =>
            attempt(async () => {
                await db
                    .delete(roleRules)
                    .where(eq(roleRules.roleName, roleName))
            }),

        listRoleRules: () => attempt(async () => db.select().from(roleRules)),
    }
}
