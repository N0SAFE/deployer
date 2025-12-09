import { schemas } from "./config";

/**
 * Common permission definitions that can be reused across the application
 */
export const commonPermissions = {
    // ==========================================
    // Project Permissions (for project collaborators)
    // ==========================================
    
    // Project owner - full control
    projectOwner: {
        project: ["list", "read", "update", "delete", "deploy", "manageCollaborators"] as const,
        service: ["list", "read", "create", "update", "delete", "deploy", "scale", "restart"] as const,
        deployment: ["list", "read", "create", "cancel", "rollback", "logs"] as const,
        environment: ["list", "read", "create", "update", "delete"] as const,
        domain: ["list", "read", "create", "update", "delete", "verifySsl"] as const,
        webhook: ["list", "read", "create", "update", "delete", "test"] as const,
        apiKey: ["list", "read", "create", "delete", "regenerate"] as const,
        logs: ["view", "search", "export"] as const,
    },
    
    // Project admin - manage but cannot delete project
    projectAdmin: {
        project: ["list", "read", "update", "deploy", "manageCollaborators"] as const,
        service: ["list", "read", "create", "update", "delete", "deploy", "scale", "restart"] as const,
        deployment: ["list", "read", "create", "cancel", "rollback", "logs"] as const,
        environment: ["list", "read", "create", "update", "delete"] as const,
        domain: ["list", "read", "create", "update", "delete", "verifySsl"] as const,
        webhook: ["list", "read", "create", "update", "delete", "test"] as const,
        apiKey: ["list", "read", "create", "delete"] as const,
        logs: ["view", "search", "export"] as const,
    },
    
    // Project developer - create and deploy
    projectDeveloper: {
        project: ["list", "read", "deploy"] as const,
        service: ["list", "read", "create", "update", "deploy", "restart"] as const,
        deployment: ["list", "read", "create", "cancel", "logs"] as const,
        environment: ["list", "read", "create", "update"] as const,
        domain: ["list", "read"] as const,
        webhook: ["list", "read", "create", "update"] as const,
        apiKey: ["list", "read", "create"] as const,
        logs: ["view", "search"] as const,
    },
    
    // Project viewer - read only
    projectViewer: {
        project: ["list", "read"] as const,
        service: ["list", "read"] as const,
        deployment: ["list", "read", "logs"] as const,
        environment: ["list", "read"] as const,
        domain: ["list", "read"] as const,
        webhook: ["list", "read"] as const,
        logs: ["view"] as const,
    },
    
    // ==========================================
    // Organization Permissions
    // ==========================================
    
    // Organization owner - full control
    organizationOwner: {
        organization: ["list", "read", "update", "delete", "manageMembers", "manageInvites"] as const,
        project: ["list", "read", "create", "update", "delete", "deploy", "manageCollaborators"] as const,
        analytics: ["view", "export"] as const,
    },
    
    // Organization admin - manage but cannot delete
    organizationAdmin: {
        organization: ["list", "read", "update", "manageMembers", "manageInvites"] as const,
        project: ["list", "read", "create", "update", "deploy", "manageCollaborators"] as const,
        analytics: ["view"] as const,
    },
    
    // Organization member - basic access
    organizationMember: {
        organization: ["list", "read"] as const,
        project: ["list", "read", "create", "deploy"] as const,
    },
    
    // ==========================================
    // User Management Permissions
    // ==========================================
    
    // User management - for admins
    userManagement: {
        user: ["list", "read", "create", "update", "ban", "setRole"] as const,
        session: ["list", "read", "revoke"] as const,
    },
    
    // User self - for users managing their own account
    userSelf: {
        user: ["read"] as const,
        session: ["list", "read", "revoke"] as const,
        apiKey: ["list", "read", "create", "delete"] as const,
    },
    
    // ==========================================
    // System Permissions
    // ==========================================
    
    // Full system access - for superAdmin
    systemFull: {
        system: ["view", "configure", "maintenance"] as const,
        setup: ["initialize"] as const,
        traefik: ["read", "update", "sync"] as const,
        healthCheck: ["view", "trigger"] as const,
    },
    
    // Read-only system access
    systemReadOnly: {
        system: ["view"] as const,
        healthCheck: ["view"] as const,
        traefik: ["read"] as const,
    },
} as const;

/**
 * Common schema definitions for permission validation
 */
export const commonSchemas = {
    // Schema for read-only actions across all resources
    readOnlyActions: schemas.actions.only("list", "read"),

    // Schema for write actions (create, update, delete)
    writeActions: schemas.actions.filter((action): action is "create" | "update" | "delete" => 
        /create|update|delete/.test(action)
    ),

    // Schema for deployment actions
    deploymentActions: schemas.actions.forResource("deployment"),

    // Schema for dangerous/destructive actions
    destructiveActions: schemas.actions.only("delete"),

    // Schema for safe actions (excluding delete)
    safeActions: schemas.actions.excluding("delete"),

    // Custom permission schemas
    readOnlyPermission: schemas.actions.customPermission({
        project: ["list", "read"] as const,
        service: ["list", "read"] as const,
    }),

    // Schema for superAdmin permissions
    superAdminAllActions: schemas.actions.forRole("superAdmin"),

    // Schema for admin actions
    adminAllActions: schemas.actions.forRole("admin"),

    // Schema for user actions
    userAllActions: schemas.actions.forRole("user"),
} as const;

export type CommonPermissionKeys = keyof typeof commonPermissions;

export type CommonPermission<T extends CommonPermissionKeys> = (typeof commonPermissions)[T];
