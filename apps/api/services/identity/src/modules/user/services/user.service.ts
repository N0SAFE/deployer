import { hashPassword } from 'better-auth/crypto'
import { Context, Effect } from 'effect'

import { CurrentActor, type Ambient, serviceOver } from '@deployer/effect-core'

import { DatabasePort } from '@identity/core/database/database.port'
import { actionHash } from '@identity/core/utils/action-hash'
import { actorFromCurrent } from '@identity/core/utils/actor.utils'
import { ApprovalService } from '@identity/modules/approval/approval.service'
import { AuditService } from '@identity/modules/audit/audit.service'
import { RoleService } from '@identity/modules/role/role.service'
import { StepUpService } from '@identity/modules/step-up/step-up.service'

import {
    EmailTaken,
    UserForbidden,
    UserInvalid,
    UserNotFound,
    type UserDomainFailure,
} from '../domain/user.errors'
import { userRules } from '../domain/user.rules'
import {
    UserRepository,
    type UserRepositoryShape,
} from '../repositories/user.repository'

import { rule } from './user.service.utils'

import type { UserQuery } from './user.service.types'
import type { NewUser, SelfExportData, User, UserPatch, UserSessionRow } from '../domain/user.types'
import type {
    UserFilter,
    UserPage,
} from '../repositories/user.repository.types'
import type { UserRepositoryFailure } from '../user.failures'


/** What a user use case can fail with: its own refusals, or the database. */
export type UserFailure = UserDomainFailure | UserRepositoryFailure

/**
 * Every method leaves only the ambient requirements open (`CurrentActor`, `Correlation`): who is
 * acting comes from the request boundary, never from a parameter, and the repository is resolved
 * when the layer is built.
 */
export type UserServiceShape = {
    readonly list: (
        query: UserQuery
    ) => Effect.Effect<UserPage, UserFailure, Ambient | UserRepository | DatabasePort>
    readonly count: (
        filter: UserFilter
    ) => Effect.Effect<number, UserFailure, Ambient | UserRepository | DatabasePort>
    /** Delete the caller's own account (`AUTH-032`): step-up, last-admin guard, then cascade. */
    readonly deleteSelf: () => Effect.Effect<
        void,
        UserFailure,
        Ambient | UserRepository | DatabasePort | StepUpService | AuditService
    >
    /** The caller's own data (`AUTH-032`). Scoped by the session; no capability involved. */
    readonly exportSelf: () => Effect.Effect<
        SelfExportData & { readonly exportedAt: Date; readonly user: User },
        UserFailure,
        Ambient | UserRepository | DatabasePort
    >
    readonly findById: (
        id: string
    ) => Effect.Effect<User | null, UserFailure, Ambient | UserRepository | DatabasePort>
    readonly checkEmail: (
        email: string
    ) => Effect.Effect<boolean, UserFailure, Ambient | UserRepository | DatabasePort>
    readonly create: (
        input: NewUser
    ) => Effect.Effect<
        User,
        UserFailure,
        Ambient | UserRepository | DatabasePort | RoleService | AuditService | StepUpService
    >
    readonly update: (
        id: string,
        patch: UserPatch,
        raw: Record<string, unknown>
    ) => Effect.Effect<
        User,
        UserFailure,
        Ambient | UserRepository | DatabasePort | StepUpService | AuditService
    >
    readonly setBanned: (
        id: string,
        banned: boolean
    ) => Effect.Effect<
        User,
        UserFailure,
        Ambient | UserRepository | DatabasePort | StepUpService | AuditService
    >
    readonly setRole: (
        id: string,
        role: NonNullable<User["role"]>
    ) => Effect.Effect<
        User,
        UserFailure,
        Ambient | UserRepository | DatabasePort | StepUpService | RoleService | AuditService
    >
    /** Every session a user holds (`session:list`). */
    readonly listSessions: (
        id: string,
    ) => Effect.Effect<UserSessionRow[], UserFailure, Ambient | UserRepository | DatabasePort>
    /** End ONE session (`session:revoke`), with a passkey proof. */
    readonly revokeSession: (
        id: string,
        sessionId: string,
    ) => Effect.Effect<
        void,
        UserFailure,
        Ambient | UserRepository | DatabasePort | StepUpService | AuditService
    >
    /** Set a temporary password (`AUTH-015`) and end every session it would otherwise leave alive. */
    readonly setPassword: (
        id: string,
        password: string
    ) => Effect.Effect<
        void,
        UserFailure,
        Ambient | UserRepository | DatabasePort | StepUpService | AuditService
    >
    readonly revokeSessions: (
        id: string
    ) => Effect.Effect<
        void,
        UserFailure,
        Ambient | UserRepository | DatabasePort | StepUpService
    >
    readonly delete: (
        id: string
    ) => Effect.Effect<
        void,
        UserFailure,
        Ambient | UserRepository | DatabasePort | StepUpService | AuditService | ApprovalService
    >
}

/** Tag and implementation together: the tag is the contract, `Live` the one implementation. */
export class UserService extends Context.Service<
    UserService,
    UserServiceShape
>()('identity/UserService') {
    /** The repository is yielded when a method runs, so this is a constant the module provides with `useValue`. */
    static readonly live = serviceOver(UserRepository, makeUserService);

}

const actingUser = Effect.gen(function* () {
    return actorFromCurrent(yield* CurrentActor)
})

/**
 * The User domain's rules, composed as Effects.
 *
 * Rules stay synchronous and are lifted with `rule`; database work is an Effect from the
 * repository. Each refusal is its own tagged `DomainError`, which the boundary maps by kind; a
 * repository failure is left unmapped on purpose.
 */
function makeUserService(users: UserRepositoryShape): UserServiceShape {
    return {
        list: Effect.fn('UserService.list')(function* (query) {
            const actor = yield* actingUser
            yield* rule(() => {
                userRules.assertCanAdminister(actor)
            })
            return yield* users.list({
                ...query.filter,
                limit: query.limit,
                offset: query.offset,
                sortField: query.sortField,
                sortDirection: query.sortDirection,
            })
        }),

        count: Effect.fn('UserService.count')(function* (filter) {
            const actor = yield* actingUser
            yield* rule(() => {
                userRules.assertCanAdminister(actor)
            })
            return yield* users.count(filter)
        }),

        deleteSelf: Effect.fn('UserService.deleteSelf')(function* () {
            const stepUp = yield* StepUpService
            yield* stepUp.assertCritical().pipe(Effect.mapError(() => new UserForbidden({ reason: "step-up required: verify with a passkey and retry" })))

            const actor = yield* CurrentActor
            if (actor.kind !== 'user') {
                return yield* new UserForbidden({ reason: 'only a signed-in account can delete itself' })
            }

            const self = yield* users.findById(actor.id)
            if (self === null) return yield* new UserNotFound({ id: actor.id })

            // Deleting the last super admin is a lockout, not a lifecycle action: nobody would be left to grant it back.
            if (self.role === 'superAdmin') {
                const remaining = yield* users.countByRole('superAdmin')
                if (remaining <= 1) {
                    return yield* new UserForbidden({
                        reason: 'the last super admin cannot delete its own account',
                    })
                }
            }

            // Credentials first: the sessions and keys are cascaded by the row, but revoking makes the window explicit.
            yield* users.revokeCredentials(actor.id)
            yield* users.delete(actor.id)

            const audit = yield* AuditService
            yield* audit.record({
                action: 'user-deleted',
                actorId: actor.id,
                targetId: actor.id,
                detail: { self: true, role: self.role ?? 'user' },
            })
        }),

        exportSelf: Effect.fn('UserService.exportSelf')(function* () {
            const actor = yield* CurrentActor
            // A system actor has no "own data"; answering would mean picking someone else's.
            if (actor.kind !== 'user') {
                return yield* new UserForbidden({ reason: 'only a signed-in account can export its data' })
            }

            const self = yield* users.findById(actor.id)
            if (self === null) return yield* new UserNotFound({ id: actor.id })

            const data = yield* users.exportFor(actor.id)
            return { exportedAt: new Date(), user: self, ...data }
        }),

        findById: Effect.fn('UserService.findById')(function* (id) {
            const actor = yield* actingUser
            yield* rule(() => {
                userRules.assertSelfOrAdmin(actor, id)
            })
            return yield* users.findById(id)
        }),

        checkEmail: Effect.fn('UserService.checkEmail')(function* (email) {
            return yield* users.emailExists(userRules.normaliseEmail(email))
        }),

        create: Effect.fn('UserService.create')(function* (input) {
            const actor = yield* actingUser
            yield* rule(() => {
                userRules.assertCanAdminister(actor)
                userRules.assertRoleIsAssignable(actor, input.role)
            })

            // Creating a PRIVILEGED account is a grant, not a profile edit: the same passkey proof that guards
            // `setRole` guards minting an admin. A default `user` account does not need one.
            if (input.role !== undefined && input.role !== 'user') {
                const stepUp = yield* StepUpService
                yield* stepUp.assertCritical().pipe(Effect.mapError(() => new UserForbidden({ reason: "step-up required: verify with a passkey and retry" })))
            }

            // The roles table is the source of truth for what exists; a name it does not know cannot be written into
            // `user.role` as a string nothing can interpret.
            if (input.role !== undefined) {
                const roles = yield* RoleService
                if (!(yield* roles.isKnownPlatformRole(input.role))) {
                    return yield* new UserInvalid({ reason: `"${input.role}" is not a platform role` })
                }
            }

            const email = userRules.normaliseEmail(input.email)
            yield* rule(() => {
                userRules.assertEmailIsUsable(email)
                userRules.assertNameIsUsable(input.name)
            })

            if (yield* users.emailExists(email))
                return yield* new EmailTaken({ email })

            const created = yield* users.insert({
                name: input.name.trim(),
                email,
                ...(input.image === undefined ? {} : { image: input.image }),
                ...(input.role === undefined ? {} : { role: input.role }),
            })

            // A user with a password is created with a `credential` account row; Better Auth verifies against it.
            const password = input.password
            if (password !== undefined && password.length > 0) {
                const passwordHash = yield* Effect.promise(() => hashPassword(password))
                yield* users.setPassword(created.id, passwordHash)
            }

            const audit = yield* AuditService
            yield* audit.record({
                action: 'user-created',
                actorId: actor.userId,
                targetId: created.id,
                detail: { role: created.role ?? 'user' },
            })

            return created
        }),

        update: Effect.fn('UserService.update')(function* (id, patch, raw) {
            const actor = yield* actingUser
            yield* rule(() => {
                userRules.assertNoAuditFields(raw)
            })

            const current = yield* users.findById(id)
            if (current === null) return yield* new UserNotFound({ id })

            // An update that moves `role` or `banned` is the same critical action as `setRole`/`setBanned` reached
            // through the profile form; guarding only those two procedures would leave a second door open.
            // Changing the EMAIL is in the same class: whoever controls it can start a password reset and take the
            // account over, so it is a critical action even though the row it writes is only one column.
            const changesPrivilege =
                (patch.role !== undefined && patch.role !== current.role) ||
                (patch.banned !== undefined && patch.banned !== (current.banned ?? false)) ||
                (patch.email !== undefined && patch.email !== current.email)
            if (changesPrivilege) {
                const stepUp = yield* StepUpService
                yield* stepUp.assertCritical().pipe(Effect.mapError(() => new UserForbidden({ reason: "step-up required: verify with a passkey and retry" })))
            }

            const isSelf = actor.userId === id
            yield* rule(() => {
                userRules.assertSelfOrAdmin(actor, id)
                if (!isSelf)
                    userRules.assertOutranks(actor, current.role)
                if (
                    patch.banned !== undefined &&
                    patch.banned !== (current.banned ?? false)
                ) {
                    userRules.assertNotSelfDestruct(
                        actor,
                        id,
                        patch.banned ? 'ban' : 'unban'
                    )
                }
            })

            if (patch.role !== undefined && patch.role !== current.role) {
                yield* rule(() => {
                    userRules.assertRoleIsAssignable(actor, patch.role)
                })
            }

            const next: UserPatch = isSelf
                ? userRules.toSelfServicePatch(patch, current)
                : { ...patch }

            if (next.name !== undefined) {
                const name = next.name
                yield* rule(() => {
                    userRules.assertNameIsUsable(name)
                })
                next.name = name.trim()
            }

            if (next.email !== undefined) {
                const email = userRules.normaliseEmail(next.email)
                yield* rule(() => {
                    userRules.assertEmailIsUsable(email)
                })
                if (yield* users.emailExists(email, id))
                    return yield* new EmailTaken({ email })
                next.email = email
            }

            if (Object.keys(next).length === 0) return current

            // A role or a ban lives in the session as well as the row: end the credentials, or the change waits for
            // them to expire (AUTH-013). A self-service edit never reaches here with either field, and the row plus its
            // credentials commit in one transaction.
            const roleChanged =
                next.role !== undefined && next.role !== current.role
            const banChanged =
                next.banned !== undefined &&
                next.banned !== (current.banned ?? false)
            const updated =
                roleChanged || banChanged
                    ? yield* users.applySecurityChange(id, next)
                    : yield* users.update(id, next)

            const audit = yield* AuditService
            if (roleChanged) {
                yield* audit.record({
                    action: 'role-change',
                    actorId: actor.userId,
                    targetId: id,
                    detail: { from: current.role ?? 'user', to: next.role },
                })
            }
            if (banChanged) {
                yield* audit.record({
                    action: next.banned === true ? 'ban' : 'unban',
                    actorId: actor.userId,
                    targetId: id,
                })
            }
            if (next.email !== undefined && next.email !== current.email) {
                yield* audit.record({
                    action: 'email-change',
                    actorId: actor.userId,
                    targetId: id,
                })
            }

            return updated
        }),

        setBanned: Effect.fn('UserService.setBanned')(function* (id, banned) {
            const actor = yield* actingUser
            // The capability is checked FIRST: asking a caller who will be refused for a passkey leaks that the action
            // exists and wastes a ceremony on nothing.
            yield* rule(() => {
                userRules.assertCapability(actor, banned ? 'user:ban' : 'user:unban')
                userRules.assertCanAdminister(actor)
            })

            const stepUp = yield* StepUpService
            // A ban ends credentials; it is a critical action, so it needs a fresh passkey proof (`AUTH-062`).
            yield* stepUp.assertCritical().pipe(Effect.mapError(() => new UserForbidden({ reason: "step-up required: verify with a passkey and retry" })))

            const current = yield* users.findById(id)
            if (current === null) return yield* new UserNotFound({ id })

            yield* rule(() => {
                userRules.assertNotSelfDestruct(
                    actor,
                    id,
                    banned ? 'ban' : 'unban'
                )
                userRules.assertOutranks(actor, current.role)
            })

            if ((current.banned ?? false) === banned) return current

            // Banning ends the credentials in the SAME transaction as the row; unbanning re-enables sign-in.
            const updated = yield* users.applySecurityChange(id, { banned })

            const audit = yield* AuditService
            yield* audit.record({
                action: banned ? 'ban' : 'unban',
                actorId: actor.userId,
                targetId: id,
            })

            return updated
        }),

        setRole: Effect.fn('UserService.setRole')(function* (id, role) {
            const actor = yield* actingUser
            yield* rule(() => {
                userRules.assertCapability(actor, 'user:set-role')
                userRules.assertCanAdminister(actor)
            })

            const stepUp = yield* StepUpService
            // Granting a platform role is privilege; a fresh passkey proof is the price (`AUTH-062`, `SEC-070`).
            yield* stepUp.assertCritical().pipe(Effect.mapError(() => new UserForbidden({ reason: "step-up required: verify with a passkey and retry" })))

            const roles = yield* RoleService
            if (!(yield* roles.isKnownPlatformRole(role))) {
                return yield* new UserInvalid({ reason: `"${role}" is not a platform role` })
            }

            const current = yield* users.findById(id)
            if (current === null) return yield* new UserNotFound({ id })

            yield* rule(() => {
                userRules.assertNotSelfDestruct(actor, id, 'set-role')
                userRules.assertOutranks(actor, current.role)
                // Granting a role must not hand out a rank the actor does not hold.
                userRules.assertOutranks(actor, role)
            })

            if (current.role === role) return current

            // One transaction: the row and the credentials it invalidates commit together (`SEC-054`).
            const updated = yield* users.applySecurityChange(id, { role })

            const audit = yield* AuditService
            yield* audit.record({
                action: 'role-change',
                actorId: actor.userId,
                targetId: id,
                detail: { from: current.role ?? 'user', to: role },
            })

            return updated
        }),

        listSessions: Effect.fn('UserService.listSessions')(function* (id) {
            const actor = yield* actingUser
            yield* rule(() => {
                userRules.assertCapability(actor, 'session:list')
            })

            const target = yield* users.findById(id)
            if (target === null) return yield* new UserNotFound({ id })

            // Seeing where someone is signed in is as sensitive as the sessions themselves, so it follows the hierarchy.
            yield* rule(() => {
                userRules.assertOutranks(actor, target.role)
            })

            return yield* users.listSessions(id)
        }),

        revokeSession: Effect.fn('UserService.revokeSession')(function* (id, sessionId) {
            const actor = yield* actingUser
            yield* rule(() => {
                userRules.assertCapability(actor, 'session:revoke')
            })

            const target = yield* users.findById(id)
            if (target === null) return yield* new UserNotFound({ id })

            yield* rule(() => {
                userRules.assertOutranks(actor, target.role)
            })

            const stepUp = yield* StepUpService
            yield* stepUp.assertCritical().pipe(Effect.mapError(() => new UserForbidden({ reason: "step-up required: verify with a passkey and retry" })))

            const revoked = yield* users.revokeSession(id, sessionId)
            if (!revoked) {
                return yield* new UserInvalid({ reason: 'that session no longer exists' })
            }

            const audit = yield* AuditService
            yield* audit.record({
                action: 'session-revoked',
                actorId: actor.userId,
                targetId: id,
                detail: { sessionId },
            })
        }),

        setPassword: Effect.fn('UserService.setPassword')(function* (id, password) {
            const actor = yield* actingUser
            yield* rule(() => {
                userRules.assertCapability(actor, 'user:set-password')
                userRules.assertCanAdminister(actor)
            })

            const stepUp = yield* StepUpService
            yield* stepUp.assertCritical().pipe(Effect.mapError(() => new UserForbidden({ reason: "step-up required: verify with a passkey and retry" })))

            const current = yield* users.findById(id)
            if (current === null) return yield* new UserNotFound({ id })

            yield* rule(() => {
                userRules.assertOutranks(actor, current.role)
            })

            // Better Auth verifies against the `credential` account row; its own crypto produces the hash.
            const passwordHash = yield* Effect.promise(() => hashPassword(password))
            yield* users.setPassword(id, passwordHash)
            // A password change that leaves a session alive is not a change: whoever had the old one keeps access.
            yield* users.revokeCredentials(id)

            const audit = yield* AuditService
            yield* audit.record({ action: 'password-changed', actorId: actor.userId, targetId: id })
        }),

        revokeSessions: Effect.fn('UserService.revokeSessions')(function* (id) {
            const actor = yield* actingUser
            yield* rule(() => {
                userRules.assertCapability(actor, 'session:delete')
                userRules.assertCanAdminister(actor)
            })

            const stepUp = yield* StepUpService
            yield* stepUp.assertCritical().pipe(Effect.mapError(() => new UserForbidden({ reason: "step-up required: verify with a passkey and retry" })))

            const current = yield* users.findById(id)
            if (current === null) return yield* new UserNotFound({ id })

            yield* rule(() => {
                userRules.assertOutranks(actor, current.role)
            })

            yield* users.revokeCredentials(id)
        }),

        delete: Effect.fn('UserService.delete')(function* (id) {
            const actor = yield* actingUser
            yield* rule(() => {
                userRules.assertCanAdminister(actor)
            })

            const stepUp = yield* StepUpService
            yield* stepUp.assertCritical().pipe(Effect.mapError(() => new UserForbidden({ reason: "step-up required: verify with a passkey and retry" })))

            const current = yield* users.findById(id)
            if (current === null) return yield* new UserNotFound({ id })

            yield* rule(() => {
                userRules.assertNotSelfDestruct(actor, id, 'delete')
                userRules.assertOutranks(actor, current.role)
            })

            // Deleting an account destroys its data. Whoever holds `user:delete` (the danger bundle) may do it; anyone
            // else needs a second person's approval for THIS id, consumed atomically at the moment of the write.
            const approvals = yield* ApprovalService
            yield* approvals.require('user:delete', actionHash('user.delete', id)).pipe(
                Effect.mapError(
                    (error) =>
                        new UserForbidden({
                            reason:
                                error._tag === 'ApprovalForbidden'
                                    ? 'approval required: ask another admin to approve this exact action'
                                    : 'the approval check failed',
                        })
                )
            )

            yield* users.delete(id)

            const audit = yield* AuditService
            yield* audit.record({
                action: 'user-deleted',
                actorId: actor.userId,
                targetId: id,
                detail: { role: current.role ?? 'user' },
            })
        }),
    }
}
