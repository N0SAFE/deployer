import { boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Roles as rows.
 *
 * The permission VOCABULARY stays in code (`authz` catalog) so a check against an undeclared permission is a compile
 * error; a ROLE is configuration — a name, the scope it applies to, its rank, its label and the permissions it grants.
 * `SYSTEM_ROLES_TABLE` seeds this table; after that, the table is the source and `user.role` is a projection of it.
 *
 * Scoped uniqueness, not a global one: a platform `viewer` and a project `viewer` are different roles that happen to share
 * a display name.
 */
export const roles = pgTable(
	"roles",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		name: text("name").notNull(),
		/** `platform`, `project`, `environment`, `service` or `node`. */
		scope: text("scope").notNull(),
		rank: integer("rank").notNull(),
		label: text("label").notNull(),
		description: text("description"),
		color: text("color"),
		/** A role the product ships with: editable only by re-seeding, never deleted from the UI. */
		isSystem: boolean("is_system").notNull().default(false),
		/** Catalog permission strings (`"service:deploy"`). Validated against the vocabulary where they are written. */
		permissions: jsonb("permissions").$type<readonly string[]>().notNull().default([]),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [uniqueIndex("roles_scope_name_idx").on(table.scope, table.name)],
);
