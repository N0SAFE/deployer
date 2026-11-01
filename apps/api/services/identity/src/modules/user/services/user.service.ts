import { CurrentActor, type Ambient, serviceOver, type Over } from '@deployer/effect-core'
import { Context, Effect } from 'effect'
import { DatabasePort } from '@identity/core/database/database.port'

import { actorFromCurrent } from '@identity/core/utils/actor.utils'
import {
    EmailTaken,
    UserNotFound,
    type UserDomainFailure,
} from '../domain/user.errors'
import { userRules } from '../domain/user.rules'
import type { NewUser, User, UserPatch } from '../domain/user.types'
import {
    UserRepository,
    type UserRepositoryShape,
} from '../repositories/user.repository'
import type {
    UserFilter,
    UserPage,
} from '../repositories/user.repository.types'
import type { UserRepositoryFailure } from '../user.failures'
import type { UserQuery } from './user.service.types'
import { rule } from './user.service.utils'

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
    ) => Effect.Effect<User, UserFailure, Ambient | UserRepository | DatabasePort>
    readonly setBanned: (
        id: string,
        banned: boolean
    ) => Effect.Effect<User, UserFailure, Ambient | UserRepository | DatabasePort>
    readonly delete: (id: string) => Effect.Effect<void, UserFailure, Ambient | UserRepository | DatabasePort>
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

            return yield* users.insert({
                name: input.name.trim(),
                email,
                ...(input.image === undefined ? {} : { image: input.image }),
                ...(input.role === undefined ? {} : { role: input.role }),
            })
        }),

        update: Effect.fn('UserService.update')(function* (id, patch, raw) {
            const actor = yield* actingUser
            yield* rule(() => {
                userRules.assertNoAuditFields(raw)
            })

            const current = yield* users.findById(id)
            if (current === null) return yield* new UserNotFound({ id })

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

            return yield* users.update(id, next)
        }),

        setBanned: Effect.fn('UserService.setBanned')(function* (id, banned) {
            const actor = yield* actingUser
            yield* rule(() => {
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

            return yield* users.update(id, { banned })
        }),

        delete: Effect.fn('UserService.delete')(function* (id) {
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
