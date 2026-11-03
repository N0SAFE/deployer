import { hashPassword } from 'better-auth/crypto'
import { Context, Effect } from 'effect'

import { CurrentActor, type Ambient, serviceOver } from '@deployer/effect-core'

import { DatabasePort } from '@identity/core/database/database.port'
import { actorFromCurrent } from '@identity/core/utils/actor.utils'
import { StepUpService } from '@identity/modules/step-up/step-up.service'

import {
    EmailTaken,
    UserForbidden,
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
import type { NewUser, User, UserPatch } from '../domain/user.types'
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
    readonly findById: (
        id: string
    ) => Effect.Effect<User | null, UserFailure, Ambient | UserRepository | DatabasePort>
    readonly checkEmail: (
        email: string
    ) => Effect.Effect<boolean, UserFailure, Ambient | UserRepository | DatabasePort>
    readonly create: (
        input: NewUser
    ) => Effect.Effect<User, UserFailure, Ambient | UserRepository | DatabasePort>
    readonly update: (
        id: string,
        patch: UserPatch,
        raw: Record<string, unknown>
    ) => Effect.Effect<
        User,
        UserFailure,
        Ambient | UserRepository | DatabasePort | StepUpService
    >
    readonly setBanned: (
        id: string,
        banned: boolean
    ) => Effect.Effect<User, UserFailure, Ambient | UserRepository | DatabasePort | StepUpService>
    readonly setRole: (
        id: string,
        role: NonNullable<User["role"]>
    ) => Effect.Effect<User, UserFailure, Ambient | UserRepository | DatabasePort | StepUpService>
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
        Ambient | UserRepository | DatabasePort | StepUpService
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
            const changesPrivilege =
                (patch.role !== undefined && patch.role !== current.role) ||
                (patch.banned !== undefined && patch.banned !== (current.banned ?? false))
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

            const updated = yield* users.update(id, next)

            // A role or a ban lives in the session as well as the row: end the credentials, or the change waits for
            // them to expire (AUTH-013). A self-service edit never reaches here with either field.
            const roleChanged =
                next.role !== undefined && next.role !== current.role
            const banChanged =
                next.banned !== undefined &&
                next.banned !== (current.banned ?? false)
            if (roleChanged || banChanged) {
                yield* users.revokeCredentials(id)
            }

            return updated
        }),

        setBanned: Effect.fn('UserService.setBanned')(function* (id, banned) {
            const stepUp = yield* StepUpService
            // A ban ends credentials; it is a critical action, so it needs a fresh passkey proof (`AUTH-062`).
            yield* stepUp.assertCritical().pipe(Effect.mapError(() => new UserForbidden({ reason: "step-up required: verify with a passkey and retry" })))
            const actor = yield* actingUser
            yield* rule(() => {
                userRules.assertCapability(actor, banned ? 'user:ban' : 'user:unban')
                userRules.assertCanAdminister(actor)
            })

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

            const updated = yield* users.update(id, { banned })
            // Banning ends the credentials; unbanning leaves none to end.
            if (banned) yield* users.revokeCredentials(id)

            return updated
        }),

        setRole: Effect.fn('UserService.setRole')(function* (id, role) {
            const stepUp = yield* StepUpService
            // Granting a platform role is privilege; a fresh passkey proof is the price (`AUTH-062`, `SEC-070`).
            yield* stepUp.assertCritical().pipe(Effect.mapError(() => new UserForbidden({ reason: "step-up required: verify with a passkey and retry" })))
            const actor = yield* actingUser
            yield* rule(() => {
                userRules.assertCapability(actor, 'user:set-role')
                userRules.assertCanAdminister(actor)
            })

            const current = yield* users.findById(id)
            if (current === null) return yield* new UserNotFound({ id })

            yield* rule(() => {
                userRules.assertNotSelfDestruct(actor, id, 'set-role')
                userRules.assertOutranks(actor, current.role)
                // Granting a role must not hand out a rank the actor does not hold.
                userRules.assertOutranks(actor, role)
            })

            if (current.role === role) return current

            const updated = yield* users.update(id, { role })
            // The session carries the role, so a role change ends it rather than waiting for expiry.
            yield* users.revokeCredentials(id)

            return updated
        }),

        revokeSessions: Effect.fn('UserService.revokeSessions')(function* (id) {
            const stepUp = yield* StepUpService
            yield* stepUp.assertCritical().pipe(Effect.mapError(() => new UserForbidden({ reason: "step-up required: verify with a passkey and retry" })))
            const actor = yield* actingUser
            yield* rule(() => {
                userRules.assertCapability(actor, 'session:delete')
                userRules.assertCanAdminister(actor)
            })

            const current = yield* users.findById(id)
            if (current === null) return yield* new UserNotFound({ id })

            yield* rule(() => {
                userRules.assertOutranks(actor, current.role)
            })

            yield* users.revokeCredentials(id)
        }),

        delete: Effect.fn('UserService.delete')(function* (id) {
            const stepUp = yield* StepUpService
            yield* stepUp.assertCritical().pipe(Effect.mapError(() => new UserForbidden({ reason: "step-up required: verify with a passkey and retry" })))
            const actor = yield* actingUser
            yield* rule(() => {
                userRules.assertCanAdminister(actor)
            })

            const current = yield* users.findById(id)
            if (current === null) return yield* new UserNotFound({ id })

            yield* rule(() => {
                userRules.assertNotSelfDestruct(actor, id, 'delete')
                userRules.assertOutranks(actor, current.role)
            })

            yield* users.delete(id)
        }),
    }
}
