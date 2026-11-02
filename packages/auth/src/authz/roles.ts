import type { Permission, ScopeKind } from "./catalog";

/**
 * One role, as data.
 *
 * The vocabulary (`PERMISSIONS`) stays in code so a check against a permission that does not exist is a compile error.
 * A ROLE is configuration: a name, the scope it applies to, its rank in the hierarchy, and the permissions it grants.
 * This type is the shape both the built-in seed and — once the `roles` table lands — a database row project onto, so
 * replacing the seed with rows changes one argument, not the call sites.
 */
export interface RoleDefinition {
	/** Stable name, also what `user.role` stores. */
	readonly name: string;
	/** `platform` roles apply everywhere; the rest are scoped to a project, environment, service or node. */
	readonly scope: ScopeKind;
	/**
	 * Position in the hierarchy. Higher outranks lower, and the number is what answers "may this actor act on that
	 * account" — a capability says *what* you may do, never *who* you may do it to.
	 */
	readonly rank: number;
	readonly permissions: readonly Permission[];
	/** A role the product ships with. Custom roles are editable; a system role is not, only re-seeded. */
	readonly system: boolean;
	/** Shown by the role picker; the seed names them, a custom role carries its own. */
	readonly label?: string;
}

/** Every role, by name. */
export type RoleTable = Readonly<Record<string, RoleDefinition>>;

/**
 * A role as it is stored: no rank, no derived permissions.
 *
 * This is the row shape a `roles` table holds today (name, scope, label, and its permission list), so the seed and the
 * database cannot drift in anything but their provenance.
 */
export interface RoleRow {
	readonly name: string;
	readonly scope: ScopeKind;
	readonly rank: number;
	readonly permissions: readonly Permission[];
	readonly label?: string;
}

/** Build the table from rows, refusing a duplicate name instead of silently letting one win. */
export function roleTable(rows: readonly RoleRow[], options: { readonly system?: boolean } = {}): RoleTable {
	const table: Record<string, RoleDefinition> = {};
	for (const row of rows) {
		if (table[row.name] !== undefined) {
			throw new Error(`role "${row.name}" is defined twice`);
		}
		table[row.name] = {
			name: row.name,
			scope: row.scope,
			rank: row.rank,
			permissions: row.permissions,
			system: options.system ?? false,
			...(row.label === undefined ? {} : { label: row.label }),
		};
	}
	return table;
}

/**
 * The permissions a role holds in `scope`.
 *
 * A role only grants in the scope it is declared for: a `platform` role does not hand out project capabilities, and a
 * project role grants nothing on the platform. That asymmetry is what keeps a project owner from reconfiguring the
 * server, and it is the reason the scope is part of the role rather than of the check.
 */
export function permissionsInRoles(table: RoleTable, role: string | null | undefined, scope: ScopeKind): readonly Permission[] {
	const definition = table[role ?? ""];
	if (definition?.scope !== scope) return [];
	return definition.permissions;
}

/**
 * The role's rank, or `-1` for a role the table does not know.
 *
 * An unknown role ranks below every declared one, so it can never outrank anybody — the failure mode of a renamed role
 * is "cannot administer", never "can administer everyone".
 */
export function rankInRoles(table: RoleTable, role: string | null | undefined): number {
	return table[role ?? ""]?.rank ?? -1;
}
