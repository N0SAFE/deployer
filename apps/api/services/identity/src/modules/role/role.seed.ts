import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";

import { SYSTEM_ROLES_TABLE } from "@deployer/auth/authz";

import { DatabasePort, type DatabaseShape } from "@identity/core/database/database.port";

import { upsertRoles, type RoleSeedRow } from "./role.repository";

/**
 * The built-in roles as rows.
 *
 * `SYSTEM_ROLES_TABLE` stays the declaration: the ids, the catalog permissions and the ranks are code, so a role that
 * does not exist cannot be seeded. The table is what makes a role editable and queryable without a deploy.
 */
export const systemRolesAsRows = (): RoleSeedRow[] =>
	Object.values(SYSTEM_ROLES_TABLE).map((role) => ({
		name: role.name,
		scope: role.scope,
		rank: role.rank,
		label: role.label ?? role.name,
		description: role.description ?? null,
		color: role.color ?? null,
		isSystem: true,
		permissions: [...role.permissions],
	}));

/**
 * Keep the `roles` table in sync with the code that declares it.
 *
 * Boot, not a migration: the seed is idempotent (upsert on `(scope, name)`), so a deployment that adds a permission to a
 * built-in role refreshes the row on restart, and a custom role stored beside it is never touched.
 */
@Injectable()
export class RoleSeeder implements OnApplicationBootstrap {
	private readonly logger = new Logger(RoleSeeder.name);

	constructor(@Inject(DatabasePort) private readonly database: DatabaseShape) {}

	async onApplicationBootstrap(): Promise<void> {
		const rows = systemRolesAsRows();
		await upsertRoles(this.database.db, rows);
		this.logger.log(`roles: ${String(rows.length)} built-in roles synchronised`);
	}
}
