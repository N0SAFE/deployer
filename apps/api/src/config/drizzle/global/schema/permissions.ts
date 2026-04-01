/**
 * Custom permission schema — NOT managed by Better Auth.
 *
 * Better Auth manages coarse-grained org roles via its own `organization_role`
 * table (enabled via `dynamicAccessControl: { enabled: true }`).  That table
 * stores `{ role, permission }` pairs where `permission` is a flat capability
 * map like `{ project: ["create", "update"] }`.
 *
 * This file adds a SEPARATE concern: fine-grained, row-level ResourceRule
 * configurations used by the PermissionEngine to build dynamic SQL filters.
 * Each row maps an org role name (matching `member.role`) to an array of
 * ResourceRule objects that drive WHERE-clause generation.
 *
 * Table name `org_role_rules` is intentionally distinct from BA's
 * `organization_role` to avoid any collision on re-generation.
 */
import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { ResourceRule } from "@repo/auth/permissions";
import { organization } from "./auth";

/**
 * Stores fine-grained ResourceRule[] per (org, role-name) pair.
 *
 * - `roleName` must match the value stored in `member.role` (or BA's
 *   `organization_role.role` for dynamic roles).
 * - `resourceRules` is a JSONB array of ResourceRule objects consumed by
 *   PermissionEngine to build WHERE clauses and evaluate row-level access.
 */
export const orgRoleRules = pgTable(
  "org_role_rules",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Role name — matches `member.role` or `organization_role.role`. */
    roleName: text("role_name").notNull(),
    resourceRules: jsonb("resource_rules")
      .$type<ResourceRule[]>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("org_role_rules_orgId_roleName_uidx").on(
      table.organizationId,
      table.roleName,
    ),
    index("org_role_rules_orgId_idx").on(table.organizationId),
  ],
);

export type OrgRoleRules = typeof orgRoleRules.$inferSelect;
export type NewOrgRoleRules = typeof orgRoleRules.$inferInsert;

export const orgRoleRulesRelations = relations(orgRoleRules, ({ one }) => ({
  organization: one(organization, {
    fields: [orgRoleRules.organizationId],
    references: [organization.id],
  }),
}));
