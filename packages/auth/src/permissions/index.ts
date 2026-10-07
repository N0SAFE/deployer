// ============================================================================
// PERMISSION SYSTEM EXPORTS
// ============================================================================

// Export all system classes and types (PermissionBuilder, RoleBuilder, etc.)
export * from "@repo/auth/permissions/system/index";

// ============================================================================
// PLATFORM PERMISSION EXPORTS
// ============================================================================

// Platform permission configuration
export {
    platformPermissionConfig,
    platformStatement,
    platformAc,
    platformRoles,
    platformSchemas,
    platformRoleMeta,
    platformRolesConfig,
} from "@repo/auth/permissions/config";

// Platform builder (for generic plugin type inference)
export { platformBuilder } from "@repo/auth/permissions/config";

// Platform roles
export {
    PLATFORM_ROLES,
    type PlatformRole,
} from "@repo/auth/permissions/config";

// Platform resources
export {
    PLATFORM_RESOURCES,
    type PlatformResource,
    type PlatformActionsForResource,
} from "@repo/auth/permissions/config";

// ============================================================================
// ============================================================================
// PROJECT ROLE EXPORTS
// ============================================================================

export {
    PROJECT_ROLES,
    type ProjectRole,
    projectRoleMeta,
} from "@repo/auth/permissions/config";

// ============================================================================
// COMMON PERMISSIONS & UTILITIES
// ============================================================================

// Export platform permission bundles
export {
    platformPermissions,
    type PlatformPermissionKeys,
    type PlatformPermission,
} from "@repo/auth/permissions/common";

// Export schema helpers
export {
    platformSchemaHelpers,
} from "@repo/auth/permissions/common";

// Export utilities
export * from '@repo/auth/permissions/utils';

// Export access control utilities
export * from '@repo/auth/permissions/access-control';

// ============================================================================
// PERMISSION ENGINE (resource-rule evaluation)
// ============================================================================

// Core engine: PermissionEngine, ForbiddenError, types, resource graph,
// filter matcher, and rule validator exported from a single entry point.
export * from '@repo/auth/permissions/engine/index';

// ============================================================================
// PLUGIN WRAPPERS (V2 PERMISSIONS)
// ============================================================================

// Export plugin system (registry, base types, auth-with-plugins)
export * from '@repo/auth/permissions/plugins/index';
