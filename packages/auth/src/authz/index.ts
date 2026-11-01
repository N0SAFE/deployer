/**
 * Authorization for the whole stack: one catalog, one pure decision, one declaration helper.
 *
 * This entry is dependency-free on purpose (no Effect, no oRPC, no Nest, no React) so the **web app** imports exactly the
 * same vocabulary as the API: a capability check in a component cannot disagree with the server's because both read
 * `PERMISSIONS`, `BUNDLES` and `SYSTEM_ROLES` from here. The Effect service and the oRPC gate live in
 * `@deployer/nest-effect/authz`, which only the server loads.
 */
export {
	BUNDLES,
	PERMISSIONS,
	SYSTEM_ROLES,
	capabilitiesOfRole,
	roleGrants,
	type BundleName,
	type Permission,
	type PermissionDefinition,
	type Risk,
	type ScopeKind,
	type SystemRole,
} from "./catalog";
export { can, conditionFailure, decide } from "./evaluate";
export {
	PLATFORM_ROLE_ORDER,
	isPlatformAdministrator,
	platformRoleRank,
	refuseAdminAction,
	refuseRoleGrant,
	type HierarchyRefusal,
	type PlatformRoleName,
} from "./hierarchy";
export {
	AuthzDenied,
	PLATFORM_SCOPE,
	type AccessDeclaration,
	type AccessRequirement,
	type Actor,
	type CapabilitySet,
	type Condition,
	type Decision,
	type Facts,
	type Scope,
} from "./types";
