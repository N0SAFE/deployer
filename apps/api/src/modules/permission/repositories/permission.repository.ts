import { Injectable } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { GlobalDatabaseService } from "../../../core/modules/database/services/global-database.service";
import { orgRoleRules } from "@/config/drizzle/global/schema/permissions";
import type { ResourceRule } from "@repo/auth/permissions";

/**
 * Handles raw DB queries for the PermissionEngine loaders.
 *
 * Two responsibilities:
 *  1. Read member roles from Better Auth's `member` table (BA owns writes).
 *  2. Read / write fine-grained ResourceRule configs from our `org_role_rules`
 *     table (we own lifecycle).
 */
@Injectable()
export class PermissionRepository {
  constructor(private readonly databaseService: GlobalDatabaseService) {}

/**
   * Returns the merged ResourceRule[] for all of the given role names within
   * an organisation.  Rules from multiple matched rows are concatenated.
   */
  async getRoleRules(roleNames: string[]): Promise<ResourceRule[]> {
    if (roleNames.length === 0) return [];

    const rows = await this.databaseService.db
      .select({ resourceRules: orgRoleRules.resourceRules })
      .from(orgRoleRules)
      .where(inArray(orgRoleRules.roleName, roleNames));

    return rows.flatMap((r) => r.resourceRules);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CRUD for orgRoleRules (our custom table)
  // ─────────────────────────────────────────────────────────────────────────

  async upsertRoleRules(
    roleName: string,
    rules: ResourceRule[],
  ): Promise<void> {
    const { randomUUID } = await import("crypto");

    await this.databaseService.db
      .insert(orgRoleRules)
      .values({
        id: randomUUID(),
        roleName,
        resourceRules: rules,
      })
      .onConflictDoUpdate({
        target: [orgRoleRules.roleName],
        set: {
          resourceRules: rules,
          updatedAt: new Date(),
        },
      });
  }

  async deleteRoleRules(roleName: string): Promise<void> {
    await this.databaseService.db
      .delete(orgRoleRules)
      .where(eq(orgRoleRules.roleName, roleName));
  }

  async listRoleRules() {
    return this.databaseService.db
      .select()
      .from(orgRoleRules);
  }
}
