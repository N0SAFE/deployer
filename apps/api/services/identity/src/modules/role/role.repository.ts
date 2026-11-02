import { asc, desc, eq, sql } from "drizzle-orm";
import { Context, Effect } from "effect";

import type { ScopeKind } from "@deployer/auth/authz";
import { serviceOver } from "@deployer/effect-core";
import { roles } from "@deployer/nest-schema/global/identity/index";

import { DatabasePort, type DatabaseShape } from "@identity/core/database/database.port";

/** One role, as the table stores it. */
export type RoleRow = {
	readonly id: string;
	readonly name: string;
	readonly scope: ScopeKind;
	readonly rank: number;
	readonly label: string;
	readonly description: string | null;
	readonly color: string | null;
	readonly isSystem: boolean;
	readonly permissions: string[];
};

/** A role without its generated id: what the seed and a custom-role editor write. */
export type RoleSeedRow = Omit<RoleRow, "id">;

export type RoleRepositoryShape = {
	readonly list: (scope?: ScopeKind) => Effect.Effect<RoleRow[], never, DatabasePort>;
	/** Upsert on `(scope, name)`: re-seeding refreshes the built-in roles and never duplicates one. */
	readonly seed: (rows: readonly RoleSeedRow[]) => Effect.Effect<void, never, DatabasePort>;
};

/** The upsert itself, over a database handle: the seeder and the repository share it, so there is one statement. */
export async function upsertRoles(db: DatabaseShape["db"], rows: readonly RoleSeedRow[]): Promise<void> {
	if (rows.length === 0) return;
	await db
		.insert(roles)
		.values(rows.map((row) => ({ ...row, permissions: [...row.permissions] })))
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
		});
}

const makeRoleRepository = (database: DatabaseShape): RoleRepositoryShape => ({
	list: (scope) =>
		Effect.promise(async () => {
			const rows = await database.db
				.select()
				.from(roles)
				.where(scope === undefined ? undefined : eq(roles.scope, scope))
				// Highest rank first: the picker reads the strongest role at the top, and `platform` sorts before the rest.
				.orderBy(asc(roles.scope), desc(roles.rank), asc(roles.name));

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
			}));
		}),

	seed: (rows) => Effect.promise(() => upsertRoles(database.db, rows)),
});

/** The role catalogue: reads for the picker, and the idempotent seed that keeps the built-ins in sync. */
export class RoleRepository extends Context.Service<RoleRepository, RoleRepositoryShape>()(
	"identity/RoleRepository",
) {
	static readonly live = serviceOver(DatabasePort, makeRoleRepository);
}
