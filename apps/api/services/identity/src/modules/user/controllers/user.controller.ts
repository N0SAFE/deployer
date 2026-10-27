import { Controller } from '@nestjs/common'
import { Implement } from '@orpc/nest'
import { implement } from '@orpc/server'
import { EffectContextOf } from '@deployer/nest-effect'

import { UserDomainModule } from '../user.module'

import { userContract } from '@deployer/identity-contracts'
import { requireAuth } from '@deployer/shared/core/modules/auth/orpc/middlewares'
import { serve, serveAnonymous } from '@identity/core/orpc/serve'

import type { UserPatch } from '../domain/user.types'
import { UserService } from '../services/user.service'
import { readFilter, readSortField } from './user.filters'

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
        return implement(userContract.list)
            .use(requireAuth())
            .use(UserDomainModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const users = yield* UserService

                const limit = input.query?.limit ?? 20
                const offset = input.query?.offset ?? 0

                const page = yield* serve(context)(users.list({
                        limit,
                        offset,
                        sortField: readSortField(input.query?.sortBy),
                        sortDirection: input.query?.sortDirection ?? 'desc',
                        filter: readFilter(input.query?.filter),
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
        return implement(userContract.findById)
            .use(requireAuth())
            .use(UserDomainModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const users = yield* UserService
                return yield* serve(context)(users.findById(input.params.id))
            })
    }

    @Implement(userContract.create)
    create() {
        return implement(userContract.create)
            .use(requireAuth())
            .use(UserDomainModule[EffectContextOf])
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
        return implement(userContract.update)
            .use(requireAuth())
            .use(UserDomainModule[EffectContextOf])
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
        return implement(userContract.delete)
            .use(requireAuth())
            .use(UserDomainModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const users = yield* UserService
                yield* serve(context)(users.delete(input.params.id))

                return { success: true, message: undefined }
            })
    }

    /** Public by design: the signup form's "is this address taken" probe. */
    @Implement(userContract.checkEmail)
    checkEmail() {
        return implement(userContract.checkEmail)
            .use(UserDomainModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const users = yield* UserService
                const exists = yield* serveAnonymous(context)(users.checkEmail(input.email))
                return { exists }
            })
    }

    @Implement(userContract.count)
    count() {
        return implement(userContract.count)
            .use(requireAuth())
            .use(UserDomainModule[EffectContextOf])
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
