import { PermissionBuilder } from "./system/builder/builder";

/**
 * Permission Configuration for the Deployer Platform
 * 
 * This configuration defines:
 * 1. Resources: The entities that can be accessed/modified
 * 2. Actions: What can be done with each resource
 * 3. Roles: Named permission sets for different user types
 * 
 * Role Hierarchy:
 * - superAdmin: Platform-level admin with full access to everything
 * - admin: Standard admin, can manage users and organizations
 * - user: Default role for regular users
 * 
 * Organization Roles (within orgs - handled by Better Auth organization plugin):
 * - owner: Full organization access including deletion
 * - admin: Organization management, cannot delete org
 * - member: Standard member access
 * 
 * Project Roles (within projects - stored in projectCollaborators table):
 * - owner, admin, developer, viewer
 */

// Build permissions from scratch (not using defaultRoles)
const builder = new PermissionBuilder()
    // ==========================================
    // RESOURCES & ACTIONS
    // ==========================================
    .resources(({ actions }) => ({
        // Core platform resources
        user: actions([
            'list',           // List all users
            'read',           // View user details
            'create',         // Create new users
            'update',         // Update user details
            'delete',         // Delete users
            'ban',            // Ban/unban users
            'setRole',        // Change user roles
            'setPassword',    // Reset user passwords
            'impersonate',    // Impersonate users
        ] as const),
        
        session: actions([
            'list',           // List sessions
            'read',           // View session details
            'revoke',         // Revoke sessions
            'delete',         // Delete sessions
        ] as const),
        
        organization: actions([
            'list',           // List organizations
            'read',           // View organization details
            'create',         // Create organizations
            'update',         // Update organization settings
            'delete',         // Delete organizations
            'manageMembers',  // Add/remove/update members
            'manageInvites',  // Create/revoke invitations
        ] as const),
        
        // Deployment resources
        project: actions([
            'list',           // List projects
            'read',           // View project details
            'create',         // Create projects
            'update',         // Update project settings
            'delete',         // Delete projects
            'deploy',         // Trigger deployments
            'manageCollaborators', // Add/remove collaborators
        ] as const),
        
        service: actions([
            'list',           // List services
            'read',           // View service details
            'create',         // Create services
            'update',         // Update service config
            'delete',         // Delete services
            'deploy',         // Deploy service
            'scale',          // Scale replicas
            'restart',        // Restart service
        ] as const),
        
        deployment: actions([
            'list',           // List deployments
            'read',           // View deployment details
            'create',         // Create/trigger deployments
            'cancel',         // Cancel running deployments
            'rollback',       // Rollback to previous deployment
            'logs',           // View deployment logs
        ] as const),
        
        environment: actions([
            'list',           // List environments/variables
            'read',           // View environment details
            'create',         // Create environment variables
            'update',         // Update environment variables
            'delete',         // Delete environment variables
        ] as const),
        
        // Infrastructure resources
        traefik: actions([
            'read',           // View Traefik config
            'update',         // Update routing rules
            'sync',           // Force sync configuration
        ] as const),
        
        domain: actions([
            'list',           // List domains
            'read',           // View domain details
            'create',         // Add domains
            'update',         // Update domain config
            'delete',         // Remove domains
            'verifySsl',      // Verify/renew SSL
        ] as const),
        
        // Integration resources
        webhook: actions([
            'list',           // List webhooks
            'read',           // View webhook details
            'create',         // Create webhooks
            'update',         // Update webhook config
            'delete',         // Delete webhooks
            'test',           // Test webhook delivery
        ] as const),
        
        apiKey: actions([
            'list',           // List API keys
            'read',           // View API key details
            'create',         // Create API keys
            'delete',         // Delete API keys
            'regenerate',     // Regenerate API key
        ] as const),
        
        github: actions([
            'list',           // List GitHub installations
            'read',           // View GitHub integration details
            'connect',        // Connect GitHub account
            'disconnect',     // Disconnect GitHub account
            'sync',           // Sync repositories
        ] as const),
        
        // Monitoring & Analytics
        analytics: actions([
            'view',           // View analytics dashboards
            'export',         // Export analytics data
        ] as const),
        
        healthCheck: actions([
            'view',           // View health status
            'trigger',        // Manually trigger health checks
        ] as const),
        
        logs: actions([
            'view',           // View logs
            'search',         // Search logs
            'export',         // Export logs
        ] as const),
        
        // System administration
        system: actions([
            'view',           // View system status
            'configure',      // Update system configuration
            'maintenance',    // Enable/disable maintenance mode
        ] as const),
        
        setup: actions([
            'initialize',     // Run initial setup
        ] as const),
    }))
    // ==========================================
    // ROLES & PERMISSIONS
    // ==========================================
    /**
     * Super Admin - Platform administrator with full access
     * Only assigned to initial setup user and critical system admins
     */
    .role('superAdmin').allPermissions()
    .roles(({ permissions }) => ({
        /**
         * Admin - Standard administrator
         * Can manage users and organizations but no system-level access
         */
        admin: permissions({
            user: ['list', 'read', 'create', 'update', 'ban', 'setRole'],
            session: ['list', 'read', 'revoke'],
            organization: ['list', 'read', 'create', 'update', 'manageMembers', 'manageInvites'],
            project: ['list', 'read', 'create', 'update', 'delete', 'deploy', 'manageCollaborators'],
            service: ['list', 'read', 'create', 'update', 'delete', 'deploy', 'scale', 'restart'],
            deployment: ['list', 'read', 'create', 'cancel', 'rollback', 'logs'],
            environment: ['list', 'read', 'create', 'update', 'delete'],
            traefik: ['read'],
            domain: ['list', 'read', 'create', 'update', 'delete', 'verifySsl'],
            webhook: ['list', 'read', 'create', 'update', 'delete', 'test'],
            apiKey: ['list', 'read', 'create', 'delete', 'regenerate'],
            github: ['list', 'read', 'connect', 'disconnect', 'sync'],
            analytics: ['view', 'export'],
            healthCheck: ['view', 'trigger'],
            logs: ['view', 'search', 'export'],
            system: ['view'],
        }),
        
        /**
         * User - Standard authenticated user
         * Can manage own resources, work within organizations they belong to
         */
        user: permissions({
            user: ['read'],
            session: ['list', 'read', 'revoke'],
            organization: ['list', 'read', 'create'],
            project: ['list', 'read', 'create', 'update', 'deploy'],
            service: ['list', 'read', 'create', 'update', 'deploy', 'scale', 'restart'],
            deployment: ['list', 'read', 'create', 'cancel', 'logs'],
            environment: ['list', 'read', 'create', 'update'],
            traefik: ['read'],
            domain: ['list', 'read', 'create', 'update'],
            webhook: ['list', 'read', 'create', 'update', 'delete'],
            apiKey: ['list', 'read', 'create', 'delete'],
            github: ['list', 'read', 'connect', 'disconnect', 'sync'],
            analytics: ['view'],
            healthCheck: ['view'],
            logs: ['view', 'search'],
        }),
    }));

export const permissionConfig = builder.build();
export const { statement, ac, roles, schemas } = permissionConfig;

// Type exports for use in other modules
export type PermissionStatement = typeof statement;
export type PermissionRoles = typeof roles;
export type RoleName = keyof typeof roles;
