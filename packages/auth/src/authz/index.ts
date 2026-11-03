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
	ROLE_RANK,
	SYSTEM_ROLES,
	SYSTEM_ROLES_TABLE,
	capabilitiesOfRole,
	roleGrants,
	type BundleName,
	type Permission,
	type PermissionDefinition,
	type Risk,
	type ScopeKind,
	type SystemRole,
} from "./definition";
export { can, conditionFailure, decide } from "./evaluate";
export {
	permissionsInRoles,
	rankInRoles,
	roleTable,
	type RoleDefinition,
	type RoleRow,
	type RoleTable,
} from "./roles";
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
export { STEP_UP_WINDOW_SECONDS, isCriticalStepUp, type StepUpMethod } from "./step-up";
export { IMPERSONATION_TTL_SECONDS, canImpersonate, type ImpersonationRefusal } from "./impersonation";
