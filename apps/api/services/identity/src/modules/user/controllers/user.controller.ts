import { Controller } from '@nestjs/common'
import { Implement } from '@orpc/nest'


import { userContract } from '@deployer/identity-contracts'
import { procedure } from '@deployer/nest-effect'
import { requireAuth } from '@deployer/shared/core/modules/auth/orpc/middlewares'

import { serve, serveAnonymous } from '@identity/core/orpc/serve'

import { UserService } from '../services/user.service'

import { readFilter, readSortField } from './user.filters'

import type { UserPatch } from '../domain/user.types'

/**
 * The user domain's oRPC surface.
 *
 * Every method binds a contract procedure, takes the actor from the context and
 * delegates to `UserService`, resolved from `effect/context`, through `serve`, which provides
 * the actor and maps failures to the errors the contract declares.
 */
@Controller()
export class UserController {
    @Implement(userContract.list)
    list() {
        return procedure(userContract.list)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const users = yield* UserService

                const limit = input.query.limit
                const offset = input.query.offset

                const page = yield* serve(context)(users.list({
                        limit,
                        offset,
                        sortField: readSortField(input.query.sortBy),
                        sortDirection: input.query.sortDirection ?? 'desc',
                        filter: readFilter(input.query.filter),
                    }))

                return {
                    data: page.data,
                    meta: {
                        total: page.total,
                        limit,
                        offset,
                        hasMore: offset + page.data.length < page.total,
                    },
                }
            })
    }

    @Implement(userContract.findById)
    findById() {
        return procedure(userContract.findById)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const users = yield* UserService
                return yield* serve(context)(users.findById(input.params.id))
            })
    }

    /** Delete the caller's own account (`AUTH-032`); the service owns the step-up and last-admin checks. */
    @Implement(userContract.deleteSelf)
    deleteSelf() {
        return procedure(userContract.deleteSelf)
            .use(requireAuth())
            .effect(function* ({ context }) {
                const users = yield* UserService
                yield* serve(context)(users.deleteSelf())
                return { deleted: true as const }
            })
    }

    /**
     * The caller's own data (`AUTH-032`).
     *
     * `requireAuth()` is the whole authorization: the service scopes the read to the session's user, so there is no id
     * to tamper with and no role that could widen it.
     */
    @Implement(userContract.exportSelf)
    exportSelf() {
        return procedure(userContract.exportSelf)
            .use(requireAuth())
            .effect(function* ({ context }) {
                const users = yield* UserService
                return yield* serve(context)(users.exportSelf())
            })
    }

    /** Set a temporary password (`AUTH-015`); the service owns the step-up, rank and revocation rules. */
    @Implement(userContract.setPassword)
    setPassword() {
        return procedure(userContract.setPassword)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const users = yield* UserService
                yield* serve(context)(users.setPassword(input.params.id, input.body.password))
                return { updated: true as const }
            })
    }

    @Implement(userContract.create)
    create() {
        return procedure(userContract.create)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const users = yield* UserService

                const created = yield* serve(context)(users.create({
                        name: input.name,
                        email: input.email,
                        image: input.image ?? null,
                    }))

                return { status: 201 as const, headers: {}, body: created }
            })
    }

    @Implement(userContract.update)
    update() {
        return procedure(userContract.update)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const users = yield* UserService
                const { id, ...rest } = input

                const patch: UserPatch = {
                    ...(rest.name === undefined ? {} : { name: rest.name }),
                    ...(rest.email === undefined ? {} : { email: rest.email }),
                    ...(rest.emailVerified === undefined
                        ? {}
                        : { emailVerified: rest.emailVerified }),
                    ...(rest.role === undefined ? {} : { role: rest.role }),
                    ...(rest.banned === undefined
                        ? {}
                        : { banned: rest.banned }),
                }

                return yield* serve(context)(users.update(id, patch, rest))
            })
    }

    @Implement(userContract.delete)
    delete() {
        return procedure(userContract.delete)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const users = yield* UserService
                yield* serve(context)(users.delete(input.params.id))

                return { success: true, message: undefined }
            })
    }

    @Implement(userContract.setRole)
    setRole() {
        return procedure(userContract.setRole)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const users = yield* UserService
                const updated = yield* serve(context)(users.setRole(input.params.id, input.body.role))
                return updated
            })
    }

    @Implement(userContract.setBanned)
    setBanned() {
        return procedure(userContract.setBanned)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const users = yield* UserService
                return yield* serve(context)(users.setBanned(input.params.id, input.body.banned))
            })
    }

    @Implement(userContract.revokeSessions)
    revokeSessions() {
        return procedure(userContract.revokeSessions)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const users = yield* UserService
                yield* serve(context)(users.revokeSessions(input.params.id))
                return { revoked: true as const }
            })
    }

    /** Public by design: the signup form's "is this address taken" probe. */
    @Implement(userContract.checkEmail)
    checkEmail() {
        return procedure(userContract.checkEmail)
            .effect(function* ({ input, context }) {
                const users = yield* UserService
                const exists = yield* serveAnonymous(context)(users.checkEmail(input.email))
                return { exists }
            })
    }

    @Implement(userContract.count)
    count() {
        return procedure(userContract.count)
            .use(requireAuth())
            .effect(function* ({ input, context }) {
                const users = yield* UserService

                const query: unknown = input.query
                const filter =
                    typeof query === 'object' &&
                    query !== null &&
                    'filter' in query
                        ? (query as { filter?: unknown }).filter
                        : undefined

                const count = yield* serve(context)(users.count(readFilter(filter)))
                return { count }
            })
    }
}
