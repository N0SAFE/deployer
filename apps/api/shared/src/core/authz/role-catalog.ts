import { SYSTEM_ROLES_TABLE, capabilitiesOfRole, roleGrants, type Permission } from "@deployer/auth/authz";

/**
 * The permission snapshot authorization reads (`SEC-055`).
 *
 * Roles are rows now, but a capability check runs inside a SYNCHRONOUS rule and must not become a database round-trip per
 * check. This keeps one snapshot per process — role name → granted permission strings — refreshed when the catalogue's
 * epoch changes (or the TTL lapses), which bounds staleness instead of removing it silently.
 *
 * Until a snapshot exists (boot, or a spec that never loads one) the CODE table answers, so the fallback is the same
 * declaration the seed was written from. That is why an empty cache is safe: it is never "no permissions", it is
 * "ask the declaration".
 *
 * It lives in `shared` because TWO readers need the same view: the identity service's approval guard, and the oRPC authz
 * gate in every service (`SEC-062`). Each process loads it from the `roles` table it can reach; the code is one.
 */
export type CatalogueRole = { readonly name: string; readonly permissions: readonly string[] };

type Snapshot = {
	readonly epoch: number;
	readonly permissions: ReadonlyMap<string, ReadonlySet<string>>;
};

let snapshot: Snapshot | null = null;

/** Replace the snapshot with the catalogue as it is now. */
export function installRoleSnapshot(epoch: number, roles: readonly CatalogueRole[]): void {
	snapshot = {
		epoch,
		permissions: new Map(roles.map((role) => [role.name, new Set(role.permissions)])),
	};
}

/** Forget the snapshot; the code table answers until the next install. Used by tests. */
export function clearRoleSnapshot(): void {
	snapshot = null;
}

/** The epoch the current snapshot was loaded at, or `null` when it is the code fallback. */
export function roleSnapshotEpoch(): number | null {
	return snapshot?.epoch ?? null;
}

/**
 * Which role NAMES grant a permission.
 *
 * Used to answer "how many people can approve": the snapshot lists the roles, and the caller counts accounts holding
 * them. The code table answers the same question when no snapshot exists.
 */
export function roleNamesWithPermission(permission: Permission): string[] {
	if (snapshot === null || snapshot.permissions.size === 0) {
		return Object.values(SYSTEM_ROLES_TABLE)
			.filter((role) => role.permissions.includes(permission))
			.map((role) => role.name);
	}
	return [...snapshot.permissions.entries()]
		.filter(([, permissions]) => permissions.has(permission))
		.map(([name]) => name);
}

/**
 * Whether a role grants a permission.
 *
 * A role the catalogue does not list grants NOTHING — including one that was deleted while its holders still carry the
 * name, which is the fail-closed direction and the reason deleting a held role is refused.
 */
export function roleHasPermission(role: string | null | undefined, permission: Permission): boolean {
	// An installed-but-EMPTY snapshot means the table had no rows when it was read — boot before the seed. That is "not
	// ready", not "every role grants nothing": falling back keeps sign-in working while the catalogue arrives. A snapshot
	// with rows is authoritative, and a role it does not list grants nothing (fail closed).
	if (snapshot === null || snapshot.permissions.size === 0) return roleGrants(role ?? "", permission);
	return snapshot.permissions.get(role ?? "")?.has(permission) ?? false;
}

/**
 * Every permission a role grants, read the same way `roleHasPermission` answers one: the snapshot when the catalogue is
 * loaded, the code table before that.
 *
 * The gate needs the SET rather than one answer (`PermissionStore.capabilities`), and it must not disagree with the
 * boolean helper — a role that passes one and fails the other is the kind of split-brain an enforcement flip turns into
 * a lockout.
 */
export function permissionsOfRole(role: string | null | undefined): readonly Permission[] {
	if (snapshot === null || snapshot.permissions.size === 0) return capabilitiesOfRole(role ?? "");
	return [...(snapshot.permissions.get(role ?? "") ?? [])] as readonly Permission[];
}
