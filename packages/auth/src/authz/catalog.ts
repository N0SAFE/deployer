/**
 * The permission vocabulary: one typed definition of every capability, grouped into bundles and system roles.
 *
 * This file is the ONLY place a permission exists. Everything else derives from it at the type level:
 *
 *   - `Permission` is the union of the catalog's keys, so a typo in `.access({ permission })`, in a role, in the web
 *     `useCan(...)` or in a grant is a compile error rather than a silent deny at runtime;
 *   - `BUNDLES` and `SYSTEM_ROLES` are checked against it by `authz.spec.ts`, and a permission that belongs to no bundle
 *     is a test failure (it would be unreachable from the role editor);
 *   - the risk tier decides the UI warning, the audit level and the default guardrail.
 *
 * Custom roles live in the database and may only contain permissions from here (a subset of their base role), so an
 * administrator can change *who* may do *what* without inventing a capability the product does not implement.
 */

import { roleTable, type RoleTable } from "./roles";

/** How damaging a permission is. Drives the guardrail default, the audit level and the editor's warning. */
export type Risk = "read" | "write" | "destructive" | "reveal" | "admin";

export interface PermissionDefinition {
	readonly risk: Risk;
	/** Shown by the role editor; the one sentence an administrator reads before granting it. */
	readonly description: string;
}

export const PERMISSIONS = {
	// ── platform ──────────────────────────────────────────────────────────────────────────────────────────────
	"settings:read": { risk: "read", description: "See platform settings." },
	"settings:manage": { risk: "admin", description: "Change platform settings." },
	"audit:read": { risk: "read", description: "Read the audit log." },
	"user:read": { risk: "read", description: "See platform users." },
	"user:invite": { risk: "write", description: "Invite people to the platform." },
	"user:update": { risk: "write", description: "Edit a user's profile and status." },
	"user:delete": { risk: "destructive", description: "Remove a user from the platform." },
	"user:set-role": { risk: "admin", description: "Change a user's platform role." },
	"role:read": { risk: "read", description: "See roles and their permissions." },
	"role:write": { risk: "admin", description: "Create or edit custom roles." },
	"role:assign": { risk: "admin", description: "Grant or revoke roles and permissions." },
	"token:create": { risk: "write", description: "Mint an API or deploy token." },
	"token:revoke": { risk: "write", description: "Revoke a token." },
	"cluster:read": { risk: "read", description: "See the cluster, its nodes and services." },
	"cluster:operate": { risk: "write", description: "Update cluster and node settings." },
	"cluster:join-token:reveal": { risk: "reveal", description: "Reveal a swarm join token." },
	"node:read": { risk: "read", description: "See node status, metrics and capacity." },
	"node:operate": { risk: "write", description: "Drain, promote or update a node." },
	"node:revoke": { risk: "destructive", description: "Remove a node from the cluster." },
	"registry:read": { risk: "read", description: "See registries." },
	"registry:write": { risk: "write", description: "Add or change a registry and its credentials." },
	"edge:read": { risk: "read", description: "See the edge and ingress state." },
	"edge:manage": { risk: "write", description: "Change the edge provider, tunnels and ingress." },
	"dns.provider:read": { risk: "read", description: "See DNS providers." },
	"dns.provider:write": { risk: "write", description: "Add or change a DNS provider." },
	"mesh:read": { risk: "read", description: "See the mesh roster and replicas." },
	"mesh:operate": { risk: "write", description: "Join, block or rotate the mesh." },
	"platform.secret:reveal": { risk: "reveal", description: "Reveal a platform secret." },

	// ── project ───────────────────────────────────────────────────────────────────────────────────────────────
	"project:read": { risk: "read", description: "See a project." },
	"project:write": { risk: "write", description: "Edit a project." },
	"project:delete": { risk: "destructive", description: "Delete a project and everything in it." },
	"member:read": { risk: "read", description: "See the project's members." },
	"member:invite": { risk: "write", description: "Invite a member to the project." },
	"member:role:write": { risk: "admin", description: "Change a member's project role." },
	"member:remove": { risk: "write", description: "Remove a member from the project." },
	"env.var:read": { risk: "read", description: "See a project's environment variables." },
	"env.var:write": { risk: "write", description: "Change a project's environment variables." },
	"secret:reveal": { risk: "reveal", description: "Reveal a stored secret value." },
	"domain:read": { risk: "read", description: "See a project's domains." },
	"domain:write": { risk: "write", description: "Attach or remove a domain." },
	"domain:verify": { risk: "write", description: "Verify domain ownership." },
	"dns.record:read": { risk: "read", description: "See DNS records." },
	"dns.record:write": { risk: "write", description: "Create or change DNS records." },
	"template:read": { risk: "read", description: "See templates." },
	"template:write": { risk: "write", description: "Create or change templates." },
	"webhook:read": { risk: "read", description: "See webhooks." },
	"webhook:write": { risk: "write", description: "Create or change a webhook and its secret." },

	// ── service, deployment, container ────────────────────────────────────────────────────────────────────────
	"service:read": { risk: "read", description: "See a service." },
	"service:create": { risk: "write", description: "Create a service." },
	"service:update": { risk: "write", description: "Edit a service." },
	"service:deploy": { risk: "write", description: "Deploy a service." },
	"service:delete": { risk: "destructive", description: "Delete a service." },
	"deployment:read": { risk: "read", description: "See deployments." },
	"deployment:create": { risk: "write", description: "Start a deployment." },
	"deployment:cancel": { risk: "write", description: "Cancel a running deployment." },
	"deployment:rollback": { risk: "destructive", description: "Roll back to a previous deployment." },
	"deployment.logs:read": { risk: "read", description: "Read deployment logs and streams." },
	"container:read": { risk: "read", description: "See containers, images, networks and volumes." },
	"container:exec": { risk: "reveal", description: "Open a shell in a container." },
	"container:files:write": { risk: "write", description: "Write, delete or rename files in a container." },
	"container:write": { risk: "write", description: "Start, stop, restart or remove a container." },
} as const satisfies Record<string, PermissionDefinition>;

export type Permission = keyof typeof PERMISSIONS;

/** Product concepts, so an administrator edits "deploy" rather than fifty checkboxes. */
export const BUNDLES = {
	"platform-read": ["settings:read", "audit:read", "user:read", "role:read", "cluster:read", "node:read", "registry:read", "edge:read", "dns.provider:read", "mesh:read"],
	"platform-admin": ["settings:manage", "role:write", "role:assign", "user:update", "user:set-role", "token:create", "token:revoke"],
	"platform-operate": ["cluster:operate", "node:operate", "registry:write", "edge:manage", "mesh:operate", "dns.provider:write", "user:invite"],
	"platform-danger": ["user:delete", "node:revoke", "cluster:join-token:reveal", "platform.secret:reveal"],
	"project-admin": ["project:read", "project:write", "project:delete", "service:delete", "member:read", "member:invite", "member:role:write", "member:remove", "env.var:read", "env.var:write", "secret:reveal", "domain:read", "domain:write", "domain:verify", "dns.record:read", "dns.record:write", "template:read", "template:write", "webhook:read", "webhook:write"],
	"deploy": ["service:read", "service:create", "service:update", "service:deploy", "deployment:read", "deployment:create", "deployment:cancel", "deployment:rollback", "deployment.logs:read"],
	"project-read": ["project:read", "member:read", "env.var:read", "domain:read", "dns.record:read", "service:read", "deployment:read", "deployment.logs:read", "container:read"],
	"docker": ["container:read", "container:write", "container:exec", "container:files:write"],
} as const satisfies Record<string, readonly Permission[]>;

export type BundleName = keyof typeof BUNDLES;

/** Scope kinds a role can be defined for. `platform` roles apply everywhere; the rest are project-scoped. */
export type ScopeKind = "platform" | "project" | "environment" | "service" | "node";

export const SYSTEM_ROLES = {
	// platform-wide
	// The owner of the platform holds every capability, project ones included: there is no implicit bypass, so what it
	// may do has to be in its set like everyone else's.
	superAdmin: { scope: "platform", bundles: ["platform-read", "platform-admin", "platform-operate", "platform-danger", "project-admin", "deploy", "project-read", "docker"] },
	admin: { scope: "platform", bundles: ["platform-read", "platform-admin", "platform-operate", "docker"] },
	operator: { scope: "platform", bundles: ["platform-read", "platform-operate", "docker"] },
	viewer: { scope: "platform", bundles: ["platform-read"] },
	// The database default for a new account: an account with no capability at all. It has to be declared, or a role no
	// rule can name ends up in `user.role`.
	user: { scope: "platform", bundles: [] },
	// project-scoped
	owner: { scope: "project", bundles: ["project-admin", "deploy", "project-read", "docker"] },
	maintainer: { scope: "project", bundles: ["deploy", "project-read", "docker"] },
	deployer: { scope: "project", bundles: ["deploy"] },
	member: { scope: "project", bundles: ["project-read"] },
} as const satisfies Record<string, { readonly scope: ScopeKind; readonly bundles: readonly BundleName[] }>;

export type SystemRole = keyof typeof SYSTEM_ROLES;

/**
 * Position in the hierarchy, per role.
 *
 * A capability says what you may do; rank says who you may do it to, which is a different question with a different
 * answer — an `admin` holds `user:set-role` and still may not touch a peer. The numbers are declared here so the seed
 * and the future `roles` table share one source.
 */
export const ROLE_RANK: Readonly<Record<string, number>> = {
	superAdmin: 3,
	admin: 2,
	operator: 1,
	viewer: 0,
	// Below every platform role: the baseline cannot administer anything, including a peer.
	user: -1,
	owner: 3,
	maintainer: 2,
	deployer: 1,
	member: 0,
};

/** The permissions a system role grants, in catalog order (used by the web and by the legacy store). */
export function capabilitiesOfRole(role: string): readonly Permission[] {
	const definition = (SYSTEM_ROLES as Record<string, { bundles: readonly BundleName[] } | undefined>)[role];
	if (definition === undefined) return [];
	const granted = new Set<Permission>();
	for (const bundle of definition.bundles) {
		for (const permission of BUNDLES[bundle]) granted.add(permission);
	}
	return Object.keys(PERMISSIONS).filter((permission): permission is Permission => granted.has(permission as Permission));
}

/** Whether a permission belongs to a role, without materializing the whole set. */
export function roleGrants(role: string, permission: Permission): boolean {
	return capabilitiesOfRole(role).includes(permission);
}

/**
 * The roles this product ships with, as one table.
 *
 * This is the seed a `roles` table would be populated from, and the default a `PermissionStore` reads. Keeping it a
 * `RoleTable` (rather than a bare record of bundles) is what lets a deployment replace it with rows without touching a
 * call site: everything downstream asks `permissionsInRoles`/`rankInRoles`, never `SYSTEM_ROLES`.
 */
export const SYSTEM_ROLES_TABLE: RoleTable = roleTable(
	(Object.entries(SYSTEM_ROLES) as [string, { scope: ScopeKind; bundles: readonly BundleName[] }][]).map(
		([name, definition]) => ({
			name,
			scope: definition.scope,
			rank: ROLE_RANK[name] ?? 0,
			permissions: capabilitiesOfRole(name),
			label: name,
		}),
	),
	{ system: true },
);
