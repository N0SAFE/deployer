// The package's stable surface. Each area is also a subpath
// (`@deployer/auth/authz`, `/ac`, `/rules`, `/audit`, `/server`, `/client`, `/react`, `/mesh`), so a consumer can
// import the narrow one it needs instead of the whole package.
//
//   authz  — the capability vocabulary and the pure decision (no Effect, no Nest, no React).
//   ac     — Better Auth access-control configuration, its typed builder, and the role helpers.
//   rules  — the row-level ResourceRule engine (JSONB rules -> SQL filters).
export type { IEnvService, Session, Auth, User, InferSessionFromAuth } from "./types";

export * from "./authz";

// `ac` is exported member by member here: its builder re-exports a low-level `Permission` (a statement map) that would
// shadow the catalog's `Permission` union — the one a permission check must use. The rest is available from
// `@deployer/auth/adapters/better-auth`.
export {
	PLATFORM_RESOURCES,
	PLATFORM_ROLES,
	PROJECT_RESOURCES,
	PROJECT_ROLES,
	platformAc,
	platformBuilder,
	platformPermissionConfig,
	platformRoleMeta,
	platformRoles,
	platformRolesConfig,
	platformSchemas,
	projectBuilder,
	projectPermissionConfig,
	projectRoleMeta,
	type PlatformActionsForResource,
	type PlatformResource,
	type PlatformRole,
	type ProjectActionsForResource,
	type ProjectRole,
} from "./adapters/better-auth/config";

export type { RoleName } from "./authz/definition";

export * from "./rules";
