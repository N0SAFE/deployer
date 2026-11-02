import { createAccessControl } from "better-auth/plugins/access";

import type { Role } from "better-auth/plugins/access";

import {
	PLATFORM_RESOURCES,
	PLATFORM_ROLES,
	PROJECT_RESOURCES,
	PROJECT_ROLES,
	platformPermissionConfig as platformModel,
	platformRoleMeta,
	platformRolesConfig,
	platformSchemas,
	projectPermissionConfig as projectModel,
	projectRoleMeta,
	projectRolesConfig,
	projectSchemas,
} from "../../authz/platform";

/**
 * The Better Auth view of the platform model.
 *
 * `authz/platform.ts` declares the product's roles and permissions; this file CONVERTS that model into the objects Better
 * Auth consumes — an access-control instance and one `Role` per system role. Nothing is declared here: a role or a
 * permission that existed only in this file would be a second policy, which is exactly what this adapter avoids.
 */
function convert<TRoles extends Record<string, Record<string, readonly string[]>>>(
	statement: Record<string, readonly string[]>,
	roles: TRoles,
) {
	const ac = createAccessControl(statement);
	const converted = Object.fromEntries(
		Object.entries(roles).map(([name, permissions]) => [name, ac.newRole(permissions as never)]),
	) as unknown as { readonly [K in keyof TRoles]: Role };
	return { ac, roles: converted };
}

/* ── platform ─────────────────────────────────────────────────────────────────────────────────────────────────── */

const platform = convert(platformModel.statement, platformModel.roles);

/** Better Auth access-control instance, built from the authz platform statement. */
export const platformAc = platform.ac;

/** One Better Auth `Role` per platform role, built from the authz permission maps. */
export const platformRoles = platform.roles;

export { platformRoleMeta, platformRolesConfig, platformSchemas, PLATFORM_RESOURCES, PLATFORM_ROLES };
export type { PlatformActionsForResource, PlatformResource, PlatformRole } from "../../authz/platform";

/** Everything a caller may need about the platform model, in its Better Auth form. */
export const platformPermissionConfig = {
	...platformModel,
	ac: platformAc,
	roles: platformRoles,
} as const;

/**
 * A builder-shaped handle for the plugin framework.
 *
 * The middleware layer is generic over a builder to infer statement and role names; it needs those two plus the Better
 * Auth pair. Presenting the converted model in the same shape keeps that inference intact without the middleware
 * importing Better Auth itself.
 */
export const platformBuilder = {
	getAc: () => platformAc,
	getRoles: () => platformRoles,
	getStatement: () => platformModel.statement,
	getStatementNames: () => Object.keys(platformModel.statement),
	getRoleNames: () => Object.keys(platformModel.roles),
	getRoleMeta: () => platformRoleMeta,
	statement: platformModel.statement,
	roles: platformRoles,
} as const;

/* ── project ──────────────────────────────────────────────────────────────────────────────────────────────────── */

const project = convert(projectModel.statement, projectModel.roles);

/** Better Auth access-control instance for project-scoped roles. */
export const projectAc = project.ac;

export const projectRoles = project.roles;

export { projectRoleMeta, projectRolesConfig, projectSchemas, PROJECT_RESOURCES, PROJECT_ROLES };
export type { ProjectActionsForResource, ProjectResource, ProjectRole } from "../../authz/platform";

export const projectPermissionConfig = {
	...projectModel,
	ac: projectAc,
	roles: projectRoles,
} as const;

export const projectBuilder = {
	getAc: () => projectAc,
	getRoles: () => projectRoles,
	getStatement: () => projectModel.statement,
	getStatementNames: () => Object.keys(projectModel.statement),
	getRoleNames: () => Object.keys(projectModel.roles),
	getRoleMeta: () => projectRoleMeta,
	statement: projectModel.statement,
	roles: projectRoles,
} as const;
