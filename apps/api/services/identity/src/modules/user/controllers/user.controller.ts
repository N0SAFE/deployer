import { Controller } from '@nestjs/common'
import { Implement } from '@orpc/nest'

import { userContract } from '@deployer/identity-contracts'
import {
    accessPublic,
    accessRequired,
    accessSelf,
    procedure,
} from '@deployer/nest-effect'
import { requireAuth } from '@deployer/shared/core/modules/auth/orpc/middlewares'

import { Session, User } from '../access/user.resource'
import { UserService } from '../services/user.service'

import { readFilter, readSortField } from './user.filters'

import type { UserPatch } from '../domain/user.types'

/**
 * The user domain's oRPC surface.
 *
 * Every method binds a contract procedure, takes the actor from the context and
 * delegates to `UserService`, resolved from `effect/context`, through the `.effect()` boundary, which provides
 * the actor and maps failures to the errors the contract declares.
 */
@Controller()
export class UserController {
    @Implement(userContract.list)
    list() {
        return procedure(userContract.list)
            .use(requireAuth())
            .use(accessRequired(User.can('list')))
            .effect(function* ({ input }) {
                const users = yield* UserService

                const limit = input.query.limit
                const offset = input.query.offset

                const page = yield* users.list({
                    limit,
                    offset,
                    sortField: readSortField(input.query.sortBy),
                    sortDirection: input.query.sortDirection ?? 'desc',
                    filter: readFilter(input.query.filter),
                })

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
            .use(accessRequired(({ input }) => User.can('get').on(input.params.id)))
            .effect(function* ({ input }) {
                const users = yield* UserService
                return yield* users.findById(input.params.id)
            })
    }

    /** Delete the caller's own account (`AUTH-032`); the service owns the step-up and last-admin checks. */
    @Implement(userContract.deleteSelf)
    deleteSelf() {
        return procedure(userContract.deleteSelf)
            .use(requireAuth())
            .use(accessSelf(
                    'the caller deletes their own account (last-superAdmin guard in the service)',
                    ({ context }) => context.auth.user.id
                ))
            .effect(function* () {
                const users = yield* UserService
                yield* users.deleteSelf()
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
            .use(accessSelf('the caller exports their own account', ({ context }) => context.auth.user.id))
            .effect(function* () {
                const users = yield* UserService
                return yield* users.exportSelf()
            })
    }

    /** Every session a user holds (`session:list`). */
    @Implement(userContract.listSessions)
    listSessions() {
        return procedure(userContract.listSessions)
            .use(requireAuth())
            .use(accessRequired(Session.can('list')))
            .effect(function* ({ input }) {
                const users = yield* UserService
                const data = yield* users.listSessions(input.params.id)
                return { data }
            })
    }

    /** End one session (`session:revoke`), with a passkey proof. */
    @Implement(userContract.revokeSession)
    revokeSession() {
        return procedure(userContract.revokeSession)
            .use(requireAuth())
            .use(accessRequired(Session.can('revoke')))
            .effect(function* ({ input }) {
                const users = yield* UserService
                yield* users.revokeSession(
                    input.params.id,
                    input.params.sessionId
                )
                return { revoked: true as const }
            })
    }

    /** Set a temporary password (`AUTH-015`); the service owns the step-up, rank and revocation rules. */
    @Implement(userContract.setPassword)
    setPassword() {
        return procedure(userContract.setPassword)
            .use(requireAuth())
            .use(accessRequired(User.can('set-password')))
            .effect(function* ({ input }) {
                const users = yield* UserService
                yield* users.setPassword(input.params.id, input.body.password)
                return { updated: true as const }
            })
    }

    @Implement(userContract.create)
    create() {
        return procedure(userContract.create)
            .use(requireAuth())
            .use(accessRequired(User.can('create')))
            .effect(function* ({ input }) {
                const users = yield* UserService

                const created = yield* users.create({
                    name: input.name,
                    email: input.email,
                    image: input.image ?? null,
                })

                return { status: 201 as const, headers: {}, body: created }
            })
    }

    @Implement(userContract.update)
    update() {
        return procedure(userContract.update)
            .use(requireAuth())
            .use(accessRequired(User.can('update')))
            .effect(function* ({ input }) {
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

                return yield* users.update(id, patch, rest)
            })
    }

    @Implement(userContract.delete)
    delete() {
        return procedure(userContract.delete)
            .use(requireAuth())
            .use(accessRequired(User.can('delete')))
            .effect(function* ({ input }) {
                const users = yield* UserService
                yield* users.delete(input.params.id)

                return { success: true, message: undefined }
            })
    }

    @Implement(userContract.setRole)
    setRole() {
        return procedure(userContract.setRole)
            .use(requireAuth())
            .use(accessRequired(User.can('set-role')))
            .effect(function* ({ input }) {
                const users = yield* UserService
                const updated = yield* users.setRole(
                    input.params.id,
                    input.body.role
                )
                return updated
            })
    }

    @Implement(userContract.setBanned)
    setBanned() {
        return procedure(userContract.setBanned)
            .use(requireAuth())
            .use(accessRequired(User.can('ban')))
            .effect(function* ({ input }) {
                const users = yield* UserService
                return yield* users.setBanned(
                    input.params.id,
                    input.body.banned
                )
            })
    }

    @Implement(userContract.revokeSessions)
    revokeSessions() {
        return procedure(userContract.revokeSessions)
            .use(requireAuth())
            .use(accessRequired(Session.can('delete')))
            .effect(function* ({ input }) {
                const users = yield* UserService
                yield* users.revokeSessions(input.params.id)
                return { revoked: true as const }
            })
    }

    /** Public by design: the signup form's "is this address taken" probe. */
    @Implement(userContract.checkEmail)
    checkEmail() {
        return procedure(userContract.checkEmail)
            .use(
                accessPublic(
                    'pre-signup email availability probe: anonymous and rate-limited'
                )
            )
            .effect(function* ({ input }) {
                const users = yield* UserService
                const exists = yield* users.checkEmail(input.email)
                return { exists }
            })
    }

    @Implement(userContract.count)
    count() {
        return procedure(userContract.count)
            .use(requireAuth())
            .use(accessRequired(User.can('list')))
            .effect(function* ({ input }) {
                const users = yield* UserService

                const query: unknown = input.query
                const filter =
                    typeof query === 'object' &&
                    query !== null &&
                    'filter' in query
                        ? (query as { filter?: unknown }).filter
                        : undefined

                const count = yield* users.count(readFilter(filter))
                return { count }
            })
    }
}
