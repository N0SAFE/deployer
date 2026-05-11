import z from "zod/v4";
import { PermissionBuilder } from "./system/builder/builder";
import { defaultStatements as adminDefaultStatements } from "better-auth/plugins/admin/access";
import { defaultStatements as organizationDefaultStatements } from 'better-auth/plugins/organization/access';
const platformRoleMetaShape = z.object({
    label: z.string(),
    description: z.string(),
    color: z.string(),
});
const platformBuilder = new PermissionBuilder({ metaShape: platformRoleMetaShape })
    .resources(({ actions }) => ({
    user: actions(adminDefaultStatements.user),
    session: actions(adminDefaultStatements.session),
    system: actions([
        'view',
        'configure',
        'maintenance',
        'backup',
        'audit',
    ]),
    setup: actions([
        'initialize',
        'configure',
    ]),
    platformAnalytics: actions([
        'view',
        'export',
        'configure',
    ]),
    platformLogs: actions([
        'view',
        'search',
        'export',
        'configure',
    ]),
    traefik: actions([
        'read',
        'update',
        'sync',
    ]),
    platformDomain: actions([
        'list',
        'read',
        'create',
        'update',
        'delete',
        'verifySsl',
    ]),
}))
    .role('superAdmin').allPermissions().meta({ label: 'Super Admin', description: 'Full platform access including system configuration', color: 'red' })
    .roles(({ permissions }) => ({
    admin: permissions({
        user: ['list', 'create', 'update', 'ban', 'set-role'],
        session: ['list', 'revoke'],
        system: ['view'],
        platformAnalytics: ['view', 'export'],
        platformLogs: ['view', 'search', 'export'],
        traefik: ['read'],
        platformDomain: ['list', 'read'],
    }).meta({ label: 'Admin', description: 'Platform administration without system access', color: 'orange' }),
    operator: permissions({
        session: ['list', 'revoke'],
        system: ['view'],
        platformAnalytics: ['view', 'export'],
        platformLogs: ['view', 'search', 'export'],
        traefik: ['read', 'sync'],
        platformDomain: ['list', 'read', 'verifySsl'],
    }).meta({ label: 'Operator', description: 'Runtime operations and observability access', color: 'cyan' }),
    viewer: permissions({
        system: ['view'],
        platformAnalytics: ['view'],
        platformLogs: ['view', 'search'],
        traefik: ['read'],
        platformDomain: ['list', 'read'],
    }).meta({ label: 'Viewer', description: 'Read-only platform access', color: 'slate' }),
}));
export { platformBuilder };
export const platformPermissionConfig = platformBuilder.build();
export const { statement: platformStatement, ac: platformAc, roles: platformRoles, schemas: platformSchemas, rolesConfig: platformRolesConfig, roleMeta: platformRoleMeta, } = platformPermissionConfig;
const organizationRoleMetaShape = z.object({
    label: z.string(),
    description: z.string(),
    color: z.string(),
    icon: z.string(),
});
const organizationBuilder = new PermissionBuilder({ metaShape: organizationRoleMetaShape })
    .resources(({ actions }) => ({
    organization: actions(organizationDefaultStatements.organization),
    member: actions(organizationDefaultStatements.member),
    team: actions(organizationDefaultStatements.team),
    invitation: actions(organizationDefaultStatements.invitation),
    ac: actions(organizationDefaultStatements.ac),
}))
    .role('owner').allPermissions().meta({ label: 'Owner', description: 'Full organization access including deletion and ownership transfer', color: 'amber', icon: 'crown' })
    .roles(({ permissions }) => ({
    admin: permissions({
        organization: ['update', 'delete'],
        invitation: ['cancel', 'create'],
        member: ['create', 'delete', 'update'],
        team: ['create', 'delete', 'update'],
    }).meta({ label: 'Admin', description: 'Organization management without delete or transfer capabilities', color: 'purple', icon: 'shield' }),
    member: permissions({}).meta({ label: 'Member', description: 'Standard member with project and service access', color: 'slate', icon: 'user' }),
}));
export { organizationBuilder };
export const organizationPermissionConfig = organizationBuilder.build();
export const { statement: organizationStatement, ac: organizationAc, roles: organizationRoles, schemas: organizationSchemas, rolesConfig: organizationRolesConfig, roleMeta: organizationRoleMeta, } = organizationPermissionConfig;
export const PLATFORM_ROLES = platformBuilder.getRoleNames();
export const ORGANIZATION_ROLES = organizationBuilder.getRoleNames();
const projectRoleMetaShape = z.object({
    label: z.string(),
    description: z.string(),
    color: z.string(),
});
const projectBuilder = new PermissionBuilder({ metaShape: projectRoleMetaShape })
    .resources(({ actions }) => ({
    project: actions([
        'read',
        'update',
        'delete',
        'manageCollaborators',
    ]),
    service: actions([
        'read',
        'create',
        'update',
        'delete',
    ]),
    deployment: actions([
        'read',
        'create',
        'cancel',
        'delete',
        'rollback',
    ]),
    environment: actions([
        'read',
        'create',
        'update',
        'delete',
    ]),
    logs: actions([
        'read',
        'export',
    ]),
    template: actions([
        'read',
        'create',
        'update',
        'delete',
    ]),
}))
    .role('owner').allPermissions().meta({ label: 'Owner', description: 'Full project access including deletion and membership management', color: 'amber' })
    .roles(({ permissions }) => ({
    maintainer: permissions({
        project: ['read', 'update', 'manageCollaborators'],
        service: ['read', 'create', 'update', 'delete'],
        deployment: ['read', 'create', 'cancel', 'delete', 'rollback'],
        environment: ['read', 'create', 'update', 'delete'],
        logs: ['read', 'export'],
        template: ['read', 'create', 'update', 'delete'],
    }).meta({ label: 'Maintainer', description: 'Project management without deletion capabilities', color: 'purple' }),
    deployer: permissions({
        project: ['read'],
        service: ['read', 'create', 'update'],
        deployment: ['read', 'create', 'cancel', 'rollback'],
        environment: ['read', 'update'],
        logs: ['read', 'export'],
        template: ['read', 'create', 'update'],
    }).meta({ label: 'Deployer', description: 'Development and deployment access', color: 'blue' }),
    viewer: permissions({
        project: ['read'],
        service: ['read'],
        deployment: ['read'],
        environment: ['read'],
        logs: ['read'],
        template: ['read'],
    }).meta({ label: 'Viewer', description: 'Read-only access to project resources', color: 'slate' }),
}));
export { projectBuilder };
export const projectPermissionConfig = projectBuilder.build();
export const { statement: projectStatement, ac: projectAc, roles: projectRoles, schemas: projectSchemas, rolesConfig: projectRolesConfig, roleMeta: projectRoleMeta, } = projectPermissionConfig;
export const PROJECT_ROLES = projectBuilder.getRoleNames();
export const PLATFORM_RESOURCES = platformBuilder.getStatementNames();
export const ORGANIZATION_RESOURCES = organizationBuilder.getStatementNames();
export const PROJECT_RESOURCES = projectBuilder.getStatementNames();
//# sourceMappingURL=config.js.map