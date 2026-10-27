import { Injectable } from "@nestjs/common";
import { Context, Effect } from "effect";
import { eq, inArray } from "drizzle-orm";
import { roleRules } from "@deployer/nest-schema/global/identity/permissions";
import type { ResourceRule } from "@deployer/auth/permissions";
import { DatabasePort } from "@identity/core/database/database.port";

import { PermissionRepositoryFailure } from "../permission.failures";
import type { RoleRuleRow } from "../permission.types";

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
    roleNames: string[],
  ) => Effect.Effect<ResourceRule[], PermissionRepositoryFailure, DatabasePort>;
  readonly upsertRoleRules: (
    roleName: string,
    rules: ResourceRule[],
  ) => Effect.Effect<void, PermissionRepositoryFailure, DatabasePort>;
  readonly deleteRoleRules: (
    roleName: string,
  ) => Effect.Effect<void, PermissionRepositoryFailure, DatabasePort>;
  readonly listRoleRules: () => Effect.Effect<RoleRuleRow[], PermissionRepositoryFailure, DatabasePort>;
}

/** Effect key = NestJS token. The Drizzle implementation is below. */
export class PermissionRepository extends Context.Service<PermissionRepository, PermissionRepositoryShape>()(
  "identity/PermissionRepository",
) {}

/** One async database boundary; driver errors become `PermissionRepositoryFailure`. */
function attempt<T>(operation: () => Promise<T>): Effect.Effect<T, PermissionRepositoryFailure> {
  return Effect.tryPromise({
    try: operation,
    catch: (cause) => new PermissionRepositoryFailure({ cause }),
  });
}

/** Drizzle implementation. No constructor injection: every method yields `DatabasePort`. */
@Injectable()
export class PermissionRepositoryImpl implements PermissionRepositoryShape {
  /**
   * Returns the merged ResourceRule[] for all of the given role names.
   * Rules from multiple matched rows are concatenated.
   */
  getRoleRules(
    roleNames: string[],
  ): Effect.Effect<ResourceRule[], PermissionRepositoryFailure, DatabasePort> {
    return Effect.gen(function* () {
      if (roleNames.length === 0) return [];
      const { db } = yield* DatabasePort;

      return yield* attempt(async () => {
        const rows = await db
          .select({ resourceRules: roleRules.resourceRules })
          .from(roleRules)
          .where(inArray(roleRules.roleName, roleNames));

        return rows.flatMap((r) => r.resourceRules ?? []);
      });
    });
  }

  upsertRoleRules(
    roleName: string,
    rules: ResourceRule[],
  ): Effect.Effect<void, PermissionRepositoryFailure, DatabasePort> {
    return Effect.gen(function* () {
      const { db } = yield* DatabasePort;

      return yield* attempt(async () => {
        await db
          .insert(roleRules)
          .values({ id: crypto.randomUUID(), roleName, resourceRules: rules })
          .onConflictDoUpdate({
            target: [roleRules.roleName],
            set: { resourceRules: rules, updatedAt: new Date() },
          });
      });
    });
  }

  deleteRoleRules(
    roleName: string,
  ): Effect.Effect<void, PermissionRepositoryFailure, DatabasePort> {
    return Effect.gen(function* () {
      const { db } = yield* DatabasePort;

      return yield* attempt(async () => {
        await db.delete(roleRules).where(eq(roleRules.roleName, roleName));
      });
    });
  }

  listRoleRules(): Effect.Effect<RoleRuleRow[], PermissionRepositoryFailure, DatabasePort> {
    return Effect.gen(function* () {
      const { db } = yield* DatabasePort;
      return yield* attempt(async () => db.select().from(roleRules));
    });
  }
}
