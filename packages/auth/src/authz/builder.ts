import z from 'zod/v4'

import { roleTable, type RoleTable } from './roles'

/**
 * The authz builder.
 *
 * One fluent declaration — resources, bundles, roles — and generics carry every name through to the end:
 *
 *   - `R` is the resource map, so `PermissionOf<R>` is the `"resource:action"` union a check accepts;
 *   - `B` is the bundle map, so a role may only name a bundle that exists;
 *   - `Ro` is the role map, so role names, ranks and scopes are literals.
 *
 * Nothing downstream may declare a permission or a role again: the statement, each role's grants, the role table, the
 * rank map and the zod schemas are all derived here, and a typo in a permission, an action, a bundle or a role is a
 * compile error.
 */

/** How damaging a permission is. Drives the guardrail default, the audit level and the editor's warning. */
export type Risk = 'read' | 'write' | 'destructive' | 'reveal' | 'admin'

/** Scope kinds a role can be defined for. `platform` roles apply everywhere; the rest are scoped. */
export type ScopeKind =
    'platform' | 'project' | 'environment' | 'service' | 'node'

/** One action of a resource: what it is, and how damaging it is to grant. */
export interface ActionDefinition {
    readonly risk: Risk
    readonly description: string
}

/** `{ read: { risk, description }, deploy: { … } }` — one resource. */
export type ResourceActions = Readonly<Record<string, ActionDefinition>>
/** `{ service: { … }, user: { … } }` — the whole vocabulary. */
export type ResourceMap = Readonly<Record<string, ResourceActions>>

/** `"service:deploy"` — the typed union every check uses. */
export type PermissionOf<R extends ResourceMap> = {
    [K in keyof R & string]: `${K}:${Extract<keyof R[K], string>}`
}[keyof R & string]

/** `{ service: ["read", "deploy"], … }` — a set of declared permissions. */

// actions are that resource's own union, which `Record` cannot express.
export type PermissionGroupOf<R extends ResourceMap> = {
    readonly [K in keyof R]?: readonly Extract<keyof R[K], string>[]
}

/** `{ resource: actions[] }` — the transport view of the same declaration. */
export type StatementOf<R extends ResourceMap> = {
    readonly [K in keyof R]: readonly Extract<keyof R[K], string>[]
}

/** The permission definitions, keyed by `"resource:action"`. */
// eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style -- keyed by `resource:action` literals, not an index signature
export type Flattened<R extends ResourceMap> = {
    readonly [P in PermissionOf<R>]: ActionDefinition
}

/** The bundle names of a role declaration (`"all"` means every bundle). */
export type RoleBundlesOf<
    Role extends RoleOptions,
    B extends Record<string, unknown>,
> = Role['bundles'] extends 'all'
    ? readonly (keyof B & string)[]
    : Role['bundles'] extends readonly (infer Bundle extends string)[]
      ? readonly Bundle[]
      : readonly []

export interface RoleOptions<Bundle extends string = string> {
    readonly scope: ScopeKind
    /** Position in the hierarchy: higher outranks lower. Drives "may this actor act on that account". */
    readonly rank: number
    readonly label: string
    readonly description?: string
    readonly color?: string
    /** Bundles this role receives. Only a declared bundle compiles. `"all"` is the owner role. */
    readonly bundles?: readonly Bundle[] | 'all'
    /** Permissions outside the bundles (a custom role's grants). */
    readonly permissions?: Record<string, readonly string[]>
}

/** What a role declaration is CHECKED against: bundles by name, permissions by resource+action. */
export type StrictRoleOptions<
    R extends ResourceMap,
    Bundle extends string,
> = Omit<RoleOptions<Bundle>, 'permissions'> & {
    readonly permissions?: PermissionGroupOf<R>
}

/** The helpers a `resources` factory receives. */
export interface ActionsHelper {
    /** Action names only; metadata defaults to `write` with no description. */
    readonly actions: {
        <const A extends readonly string[]>(
            names: A
        ): Record<A[number], ActionDefinition>
        <const A extends Record<string, ActionDefinition>>(definitions: A): A
    }
}

/** The helpers a `bundles`/`roles` factory receives, typed against the declared resources. */
export interface PermissionsHelper<R extends ResourceMap> {
    readonly permissions: <const P extends PermissionGroupOf<R>>(group: P) => P
}

/** The model every consumer reads. Defined once, by `build()`. */
/** The role names declared for one scope. */
export type RolesOfScope<
    Ro extends Record<string, { readonly scope: ScopeKind }>,
    S extends ScopeKind,
> = {
    [K in keyof Ro]: Ro[K]['scope'] extends S ? K : never
}[keyof Ro]

export interface AuthzModel<
    R extends ResourceMap,
    B extends Record<string, Record<string, readonly string[]>>,
    Ro extends Record<string, RoleOptions>,
> {
    readonly resources: R
    readonly statement: StatementOf<R>
    readonly permissions: Flattened<R>
    readonly bundles: B
    /** Role name -> the statement subset it grants. */
    readonly rolePermissions: { readonly [K in keyof Ro]: PermissionGroupOf<R> }
    /** Role name -> `{ scope, bundles }`, the shape a `roles` table is seeded from. */
    readonly systemRoles: {
        readonly [K in keyof Ro]: {
            readonly scope: Ro[K]['scope']
            readonly bundles: RoleBundlesOf<Ro[K], B>
        }
    }
    readonly roles: Ro
    readonly ranks: { readonly [K in keyof Ro]: Ro[K]['rank'] }
    readonly roleNames: readonly (keyof Ro & string)[]
    readonly platformRoles: readonly RolesOfScope<Ro, 'platform'>[]
    readonly projectRoles: readonly RolesOfScope<Ro, 'project'>[]
    readonly rolesOfScope: <S extends ScopeKind>(
        scope: S
    ) => readonly RolesOfScope<Ro, S>[]
    readonly bundleNames: readonly (keyof B & string)[]
    readonly roleTable: RoleTable
    readonly schemas: {
        readonly roleNames: z.ZodType<keyof Ro & string>
        readonly permissions: z.ZodType<PermissionOf<R>>
    }
    /** Every permission of a role, in declaration order. */
    readonly capabilitiesOfRole: (
        role: keyof Ro & string
    ) => readonly PermissionOf<R>[]
    readonly roleGrants: (
        role: keyof Ro & string,
        permission: PermissionOf<R>
    ) => boolean
    readonly isRole: (role: string) => role is keyof Ro & string
    /** In-memory role policy, for the web's optimistic `useCan` (the server re-checks authoritatively). */
    readonly rolesConfig: {
        readonly hasPermission: (
            role: string,
            resource: keyof R & string,
            action: string
        ) => boolean
    }
}

type MergeResources<A extends ResourceMap, B extends ResourceMap> = {
    readonly [K in keyof A | keyof B]: K extends keyof B
        ? B[K]
        : K extends keyof A
          ? A[K]
          : never
}

const DEFAULT_ACTION: ActionDefinition = { risk: 'write', description: '' }

const splitPermission = (
    permission: string
): [resource: string, action: string] => {
    const index = permission.indexOf(':')
    return index === -1
        ? [permission, '*']
        : [permission.slice(0, index), permission.slice(index + 1)]
}

function defineActions<const A extends readonly string[]>(
    names: A
): Record<A[number], ActionDefinition>
function defineActions<const A extends Record<string, ActionDefinition>>(
    definitions: A
): A
function defineActions(
    definitions: readonly string[] | Record<string, ActionDefinition>
): Record<string, ActionDefinition> {
    return Array.isArray(definitions)
        ? (Object.fromEntries(
              definitions.map((name) => [name, DEFAULT_ACTION])
          ) as Record<string, ActionDefinition>)
        : (definitions as Record<string, ActionDefinition>)
}

const actionsHelper: ActionsHelper = { actions: defineActions }

/** The empty map a builder starts from: no index signature, so merging keeps the literal keys. */
// eslint-disable-next-line @typescript-eslint/no-generated-empty-object-type -- `Record<string, never>` would erase merged keys
type EmptyMap = Record<never, never>

export class AuthzBuilder<
    R extends ResourceMap = EmptyMap,
    B extends Record<string, Record<string, readonly string[]>> = EmptyMap,
    Ro extends Record<string, RoleOptions> = EmptyMap,
> {
    #resources: Record<string, Record<string, ActionDefinition>> = {}
    #permissions: Record<string, ActionDefinition> = {}
    #bundles: Record<string, PermissionGroupOf<R>> = {}
    #bundlePermissions: Record<string, string[]> = {}
    #roles: Record<string, RoleOptions> = {}

    /** Declare the resources and their actions. */
    resources<const TResources extends ResourceMap>(
        factory: (helpers: ActionsHelper) => TResources
    ): AuthzBuilder<MergeResources<R, TResources>, B, Ro> {
        const declared = factory(actionsHelper)
        for (const [resource, actions] of Object.entries(declared)) {
            if (Object.keys(actions).length === 0)
                throw new Error(`resource "${resource}" declares no action`)
            this.#resources[resource] = {
                ...this.#resources[resource],
                ...actions,
            }
            for (const [action, meta] of Object.entries(actions))
                this.#permissions[`${resource}:${action}`] = meta
        }
        return this as unknown as AuthzBuilder<
            MergeResources<R, TResources>,
            B,
            Ro
        >
    }

    /** Declare product concepts: named groups of permissions a role can receive. */
    bundles<const TBundles extends Record<string, PermissionGroupOf<R>>>(
        factory: (helpers: PermissionsHelper<R>) => TBundles
    ): AuthzBuilder<R, B & TBundles, Ro> {
        const declared = factory({ permissions: (group) => group })
        this.#bundles = { ...this.#bundles, ...declared }
        for (const [name, group] of Object.entries(declared))
            this.#bundlePermissions[name] = flattenGroups(group)
        return this as unknown as AuthzBuilder<R, B & TBundles, Ro>
    }

    /** Declare roles. A role receives bundles, explicit permissions, or both. */
    roles<
        const TRoles extends Record<
            string,
            StrictRoleOptions<R, keyof B & string>
        >,
    >(
        factory: (helpers: PermissionsHelper<R>) => TRoles
    ): AuthzBuilder<R, B, Ro & TRoles> {
        this.#roles = {
            ...this.#roles,
            ...factory({ permissions: (group) => group }),
        }
        return this as unknown as AuthzBuilder<R, B, Ro & TRoles>
    }

    build(): AuthzModel<R, B, Ro> {
        const permissionNames = Object.keys(this.#permissions)
        const known = new Set(permissionNames)

        for (const [bundle, granted] of Object.entries(
            this.#bundlePermissions
        )) {
            for (const permission of granted) {
                if (!known.has(permission))
                    throw new Error(
                        `bundle "${bundle}" names unknown permission "${permission}"`
                    )
            }
        }

        const rolePermissions: Record<string, PermissionGroupOf<R>> = {}
        const capabilities: Record<string, string[]> = {}
        const ranks: Record<string, number> = {}
        const systemRoles: Record<
            string,
            { scope: ScopeKind; bundles: readonly string[] }
        > = {}

        for (const [roleName, role] of Object.entries(this.#roles)) {
            const granted = new Set<string>()
            const bundles =
                role.bundles === 'all'
                    ? Object.keys(this.#bundlePermissions)
                    : (role.bundles ?? [])
            for (const bundle of bundles) {
                const bundlePermissions = this.#bundlePermissions[bundle]
                if (bundlePermissions === undefined)
                    throw new Error(
                        `role "${roleName}" names unknown bundle "${bundle}"`
                    )
                for (const permission of bundlePermissions)
                    granted.add(permission)
            }
            for (const permission of flattenGroups(role.permissions ?? {})) {
                if (!known.has(permission))
                    throw new Error(
                        `role "${roleName}" names unknown permission "${permission}"`
                    )
                granted.add(permission)
            }

            const byResource: Record<string, string[]> = {}
            for (const permission of permissionNames) {
                if (!granted.has(permission)) continue
                const [resource, action] = splitPermission(permission)
                ;(byResource[resource] ??= []).push(action)
            }
            rolePermissions[roleName] =
                byResource as unknown as PermissionGroupOf<R>
            capabilities[roleName] = permissionNames.filter((permission) =>
                granted.has(permission)
            )
            ranks[roleName] = role.rank
            systemRoles[roleName] = { scope: role.scope, bundles }
        }

        const roleNames = Object.keys(this.#roles) as (keyof Ro & string)[]

        return {
            resources: this.#resources as unknown as R,
            statement: Object.fromEntries(
                Object.entries(this.#resources).map(([resource, actions]) => [
                    resource,
                    Object.keys(actions),
                ])
            ) as unknown as StatementOf<R>,
            permissions: Object.fromEntries(
                permissionNames.map((permission) => [
                    permission,
                    this.#permissions[permission],
                ])
            ) as unknown as Flattened<R>,
            bundles: this.#bundles as unknown as B,
            rolePermissions: rolePermissions as AuthzModel<
                R,
                B,
                Ro
            >['rolePermissions'],
            systemRoles: systemRoles as AuthzModel<R, B, Ro>['systemRoles'],
            roles: this.#roles as unknown as Ro,
            ranks: ranks as AuthzModel<R, B, Ro>['ranks'],
            roleNames,
            platformRoles: roleNames.filter(
                (name) => this.#roles[name]?.scope === 'platform'
            ) as RolesOfScope<Ro, 'platform'>[],
            projectRoles: roleNames.filter(
                (name) => this.#roles[name]?.scope === 'project'
            ) as RolesOfScope<Ro, 'project'>[],
            rolesOfScope: <S extends ScopeKind>(scope: S) =>
                roleNames.filter(
                    (name) => this.#roles[name]?.scope === scope
                ) as RolesOfScope<Ro, S>[],
            bundleNames: Object.keys(this.#bundles).map(
                (name) => name as keyof B & string
            ),
            roleTable: roleTable(
                Object.entries(this.#roles).map(([name, role]) => ({
                    name,
                    scope: role.scope,
                    rank: role.rank,
                    permissions: capabilities[name] ?? [],
                    label: role.label,
                    description: role.description,
                    color: role.color,
                })),
                { system: true }
            ),
            schemas: {
                roleNames: z.custom<keyof Ro & string>(
                    (value) =>
                        typeof value === 'string' &&
                        Object.hasOwn(this.#roles, value)
                ),
                permissions: z.custom<PermissionOf<R>>(
                    (value) => typeof value === 'string' && known.has(value)
                ),
            },
            capabilitiesOfRole: (role) =>
                (capabilities[role] ?? []) as PermissionOf<R>[],
            roleGrants: (role, permission) =>
                (capabilities[role] ?? []).includes(permission),
            isRole: (role): role is keyof Ro & string =>
                Object.hasOwn(this.#roles, role),
            rolesConfig: {
                hasPermission: (role, resource, action) => {
                    const granted = rolePermissions[role]
                    if (granted === undefined) return false
                    const actions = granted[resource]
                    return actions?.includes(action as never) ?? false
                },
            },
        }
    }
}

/** Flatten `{ resource: actions[] }` into `resource:action` strings. */
export function flattenGroups(
    groups: Record<string, readonly string[] | undefined>
): string[] {
    const permissions: string[] = []
    for (const [resource, actions] of Object.entries(groups)) {
        for (const action of actions ?? [])
            permissions.push(`${resource}:${action}`)
    }
    return permissions
}

/** A fresh builder. The declaration in `definition.ts` is the only caller in this package. */
export function createAuthzBuilder(): AuthzBuilder {
    return new AuthzBuilder()
}

export { DEFAULT_ACTION }
