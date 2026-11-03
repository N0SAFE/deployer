import { createAuthzBuilder } from "./builder";

/**
 * THE authz declaration.
 *
 * The only place a permission, a bundle or a role is declared. `build()` derives the `Permission` union, the statement a
 * transport receives, each role's permission set, the role table, the rank map and the zod schemas from this one chain.
 *
 * Roles are data: `owner`/`maintainer`/… are project-scoped rows, not a second platform. A check names a permission and a
 * scope; it never names a role.
 */
const builder = createAuthzBuilder()
	.resources(({ actions }) => ({
		// ── platform ─────────────────────────────────────────────────────────────────────────────────────────
		settings: actions({
			read: { risk: "read", description: "See platform settings." },
			manage: { risk: "admin", description: "Change platform settings." },
		}),
		audit: actions({
			read: { risk: "read", description: "Read the audit log." },
			// Deliberately NOT in `platform-read`: exporting the whole trail is a wider disclosure than browsing a page
			// of it, and the agent-token default excludes it for the same reason.
			export: { risk: "read", description: "Export the audit log." },
		}),
		user: actions({
			list: { risk: "read", description: "List platform users." },
			get: { risk: "read", description: "Read one user's record." },
			create: { risk: "write", description: "Create a user or invite one." },
			update: { risk: "write", description: "Edit a user's profile and status." },
			delete: { risk: "destructive", description: "Remove a user from the platform." },
			ban: { risk: "admin", description: "Ban a user and end their sessions." },
			unban: { risk: "write", description: "Lift a ban." },
			"set-role": { risk: "admin", description: "Change a user's platform role." },
			"set-password": { risk: "admin", description: "Set a user's password." },
			"set-email": { risk: "admin", description: "Change a user's email address." },
			impersonate: { risk: "admin", description: "Act as another user." },
			"impersonate-admins": { risk: "admin", description: "Act as another administrator." },
		}),
		session: actions({
			list: { risk: "read", description: "List a user's sessions." },
			revoke: { risk: "write", description: "Revoke one session." },
			delete: { risk: "write", description: "Delete every session of a user." },
		}),
		role: actions({
			read: { risk: "read", description: "See roles and their permissions." },
			write: { risk: "admin", description: "Create or edit custom roles." },
			assign: { risk: "admin", description: "Grant or revoke roles and permissions." },
		}),
		token: actions({
			create: { risk: "write", description: "Mint an API or deploy token." },
			revoke: { risk: "write", description: "Revoke a token." },
		}),
		cluster: actions({
			read: { risk: "read", description: "See the cluster, its nodes and services." },
			operate: { risk: "write", description: "Update cluster and node settings." },
			"join-token:reveal": { risk: "reveal", description: "Reveal a swarm join token." },
		}),
		node: actions({
			read: { risk: "read", description: "See node status, metrics and capacity." },
			operate: { risk: "write", description: "Drain, promote or update a node." },
			revoke: { risk: "destructive", description: "Remove a node from the cluster." },
		}),
		registry: actions({
			read: { risk: "read", description: "See registries." },
			write: { risk: "write", description: "Add or change a registry and its credentials." },
		}),
		edge: actions({
			read: { risk: "read", description: "See the edge and ingress state." },
			manage: { risk: "write", description: "Change the edge provider, tunnels and ingress." },
		}),
		"dns.provider": actions({
			read: { risk: "read", description: "See DNS providers." },
			write: { risk: "write", description: "Add or change a DNS provider." },
		}),
		mesh: actions({
			read: { risk: "read", description: "See the mesh roster and replicas." },
			operate: { risk: "write", description: "Join, block or rotate the mesh." },
		}),
		"platform.secret": actions({
			reveal: { risk: "reveal", description: "Reveal a platform secret." },
		}),

		// ── project ──────────────────────────────────────────────────────────────────────────────────────────
		project: actions({
			read: { risk: "read", description: "See a project." },
			write: { risk: "write", description: "Edit a project." },
			delete: { risk: "destructive", description: "Delete a project and everything in it." },
		}),
		member: actions({
			read: { risk: "read", description: "See the project's members." },
			invite: { risk: "write", description: "Invite a member to the project." },
			"role:write": { risk: "admin", description: "Change a member's project role." },
			remove: { risk: "write", description: "Remove a member from the project." },
		}),
		"env.var": actions({
			read: { risk: "read", description: "See a project's environment variables." },
			write: { risk: "write", description: "Change a project's environment variables." },
		}),
		secret: actions({
			reveal: { risk: "reveal", description: "Reveal a stored secret value." },
		}),
		domain: actions({
			read: { risk: "read", description: "See a project's domains." },
			write: { risk: "write", description: "Attach or remove a domain." },
			verify: { risk: "write", description: "Verify domain ownership." },
		}),
		"dns.record": actions({
			read: { risk: "read", description: "See DNS records." },
			write: { risk: "write", description: "Create or change DNS records." },
		}),
		template: actions({
			read: { risk: "read", description: "See templates." },
			write: { risk: "write", description: "Create or change templates." },
		}),
		webhook: actions({
			read: { risk: "read", description: "See webhooks." },
			write: { risk: "write", description: "Create or change a webhook and its secret." },
		}),
		service: actions({
			read: { risk: "read", description: "See a service." },
			create: { risk: "write", description: "Create a service." },
			update: { risk: "write", description: "Edit a service." },
			deploy: { risk: "write", description: "Deploy a service." },
			delete: { risk: "destructive", description: "Delete a service." },
		}),
		deployment: actions({
			read: { risk: "read", description: "See deployments." },
			create: { risk: "write", description: "Start a deployment." },
			cancel: { risk: "write", description: "Cancel a running deployment." },
			rollback: { risk: "destructive", description: "Roll back to a previous deployment." },
			"logs:read": { risk: "read", description: "Read deployment logs and streams." },
		}),
		container: actions({
			read: { risk: "read", description: "See containers, images, networks and volumes." },
			write: { risk: "write", description: "Start, stop, restart or remove a container." },
			exec: { risk: "reveal", description: "Open a shell in a container." },
			"files:write": { risk: "write", description: "Write, delete or rename files in a container." },
		}),
	}))
	.bundles(({ permissions }) => ({
		"platform-read": permissions({
			settings: ["read"],
			audit: ["read"],
			user: ["list", "get"],
			role: ["read"],
			cluster: ["read"],
			node: ["read"],
			registry: ["read"],
			edge: ["read"],
			"dns.provider": ["read"],
			mesh: ["read"],
		}),
		"platform-admin": permissions({
			audit: ["export"],
			settings: ["manage"],
			role: ["write", "assign"],
			user: ["create", "update", "ban", "unban", "set-role", "set-password", "set-email"],
			session: ["delete"],
			token: ["create", "revoke"],
		}),
		"platform-operate": permissions({
			cluster: ["operate"],
			node: ["operate"],
			registry: ["write"],
			edge: ["manage"],
			mesh: ["operate"],
			"dns.provider": ["write"],
			session: ["list", "revoke"],
		}),
		"platform-danger": permissions({
			user: ["delete", "impersonate", "impersonate-admins"],
			node: ["revoke"],
			cluster: ["join-token:reveal"],
			"platform.secret": ["reveal"],
		}),
		"project-admin": permissions({
			project: ["read", "write", "delete"],
			service: ["delete"],
			member: ["read", "invite", "role:write", "remove"],
			"env.var": ["read", "write"],
			secret: ["reveal"],
			domain: ["read", "write", "verify"],
			"dns.record": ["read", "write"],
			template: ["read", "write"],
			webhook: ["read", "write"],
		}),
		deploy: permissions({
			service: ["read", "create", "update", "deploy"],
			deployment: ["read", "create", "cancel", "rollback", "logs:read"],
		}),
		"project-read": permissions({
			project: ["read"],
			member: ["read"],
			"env.var": ["read"],
			domain: ["read"],
			"dns.record": ["read"],
			service: ["read"],
			deployment: ["read", "logs:read"],
			container: ["read"],
		}),
		docker: permissions({
			container: ["read", "write", "exec", "files:write"],
		}),
	}))
	.roles(() => ({
		// ── platform ─────────────────────────────────────────────────────────────────────────────────────────
		superAdmin: {
			scope: "platform",
			rank: 3,
			label: "Super Admin",
			description: "Full platform access including system configuration.",
			color: "red",
			bundles: "all",
		},
		admin: {
			scope: "platform",
			rank: 2,
			label: "Admin",
			description: "Platform administration without system access.",
			color: "orange",
			bundles: ["platform-read", "platform-admin", "platform-operate", "docker"],
		},
		operator: {
			scope: "platform",
			rank: 1,
			label: "Operator",
			description: "Runtime operations and observability access.",
			color: "cyan",
			bundles: ["platform-read", "platform-operate", "docker"],
		},
		viewer: {
			scope: "platform",
			rank: 0,
			label: "Viewer",
			description: "Read-only platform access.",
			color: "slate",
			bundles: ["platform-read"],
		},
		user: {
			// The database default for a new account: an account with no capability at all.
			scope: "platform",
			rank: -1,
			label: "User",
			description: "A signed-in account with no platform-level access.",
			color: "slate",
			bundles: [],
		},

		// ── project ──────────────────────────────────────────────────────────────────────────────────────────
		owner: {
			scope: "project",
			rank: 3,
			label: "Owner",
			description: "Full control of the project.",
			color: "red",
			bundles: ["project-admin", "deploy", "project-read", "docker"],
		},
		maintainer: {
			scope: "project",
			rank: 2,
			label: "Maintainer",
			description: "Deploy and manage services, without project administration.",
			color: "orange",
			bundles: ["deploy", "project-read", "docker"],
		},
		deployer: {
			scope: "project",
			rank: 1,
			label: "Deployer",
			description: "Deploy services.",
			color: "cyan",
			bundles: ["deploy"],
		},
		member: {
			scope: "project",
			rank: 0,
			label: "Member",
			description: "Read-only access to the project.",
			color: "slate",
			bundles: ["project-read"],
		},
	}));

/** The built model: statement, permissions, bundles, roles, ranks, table and schemas. */
export const authz = builder.build();

/** Every permission, with its risk and description. */
export const PERMISSIONS = authz.permissions;
/** Product concepts, so an administrator edits "deploy" rather than fifty checkboxes. */
export const BUNDLES = authz.bundles;
/** Role -> the `{ scope, bundles }` a `roles` table is seeded from. */
export const SYSTEM_ROLES = authz.systemRoles;
/** Position in the hierarchy, per role. */
export const ROLE_RANK = authz.ranks;
/** The roles this product ships with, as data. */
export const SYSTEM_ROLES_TABLE = authz.roleTable;
/** The transport view Better Auth (and the admin middleware) receive. */
export const STATEMENT = authz.statement;

// `role` is dynamic (a stored `user.role`): an unknown name must answer "no capabilities", not fail to type-check.
export const capabilitiesOfRole = (role: string): readonly Permission[] =>
	authz.capabilitiesOfRole(role as SystemRole);
export const roleGrants = (role: string, permission: Permission): boolean =>
	authz.roleGrants(role as SystemRole, permission);

export type { Risk, ScopeKind } from "./builder";
/** A permission's definition (risk + description); the name the catalog used before the builder owned it. */
export type PermissionDefinition = (typeof PERMISSIONS)[Permission];
export type Permission = keyof typeof PERMISSIONS;
export type BundleName = keyof typeof BUNDLES;
export type SystemRole = keyof typeof SYSTEM_ROLES;
export type RoleName = keyof typeof SYSTEM_ROLES;
export type PlatformRole = (typeof authz.platformRoles)[number];
export type ProjectRole = (typeof authz.projectRoles)[number];

/** Every permission of a resource, as the statement declares it. */
export type ActionsOf<Resource extends keyof typeof STATEMENT> = (typeof STATEMENT)[Resource][number];
