import { Injectable } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { GlobalDatabaseService } from "../../../core/modules/database/services/global-database.service";
import { roleRules } from "@/config/drizzle/global/schema/permissions";
import type { ResourceRule } from "@repo/auth/permissions";

/**
 * Handles raw DB queries for the PermissionEngine loaders.
 *
 * Two responsibilities:
 *  1. Load the user's platform-role-derived rules (mesh-wide single tenant).
 *  2. Read / write fine-grained ResourceRule configs from our `role_rules`
 *     table (we own lifecycle).
 */
@Injectable()
export class PermissionRepository {
  constructor(private readonly databaseService: GlobalDatabaseService) {}

/**
   * Returns the merged ResourceRule[] for all of the given role names.
   * Rules from multiple matched rows are concatenated.
   */
  async getRoleRules(roleNames: string[]): Promise<ResourceRule[]> {
    if (roleNames.length === 0) return [];

    const rows = await this.databaseService.db
      .select({ resourceRules: roleRules.resourceRules })
      .from(roleRules)
      .where(inArray(roleRules.roleName, roleNames));

    return rows.flatMap((r) => r.resourceRules);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CRUD for roleRules (our custom table)
  // ─────────────────────────────────────────────────────────────────────────

  async upsertRoleRules(
    roleName: string,
    rules: ResourceRule[],
  ): Promise<void> {
    const { randomUUID } = await import("crypto");

    await this.databaseService.db
      .insert(roleRules)
      .values({
        id: randomUUID(),
        roleName,
        resourceRules: rules,
      })
      .onConflictDoUpdate({
        target: [roleRules.roleName],
        set: {
          resourceRules: rules,
          updatedAt: new Date(),
        },
      });
  }

  async deleteRoleRules(roleName: string): Promise<void> {
    await this.databaseService.db
      .delete(roleRules)
      .where(eq(roleRules.roleName, roleName));
  }

  async listRoleRules() {
    return this.databaseService.db
      .select()
      .from(roleRules);
  }
}
