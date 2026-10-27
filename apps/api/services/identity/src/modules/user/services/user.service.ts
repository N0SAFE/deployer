import { Context, Effect } from 'effect'

import {
    EmailTaken,
    UserNotFound,
    type UserDomainFailure,
} from '../domain/user.errors'
import { userRules } from '../domain/user.rules'
import type { NewUser, User, UserPatch } from '../domain/user.types'
import type {
    UserFilter,
    UserPage,
} from '../repositories/user.repository.types'
import { UserRepository } from '../repositories/user.repository'
import { DatabasePort } from '@identity/core/database/database.port'
import type { UserRepositoryFailure } from '../user.failures'
import { rule } from './user.service.utils'
import type { Actor } from '@identity/core/utils/actor.utils'
import type { UserQuery } from './user.service.types'

/** What a user use case can fail with: its own refusals, or the database. */
export type UserFailure = UserDomainFailure | UserRepositoryFailure

export interface UserServiceShape {
    readonly list: (
        actor: Actor,
        query: UserQuery
    ) => Effect.Effect<UserPage, UserFailure, UserRepository | DatabasePort>
    readonly count: (
        actor: Actor,
        filter: UserFilter
    ) => Effect.Effect<number, UserFailure, UserRepository | DatabasePort>
    readonly findById: (
        actor: Actor,
        id: string
    ) => Effect.Effect<User | null, UserFailure, UserRepository | DatabasePort>
    readonly checkEmail: (
        email: string
    ) => Effect.Effect<boolean, UserFailure, UserRepository | DatabasePort>
    readonly create: (
        actor: Actor,
        input: NewUser
    ) => Effect.Effect<User, UserFailure, UserRepository | DatabasePort>
    readonly update: (
        actor: Actor,
        id: string,
        patch: UserPatch,
        raw: Record<string, unknown>
    ) => Effect.Effect<User, UserFailure, UserRepository | DatabasePort>
    readonly setBanned: (
        actor: Actor,
        id: string,
        banned: boolean
    ) => Effect.Effect<User, UserFailure, UserRepository | DatabasePort>
    readonly delete: (
        actor: Actor,
        id: string
    ) => Effect.Effect<void, UserFailure, UserRepository | DatabasePort>
}

/** Effect key = NestJS token. The implementation is below. */
export class UserService extends Context.Service<
    UserService,
    UserServiceShape
>()('identity/UserService') {}

/**
 * The User domain's rules, composed as Effects.
 *
 * Rules stay synchronous and are lifted with `rule`; database work is already
 * an Effect from `UserRepository`. Each refusal is its own tagged `DomainError`, which the
 * boundary maps by kind (`catchDomainErrors`); a repository failure is left unmapped on purpose.
 */
export class UserServiceImpl implements UserServiceShape {
    list(
        actor: Actor,
        query: UserQuery
    ): Effect.Effect<UserPage, UserFailure, UserRepository | DatabasePort> {
        return Effect.gen(function* () {
            yield* rule(() => {
                userRules.assertCanAdminister(actor)
            })
            const users = yield* UserRepository

            return yield* users.list({
                ...query.filter,
                limit: query.limit,
                offset: query.offset,
                sortField: query.sortField,
                sortDirection: query.sortDirection,
            })
        })
    }

    count(
        actor: Actor,
        filter: UserFilter
    ): Effect.Effect<number, UserFailure, UserRepository | DatabasePort> {
        return Effect.gen(function* () {
            yield* rule(() => {
                userRules.assertCanAdminister(actor)
            })
            const users = yield* UserRepository
            return yield* users.count(filter)
        })
    }

    findById(
        actor: Actor,
        id: string
    ): Effect.Effect<User | null, UserFailure, UserRepository | DatabasePort> {
        return Effect.gen(function* () {
            yield* rule(() => {
                userRules.assertSelfOrAdmin(actor, id)
            })
            const users = yield* UserRepository
            return yield* users.findById(id)
        })
    }

    checkEmail(
        email: string
    ): Effect.Effect<boolean, UserFailure, UserRepository | DatabasePort> {
        return Effect.gen(function* () {
            const users = yield* UserRepository
            return yield* users.emailExists(userRules.normaliseEmail(email))
        })
    }

    create(
        actor: Actor,
        input: NewUser
    ): Effect.Effect<User, UserFailure, UserRepository | DatabasePort> {
        return Effect.gen(function* () {
            yield* rule(() => {
                userRules.assertCanAdminister(actor)
                userRules.assertRoleIsAssignable(actor, input.role)
            })

            const email = userRules.normaliseEmail(input.email)
            yield* rule(() => {
                userRules.assertEmailIsUsable(email)
                userRules.assertNameIsUsable(input.name)
            })

            const users = yield* UserRepository
            if (yield* users.emailExists(email)) {
                return yield* Effect.fail(new EmailTaken({ email }))
            }

            return yield* users.insert({
                name: input.name.trim(),
                email,
                ...(input.image === undefined ? {} : { image: input.image }),
                ...(input.role === undefined ? {} : { role: input.role }),
            })
        })
    }

    update(
        actor: Actor,
        id: string,
        patch: UserPatch,
        raw: Record<string, unknown>
    ): Effect.Effect<User, UserFailure, UserRepository | DatabasePort> {
        return Effect.gen(function* () {
            yield* rule(() => {
                userRules.assertNoAuditFields(raw)
            })

            const users = yield* UserRepository
            const current = yield* users.findById(id)
            if (current === null) {
                return yield* Effect.fail(new UserNotFound({ id }))
            }

            const isSelf = actor.userId === id
            yield* rule(() => {
                userRules.assertSelfOrAdmin(actor, id)
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
                if (yield* users.emailExists(email, id)) {
                    return yield* Effect.fail(new EmailTaken({ email }))
                }
                next.email = email
            }

            if (Object.keys(next).length === 0) return current

            return yield* users.update(id, next)
        })
    }

    setBanned(
        actor: Actor,
        id: string,
        banned: boolean
    ): Effect.Effect<User, UserFailure, UserRepository | DatabasePort> {
        return Effect.gen(function* () {
            yield* rule(() => {
                userRules.assertCanAdminister(actor)
                userRules.assertNotSelfDestruct(
                    actor,
                    id,
                    banned ? 'ban' : 'unban'
                )
            })

            const users = yield* UserRepository
            const current = yield* users.findById(id)
            if (current === null) {
                return yield* Effect.fail(new UserNotFound({ id }))
            }

            if ((current.banned ?? false) === banned) return current

            return yield* users.update(id, { banned })
        })
    }

    delete(
        actor: Actor,
        id: string
    ): Effect.Effect<void, UserFailure, UserRepository | DatabasePort> {
        return Effect.gen(function* () {
            yield* rule(() => {
                userRules.assertCanAdminister(actor)
                userRules.assertNotSelfDestruct(actor, id, 'delete')
            })

            const users = yield* UserRepository
            const current = yield* users.findById(id)
            if (current === null) {
                return yield* Effect.fail(new UserNotFound({ id }))
            }

            yield* users.delete(id)
        })
    }
}
