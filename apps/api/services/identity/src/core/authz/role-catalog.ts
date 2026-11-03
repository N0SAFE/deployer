import { roleGrants, type Permission } from "@deployer/auth/authz";

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
