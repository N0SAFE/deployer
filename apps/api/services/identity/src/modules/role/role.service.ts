import { Context, Effect } from 'effect'

import {
    capabilitiesOfRole,
    isPermission,
    platformRoleRank,
    type ScopeKind,
} from '@deployer/auth/authz'
import { CurrentActor, HttpRequest } from '@deployer/effect-core'
import {
    installRoleSnapshot,
    roleHasPermission,
} from '@deployer/shared/core/authz/role-catalog'

import { DatabasePort } from '@identity/core/database/database.port'
import { actorFromCurrent } from '@identity/core/utils/actor.utils'
import { AuditService } from '@identity/modules/audit/audit.service'
import { StepUpService } from '@identity/modules/step-up/step-up.service'

import {
    RoleForbidden,
    RoleInvalid,
    RoleNotFound,
    type RoleFailure,
} from './role.errors'
import { RoleRepository, type RolePatch, type RoleRow } from './role.repository'

/** The body a create accepts. Platform-scoped: project roles are an enum in the schema for now. */
export type NewRole = {
    readonly name: string
    readonly rank: number
    readonly label: string
    readonly description: string | null
    readonly color: string | null
    readonly permissions: readonly string[]
}

export type RoleServiceShape = {
    /** Internal check for the writers of `user.role`; not a capability, since it exposes nothing. */
    readonly isKnownPlatformRole: (
        name: string
    ) => Effect.Effect<boolean, never, DatabasePort>
    readonly list: (
        scope: ScopeKind | undefined
    ) => Effect.Effect<
        RoleRow[],
        RoleFailure,
        RoleRepository | CurrentActor | DatabasePort | HttpRequest
    >
    readonly create: (
        role: NewRole
    ) => Effect.Effect<
        RoleRow,
        RoleFailure,
        | RoleRepository
        | CurrentActor
        | DatabasePort
        | HttpRequest
        | AuditService
        | StepUpService
    >
    readonly update: (
        id: string,
        patch: RolePatch
    ) => Effect.Effect<
        RoleRow,
        RoleFailure,
        | RoleRepository
        | CurrentActor
        | DatabasePort
        | HttpRequest
        | AuditService
        | StepUpService
    >
    readonly remove: (
        id: string
    ) => Effect.Effect<
        void,
        RoleFailure,
        | RoleRepository
        | CurrentActor
        | DatabasePort
        | HttpRequest
        | AuditService
        | StepUpService
    >
}

/**
 * Reading roles is `role:read`, managing them is `role:write` — named as the permissions so a custom role holding one
 * works without a code change.
 *
 * ── WHY A ROLE EDIT IS CAPPED TWICE ─────────────────────────────────────────
 * A role is configuration, but it is PRIVILEGE configuration. Two independent caps stop "manage roles" from becoming
 * "grant myself everything": the rank must stay strictly below the editor's, and every permission must already be the
 * editor's own. Neither is inferred from the other — a low-rank role can still hold a powerful permission.
 */
function assertWriter(
    actorRole: string
): Effect.Effect<void, RoleForbidden> {
    if (!roleHasPermission(actorRole, 'role:write')) {
        return Effect.fail(
            new RoleForbidden({ reason: 'actor lacks role:write' })
        )
    }
    return Effect.void
}

/** The rank and permission caps, shared by create and update. */
const assertGrantable = (
    actorRole: string,
    rank: number,
    permissions: readonly string[]
): Effect.Effect<void, RoleForbidden | RoleInvalid> =>
    Effect.gen(function* () {
        if (rank >= platformRoleRank(actorRole)) {
            return yield* Effect.fail(
                new RoleForbidden({
                    reason: 'a role must rank below your own',
                })
            )
        }

        const mine = new Set(capabilitiesOfRole(actorRole))
        for (const permission of permissions) {
            if (!isPermission(permission)) {
                return yield* Effect.fail(
                    new RoleInvalid({
                        reason: `"${permission}" is not a permission this platform declares`,
                    })
                )
            }
            if (!mine.has(permission)) {
                return yield* Effect.fail(
                    new RoleForbidden({
                        reason: `you cannot grant "${permission}": you do not hold it`,
                    })
                )
            }
        }
    })

/**
 * The role catalogue's rules: who may read it, who may write it, and what may be granted.
 *
 * The repository is a constructor argument, not something the methods yield: the factory form this replaces settled it
 * and the shape's channel says so, so yielding the tag would widen every channel and ripple into every caller. The module
 * wires it with a factory that only does `new RoleService.live(repository)`.
 */
export class RoleService extends Context.Service<
    RoleService,
    RoleServiceShape
>()('identity/RoleService') {
    static readonly live = class RoleServiceImpl implements RoleServiceShape {
        private readonly repository: RoleRepository['Service']

        constructor(repository: RoleRepository['Service']) {
            this.repository = repository
        }

        isKnownPlatformRole(
            name: string
        ): ReturnType<RoleServiceShape['isKnownPlatformRole']> {
            return this.repository.isKnownPlatformRole(name)
        }

        list(scope: ScopeKind | undefined): ReturnType<RoleServiceShape['list']> {
            const repository = this.repository
            return Effect.gen(function* () {
                const actor = actorFromCurrent(yield* CurrentActor)
                if (!roleHasPermission(actor.role, 'role:read')) {
                    return yield* Effect.fail(
                        new RoleForbidden({ reason: 'actor lacks role:read' })
                    )
                }
                return yield* repository.list(scope)
            })
        }

        create(role: NewRole): ReturnType<RoleServiceShape['create']> {
            const repository = this.repository
            return Effect.gen(function* () {
                const actor = actorFromCurrent(yield* CurrentActor)
                yield* assertWriter(actor.role)

                // Creating a role is privilege configuration: a passkey proof, like every other critical write (`SEC-070`).
                const stepUp = yield* StepUpService
                yield* stepUp.assertCritical().pipe(
                    Effect.mapError(
                        () =>
                            new RoleForbidden({
                                reason: 'a fresh passkey proof is required to manage roles',
                            })
                    )
                )

                yield* assertGrantable(actor.role, role.rank, role.permissions)

                if (yield* repository.isKnownPlatformRole(role.name)) {
                    return yield* Effect.fail(
                        new RoleInvalid({
                            reason: `role "${role.name}" already exists`,
                        })
                    )
                }

                const created = yield* repository.create({
                    name: role.name,
                    scope: 'platform',
                    rank: role.rank,
                    label: role.label,
                    description: role.description,
                    color: role.color,
                    isSystem: false,
                    permissions: [...role.permissions],
                })

                const audit = yield* AuditService
                yield* audit.record({
                    action: 'role-created',
                    actorId: actor.userId,
                    detail: {
                        role: created.name,
                        rank: created.rank,
                        permissions: created.permissions,
                    },
                })
                yield* repository.bumpEpoch()
                const catalogue = yield* repository.loadCatalogue()
                installRoleSnapshot(catalogue.epoch, catalogue.roles)

                return created
            })
        }

        update(
            id: string,
            patch: RolePatch
        ): ReturnType<RoleServiceShape['update']> {
            const repository = this.repository
            return Effect.gen(function* () {
                const actor = actorFromCurrent(yield* CurrentActor)
                yield* assertWriter(actor.role)

                const stepUp = yield* StepUpService
                yield* stepUp.assertCritical().pipe(
                    Effect.mapError(
                        () =>
                            new RoleForbidden({
                                reason: 'a fresh passkey proof is required to manage roles',
                            })
                    )
                )

                const current = yield* repository.findById(id)
                if (current === null)
                    return yield* Effect.fail(new RoleNotFound({ id }))
                if (current.isSystem) {
                    return yield* Effect.fail(
                        new RoleForbidden({
                            reason: 'a built-in role is changed by re-seeding, not by an edit',
                        })
                    )
                }

                yield* assertGrantable(
                    actor.role,
                    patch.rank ?? current.rank,
                    patch.permissions ?? current.permissions
                )

                const updated = yield* repository.update(id, patch)
                if (updated === null)
                    return yield* Effect.fail(new RoleNotFound({ id }))

                const audit = yield* AuditService
                yield* audit.record({
                    action: 'role-updated',
                    actorId: actor.userId,
                    detail: {
                        role: updated.name,
                        from: current.permissions,
                        to: updated.permissions,
                    },
                })
                yield* repository.bumpEpoch()
                const catalogue = yield* repository.loadCatalogue()
                installRoleSnapshot(catalogue.epoch, catalogue.roles)

                return updated
            })
        }

        remove(id: string): ReturnType<RoleServiceShape['remove']> {
            const repository = this.repository
            return Effect.gen(function* () {
                const actor = actorFromCurrent(yield* CurrentActor)
                yield* assertWriter(actor.role)

                const stepUp = yield* StepUpService
                yield* stepUp.assertCritical().pipe(
                    Effect.mapError(
                        () =>
                            new RoleForbidden({
                                reason: 'a fresh passkey proof is required to manage roles',
                            })
                    )
                )

                const current = yield* repository.findById(id)
                if (current === null)
                    return yield* Effect.fail(new RoleNotFound({ id }))
                if (current.isSystem) {
                    return yield* Effect.fail(
                        new RoleForbidden({
                            reason: 'a built-in role cannot be deleted',
                        })
                    )
                }

                // Deleting a role out from under its holders would leave `user.role` naming nothing, and every capability
                // check for those accounts would silently deny.
                const holders = yield* repository.countUsersWithRole(
                    current.name
                )
                if (holders > 0) {
                    return yield* Effect.fail(
                        new RoleInvalid({
                            reason: `${String(holders)} account(s) still hold "${current.name}"`,
                        })
                    )
                }

                yield* repository.delete(id)

                const audit = yield* AuditService
                yield* audit.record({
                    action: 'role-deleted',
                    actorId: actor.userId,
                    detail: { role: current.name },
                })

                yield* repository.bumpEpoch()
                const catalogue = yield* repository.loadCatalogue()
                installRoleSnapshot(catalogue.epoch, catalogue.roles)
            })
        }
    }
}
