// ============================================================================
// PERMISSION SYSTEM EXPORTS
// ============================================================================

// Export all system classes and types (PermissionBuilder, RoleBuilder, etc.)
export * from "./system";

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
} from "./config";

// Platform builder (for generic plugin type inference)
export { platformBuilder } from "./config";

// Platform roles
export {
    PLATFORM_ROLES,
    type PlatformRole,
} from "./config";

// Platform resources
export {
    PLATFORM_RESOURCES,
    type PlatformResource,
    type PlatformActionsForResource,
} from "./config";

// ============================================================================
// ============================================================================
// PROJECT ROLE EXPORTS
// ============================================================================

export {
    PROJECT_ROLES,
    type ProjectRole,
    projectRoleMeta,
} from "./config";

// ============================================================================
// COMMON PERMISSIONS & UTILITIES
// ============================================================================

// Export platform permission bundles
export {
    platformPermissions,
    type PlatformPermissionKeys,
    type PlatformPermission,
} from "./common";

// Export schema helpers
export {
    platformSchemaHelpers,
} from "./common";

// Export utilities
export * from './utils';

// Export access control utilities
export * from './access-control';

// ============================================================================
// PERMISSION ENGINE (resource-rule evaluation)
// ============================================================================

// Core engine: PermissionEngine, ForbiddenError, types, resource graph,
// filter matcher, and rule validator exported from a single entry point.
export * from './engine';

// ============================================================================
// PLUGIN WRAPPERS (V2 PERMISSIONS)
// ============================================================================

// Export plugin system (registry, base types, auth-with-plugins)
export * from './plugins';
