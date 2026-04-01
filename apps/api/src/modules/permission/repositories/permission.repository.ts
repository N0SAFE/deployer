import { Injectable } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { GlobalDatabaseService } from "../../../core/modules/database/services/global-database.service";
import { member } from "@/config/drizzle/global/schema/auth";
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

  // ─────────────────────────────────────────────────────────────────────────
  // MemberRoleLoader — reads Better Auth's `member` table (read-only)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Returns the role strings assigned to `userId` within `orgId`.
   *
   * Better Auth stores multiple roles as a comma-separated string, so we split
   * and trim to produce a clean array.
   */
  async getMemberRoles(userId: string, orgId: string): Promise<string[]> {
    const rows = await this.databaseService.db
      .select({ role: member.role })
      .from(member)
      .where(
        and(eq(member.userId, userId), eq(member.organizationId, orgId)),
      );

    return rows.flatMap((r) =>
      r.role
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // OrgRoleLoader — reads our custom `org_role_rules` table
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Returns the merged ResourceRule[] for all of the given role names within
   * an organisation.  Rules from multiple matched rows are concatenated.
   */
  async getOrgRoleRules(
    orgId: string,
    roleNames: string[],
  ): Promise<ResourceRule[]> {
    if (roleNames.length === 0) return [];

    const rows = await this.databaseService.db
      .select({ resourceRules: orgRoleRules.resourceRules })
      .from(orgRoleRules)
      .where(
        and(
          eq(orgRoleRules.organizationId, orgId),
          inArray(orgRoleRules.roleName, roleNames),
        ),
      );

    return rows.flatMap((r) => r.resourceRules);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CRUD for orgRoleRules (our custom table)
  // ─────────────────────────────────────────────────────────────────────────

  async upsertRoleRules(
    orgId: string,
    roleName: string,
    rules: ResourceRule[],
  ): Promise<void> {
    const { randomUUID } = await import("crypto");

    await this.databaseService.db
      .insert(orgRoleRules)
      .values({
        id: randomUUID(),
        organizationId: orgId,
        roleName,
        resourceRules: rules,
      })
      .onConflictDoUpdate({
        target: [orgRoleRules.organizationId, orgRoleRules.roleName],
        set: {
          resourceRules: rules,
          updatedAt: new Date(),
        },
      });
  }

  async deleteRoleRules(orgId: string, roleName: string): Promise<void> {
    await this.databaseService.db
      .delete(orgRoleRules)
      .where(
        and(
          eq(orgRoleRules.organizationId, orgId),
          eq(orgRoleRules.roleName, roleName),
        ),
      );
  }

  async listRoleRules(orgId: string) {
    return this.databaseService.db
      .select()
      .from(orgRoleRules)
      .where(eq(orgRoleRules.organizationId, orgId));
  }
}
