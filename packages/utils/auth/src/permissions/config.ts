import z from "zod/v4";
import { PermissionBuilder } from "./system/builder/builder";
import { defaultStatements as adminDefaultStatements } from "better-auth/plugins/admin/access";


/**
 * Permission Configuration for the Deployer Platform
 * 
 * This configuration defines platform + scope permission systems.
 *
 * ============================================================================
 * LAYER 1: PLATFORM ROLES (User's global role)
 * ============================================================================
 * These roles define what a user can do across the entire platform.
 * Stored in the user's `role` field.
 * 
 * - superAdmin: Platform-level admin with full access to everything
 * - admin: Standard admin, can manage users and platform settings
 * - operator: Operations-focused role (monitoring + runtime operations)
 * - viewer: Read-only platform visibility
 * 
 * ============================================================================
 * LAYER 2: MESH-WIDE PROJECT ROLES (User's role within a project)
 * ============================================================================
 * These roles define what a collaborator can do within a specific project.
 * Stored in the project collaborators `role` field.
 */

// ============================================================================
// PLATFORM PERMISSION SYSTEM
// ============================================================================

/**
 * Platform-level permission builder
 * Defines resources and roles for platform-wide access control
 */
const platformRoleMetaShape = z.object({
    label: z.string(),
    description: z.string(),
    color: z.string(),
});

const platformBuilder = new PermissionBuilder({ metaShape: platformRoleMetaShape })
    .resources(({ actions }) => ({
        // ========================================
        // USER & SESSION MANAGEMENT (Platform-wide)
        // ========================================
        user: actions(adminDefaultStatements.user),
        session: actions(adminDefaultStatements.session),
        
        // ========================================
        // PLATFORM ADMINISTRATION
        // ========================================
        system: actions([
            'view',           // View system status/health
            'configure',      // Update system configuration
            'maintenance',    // Enable/disable maintenance mode
            'backup',         // Manage backups
            'audit',          // View audit logs
        ] as const),
        
        setup: actions([
            'initialize',     // Run initial platform setup
            'configure',      // Configure initial settings
        ] as const),
        
        // ========================================
        // PLATFORM-WIDE MONITORING
        // ========================================
        platformAnalytics: actions([
            'view',           // View platform-wide analytics
            'export',         // Export platform analytics
            'configure',      // Configure analytics settings
        ] as const),
        
        platformLogs: actions([
            'view',           // View all platform logs
            'search',         // Search across all logs
            'export',         // Export logs
            'configure',      // Configure log retention
        ] as const),
        
        // ========================================
        // INFRASTRUCTURE (Platform-wide)
        // ========================================
        traefik: actions([
            'read',           // View Traefik config
            'update',         // Update routing rules
            'sync',           // Force sync configuration
        ] as const),
        
        platformDomain: actions([
            'list',           // List all platform domains
            'read',           // View domain details
            'create',         // Add platform domains
            'update',         // Update domain config
            'delete',         // Remove domains
            'verifySsl',      // Verify/renew SSL
        ] as const),
    }))
    // ==========================================
    // PLATFORM ROLES
    // ==========================================
    /**
     * Super Admin - Platform administrator with full access
     * Only assigned to initial setup user and critical system admins
     */
    .role('superAdmin').allPermissions().meta({ label: 'Super Admin', description: 'Full platform access including system configuration', color: 'red' })
    .roles(({ permissions }) => ({
        /**
         * Admin - Standard platform administrator
         * Can manage users and view platform-wide data
         * Cannot access system configuration or maintenance
         */
        admin: permissions({
            user: ['list', 'create', 'update', 'ban', 'set-role'],
            session: ['list', 'revoke'],
            system: ['view'],
            platformAnalytics: ['view', 'export'],
            platformLogs: ['view', 'search', 'export'],
            traefik: ['read'],
            platformDomain: ['list', 'read'],
        }).meta({ label: 'Admin', description: 'Platform administration without system access', color: 'orange' }),

        /**
         * Operator - Runtime operations role
         * Can observe and operate runtime surfaces without full admin powers.
         */
        operator: permissions({
            session: ['list', 'revoke'],
            system: ['view'],
            platformAnalytics: ['view', 'export'],
            platformLogs: ['view', 'search', 'export'],
            traefik: ['read', 'sync'],
            platformDomain: ['list', 'read', 'verifySsl'],
        }).meta({ label: 'Operator', description: 'Runtime operations and observability access', color: 'cyan' }),

        /**
         * Viewer - Read-only platform visibility
         */
        viewer: permissions({
            system: ['view'],
            platformAnalytics: ['view'],
            platformLogs: ['view', 'search'],
            traefik: ['read'],
            platformDomain: ['list', 'read'],
        }).meta({ label: 'Viewer', description: 'Read-only platform access', color: 'slate' }),
        
    }));

// Export the builder for type inference in generic plugins
export { platformBuilder };

// Build and export platform permissions
export const platformPermissionConfig = platformBuilder.build();
export const { 
    statement: platformStatement, 
    ac: platformAc, 
    roles: platformRoles, 
    schemas: platformSchemas,
    rolesConfig: platformRolesConfig,
    roleMeta: platformRoleMeta,
} = platformPermissionConfig;

// ============================================================================
// PROJECT PERMISSION SYSTEM
// ============================================================================

/**
 * Project-level permission builder
 * Defines resources and roles for project-scoped access control
 *
 * These permissions apply to resources WITHIN a project.
 * The current project role set is: owner | maintainer | deployer | viewer.
 */
const projectRoleMetaShape = z.object({
    label: z.string(),
    description: z.string(),
    color: z.string(),
});

const projectBuilder = new PermissionBuilder({ metaShape: projectRoleMetaShape })
    .resources(({ actions }) => ({
        // ========================================
        // PROJECT MANAGEMENT
        // ========================================
        project: actions([
            'read',                  // View project details and settings
            'update',                // Update project name, description, settings
            'delete',                // Delete the project
            'manageCollaborators',   // Invite, update, or remove collaborators
        ] as const),

        // ========================================
        // SERVICES
        // ========================================
        service: actions([
            'read',     // View service configuration and status
            'create',   // Add a new service to the project
            'update',   // Update service configuration
            'delete',   // Remove a service
        ] as const),

        // ========================================
        // DEPLOYMENTS
        // ========================================
        deployment: actions([
            'read',     // View deployment history and status
            'create',   // Trigger a new deployment
            'cancel',   // Cancel an in-progress deployment
            'delete',   // Delete deployment records
            'rollback', // Roll back to a previous deployment
        ] as const),

        // ========================================
        // ENVIRONMENTS
        // ========================================
        environment: actions([
            'read',     // View environment configuration
            'create',   // Create a new environment
            'update',   // Update environment settings
            'delete',   // Delete an environment
        ] as const),

        // ========================================
        // LOGS & MONITORING
        // ========================================
        logs: actions([
            'read',     // View service and deployment logs
            'export',   // Export logs
        ] as const),

        // ========================================
        // VARIABLE TEMPLATES
        // ========================================
        template: actions([
            'read',     // View variable templates
            'create',   // Create a new template
            'update',   // Update a template
            'delete',   // Delete a template
        ] as const),
    }))
    // ==========================================
    // PROJECT ROLES
    // ==========================================
    /**
     * Owner - Full project access
     * Can do everything including delete the project and manage collaborators
     */
    .role('owner').allPermissions().meta({ label: 'Owner', description: 'Full project access including deletion and membership management', color: 'amber' })
    .roles(({ permissions }) => ({
        /**
         * Maintainer - Project administrator
         * Can manage most things except delete the project
         */
        maintainer: permissions({
            project: ['read', 'update', 'manageCollaborators'],
            service: ['read', 'create', 'update', 'delete'],
            deployment: ['read', 'create', 'cancel', 'delete', 'rollback'],
            environment: ['read', 'create', 'update', 'delete'],
            logs: ['read', 'export'],
            template: ['read', 'create', 'update', 'delete'],
        }).meta({ label: 'Maintainer', description: 'Project management without deletion capabilities', color: 'purple' }),

        /**
         * Deployer - Development and deployment access
         * Can deploy and manage services, but cannot manage project settings or collaborators
         */
        deployer: permissions({
            project: ['read'],
            service: ['read', 'create', 'update'],
            deployment: ['read', 'create', 'cancel', 'rollback'],
            environment: ['read', 'update'],
            logs: ['read', 'export'],
            template: ['read', 'create', 'update'],
        }).meta({ label: 'Deployer', description: 'Development and deployment access', color: 'blue' }),

        /**
         * Viewer - Read-only access
         * Can view all resources but cannot make any changes
         */
        viewer: permissions({
            project: ['read'],
            service: ['read'],
            deployment: ['read'],
            environment: ['read'],
            logs: ['read'],
            template: ['read'],
        }).meta({ label: 'Viewer', description: 'Read-only access to project resources', color: 'slate' }),
    }));

// Export the builder for type inference
export { projectBuilder };

// Build and export project permissions
export const projectPermissionConfig = projectBuilder.build();
export const {
    statement: projectStatement,
    ac: projectAc,
    roles: projectRoles,
    schemas: projectSchemas,
    rolesConfig: projectRolesConfig,
    roleMeta: projectRoleMeta,
} = projectPermissionConfig;

export type ProjectResource = keyof typeof projectStatement;

// ============================================================================
// PLATFORM ROLE EXPORTS
// ============================================================================

/**
 * Platform role names derived from the builder configuration
 * This ensures the role list stays in sync with the builder definition
 */
export const PLATFORM_ROLES = platformBuilder.getRoleNames();

/**
 * Type representing valid platform role names
 */
export type PlatformRole = typeof PLATFORM_ROLES[number];

// ============================================================================
// PROJECT ROLE EXPORTS
// ============================================================================

/**
 * Project collaborator role names derived from the builder configuration
 */
export const PROJECT_ROLES = projectBuilder.getRoleNames();

/**
 * Type representing valid project collaborator roles
 */
export type ProjectRole = typeof PROJECT_ROLES[number];

// ============================================================================
// RESOURCE EXPORTS
// ============================================================================

/**
 * Platform resource names derived from the builder configuration
 */
export type PlatformResource = keyof typeof platformStatement;
export const PLATFORM_RESOURCES = platformBuilder.getStatementNames();

/**
 * Project resource names derived from the builder configuration
 */
export const PROJECT_RESOURCES = projectBuilder.getStatementNames();

/**
 * Type representing all valid actions for a specific platform resource
 */
export type PlatformActionsForResource<R extends PlatformResource> = typeof platformStatement[R][number];

/**
 * Type representing all valid actions for a specific project resource
 */
export type ProjectActionsForResource<R extends ProjectResource> = typeof projectStatement[R][number];




