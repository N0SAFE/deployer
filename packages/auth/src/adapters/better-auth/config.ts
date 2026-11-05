import { createAccessControl } from 'better-auth/plugins/access'
import z from 'zod/v4'

import {
    PERMISSIONS,
    ROLE_RANK,
    SYSTEM_ROLES,
    SYSTEM_ROLES_TABLE,
    authz,
    type Permission,
    type PlatformRole,
    type ProjectRole,
} from '../../authz/definition'

import type { AccessControl, Role } from 'better-auth/plugins/access'

/**
 * The Better Auth view of the authz model.
 *
 * `authz/definition.ts` declares resources, bundles and roles once; this file only CONVERTS that model into the objects
 * Better Auth consumes — an access-control instance, one `Role` per platform role, and the role-name schema. Nothing is
 * declared here: a role or a permission that existed only in this file would be a second policy.
 */
const accessControl = createAccessControl(authz.statement)

const rolePermissionsView = authz.rolePermissions as unknown as Record<
    string,
    Record<string, readonly string[]>
>

function toRoles(names: readonly string[]): Record<string, Role> {
    return Object.fromEntries(
        names.map((name) => [
            name,
            accessControl.newRole((rolePermissionsView[name] ?? {}) as never),
        ])
    )
}

/** Better Auth access-control instance, built from the authz statement. */
export const platformAc: AccessControl = accessControl
export const projectAc: AccessControl = accessControl

/** One Better Auth `Role` per PLATFORM role. Project roles are membership, not a platform role. */
export const platformRoles = toRoles(authz.platformRoles)
export const projectRoles = toRoles(authz.projectRoles)

/** Role names as the API validates them. */
export const PLATFORM_ROLES = authz.platformRoles
export const PROJECT_ROLES = authz.projectRoles

/** A union of literals, not an enum: Better Auth's `RoleSchemaType` is a union of literal schemas. */
function roleNameSchema(names: readonly string[]) {
    const literals = names.map((name) => z.literal(name))
    return z.union(
        literals as [(typeof literals)[number], ...(typeof literals)[number][]]
    )
}

export const platformSchemas = {
    roleNames: roleNameSchema(authz.platformRoles),
    permissions: authz.schemas.permissions,
}
export const projectSchemas = {
    roleNames: roleNameSchema(authz.projectRoles),
}

/** Label/description/color, for the role picker. */
const metaOf = (name: string) => {
    const role = (
        authz.roles as Record<
            string,
            { label: string; description?: string; color?: string }
        >
    )[name]
    return {
        label: role?.label ?? name,
        description: role?.description ?? '',
        color: role?.color ?? 'slate',
    }
}
export const platformRoleMeta = Object.fromEntries(
    authz.platformRoles.map((name) => [name, metaOf(name)])
)
export const projectRoleMeta = Object.fromEntries(
    authz.projectRoles.map((name) => [name, metaOf(name)])
)

/** The role policy the web can evaluate optimistically (`useCan`); the server re-checks authoritatively. */
export const platformRolesConfig = authz.rolesConfig
export const projectRolesConfig = authz.rolesConfig

/** Everything a caller may need, in its Better Auth form. */
export const platformPermissionConfig = {
    statement: authz.statement,
    ac: platformAc,
    roles: platformRoles,
    schemas: platformSchemas,
    roleMeta: platformRoleMeta,
    rolesConfig: platformRolesConfig,
    permissions: PERMISSIONS,
    ranks: ROLE_RANK,
    systemRoles: SYSTEM_ROLES,
    table: SYSTEM_ROLES_TABLE,
} as const

export const projectPermissionConfig = {
    statement: authz.statement,
    ac: projectAc,
    roles: projectRoles,
    schemas: projectSchemas,
    roleMeta: projectRoleMeta,
    rolesConfig: projectRolesConfig,
} as const

/**
 * A builder-shaped handle for the plugin framework.
 *
 * The middleware layer is generic over a builder to infer statement and role names; it needs those two plus the Better
 * Auth pair. Presenting the converted model in the same shape keeps that inference intact without the middleware
 * importing Better Auth itself.
 */
export const platformBuilder = {
    getAc: () => platformAc,
    getRoles: () => platformRoles,
    getStatement: () => authz.statement,
    getStatementNames: () => Object.keys(authz.statement),
    getRoleNames: () => authz.platformRoles,
    getRoleMeta: () => platformRoleMeta,
    statement: authz.statement,
    roles: platformRoles,
} as const

export const projectBuilder = {
    getAc: () => projectAc,
    getRoles: () => projectRoles,
    getStatement: () => authz.statement,
    getStatementNames: () => Object.keys(authz.statement),
    getRoleNames: () => authz.projectRoles,
    getRoleMeta: () => projectRoleMeta,
    statement: authz.statement,
    roles: projectRoles,
} as const

export type PlatformResource = keyof typeof authz.statement
export type PlatformActionsForResource<R extends PlatformResource> =
    (typeof authz.statement)[R][number]

/** Role names as the API validates them. */
export const PLATFORM_RESOURCES = Object.keys(authz.statement)

/** Resources a PROJECT role can grant: the ones appearing in its permission set. */
export const PROJECT_RESOURCES = [
    ...new Set(
        authz.projectRoles.flatMap((role) =>
            Object.keys(authz.rolePermissions[role])
        )
    ),
] as PlatformResource[]
export type ProjectActionsForResource<R extends PlatformResource> =
    (typeof authz.statement)[R][number]

export type { Permission, PlatformRole, ProjectRole }
