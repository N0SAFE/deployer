import { 
    platformSchemas,
    type PlatformRole,
    platformRoles,
} from "./config";

/**
 * Common Permission Definitions
 * 
 * This file provides reusable permission sets that align with the project's
 * dual-layer permission system:
 * 
 * The permission bundles are derived directly from the config to ensure consistency.
 */

// ============================================================================
// RE-EXPORT PERMISSION BUNDLES FROM CONFIG
// ============================================================================

/**
 * Platform permission bundles - derived from platformRoles in config
 * These are the actual permissions assigned to each platform role.
 */
export const platformPermissions = platformRoles;

// ============================================================================
// SCHEMA HELPERS
// ============================================================================

/**
 * Platform-level schema helpers for permission validation
 */
export const platformSchemaHelpers = {
    /** Schema for read-only actions across platform resources */
    readOnlyActions: platformSchemas.actions.only("list"),

    /** Schema for user management actions */
    userManagementActions: platformSchemas.actions.forResource("user"),

    /** Schema for system actions */
    systemActions: platformSchemas.actions.forResource("system"),

    /** Schema for super admin permissions */
    superAdminActions: platformSchemas.actions.forRole("superAdmin"),

    /** Schema for admin permissions */
    adminActions: platformSchemas.actions.forRole("admin"),

    /** Schema for operator permissions */
    operatorActions: platformSchemas.actions.forRole("operator"),

    /** Schema for viewer permissions */
    viewerActions: platformSchemas.actions.forRole("viewer"),
} as const;

// ============================================================================
// TYPE EXPORTS
// ============================================================================

/** Keys for platform permission bundles */
export type PlatformPermissionKeys = PlatformRole;

/** Get the permission bundle type for a platform role */
export type PlatformPermission<T extends PlatformPermissionKeys> = (typeof platformPermissions)[T];


