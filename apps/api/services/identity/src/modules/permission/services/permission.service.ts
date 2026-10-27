import { Injectable } from '@nestjs/common'
import { Context, Effect } from 'effect'
import {
    PermissionEngine,
    ForbiddenError,
    type ProjectResource,
    type ResourceRule,
    type EngineContext,
    type PermissionCheckResult,
    type ColumnResolver,
    type FilterableScalar,
} from '@deployer/auth/permissions'
import type { SQL } from 'drizzle-orm'
import { DatabasePort } from '@identity/core/database/database.port'

import { PermissionRepository } from '../repositories/permission.repository'
import {
    PermissionDenied,
    type PermissionFailure,
} from '../permission.failures'
import type { RoleRuleRow } from '../permission.types'

/**
 * PermissionService — thin wrapper around PermissionEngine.
 *
 * Wires the engine's loader to the repository and exposes a clean surface for
 * controllers and other services:
 *  - check()           → full in-memory evaluation, returns ALLOW | DENY
 *  - assert()          → like check(), fails with ForbiddenError on DENY
 *  - buildWhereClause() → compiles rules to a Drizzle SQL predicate
 *
 * For custom role rules CRUD, delegate directly to PermissionRepository
 * (no business logic needed — it's pure data management).
 */
export interface PermissionServiceShape {
    readonly check: (
        ctx: EngineContext,
        resource: ProjectResource,
        action: string,
        resourceId?: string,
        record?: Record<string, unknown>
    ) => Effect.Effect<
        PermissionCheckResult,
        PermissionFailure,
        PermissionRepository | DatabasePort
    >
    readonly assert: (
        ctx: EngineContext,
        resource: ProjectResource,
        action: string,
        resourceId?: string,
        record?: Record<string, unknown>
    ) => Effect.Effect<
        void,
        PermissionFailure,
        PermissionRepository | DatabasePort
    >
    readonly buildWhereClause: <
        TSchema extends object = Record<
            string,
            FilterableScalar | FilterableScalar[]
        >,
    >(
        ctx: EngineContext,
        resource: ProjectResource,
        action: string,
        idColumn: SQL,
        resolver: ColumnResolver<TSchema>
    ) => Effect.Effect<
        SQL | undefined,
        PermissionFailure,
        PermissionRepository | DatabasePort
    >
    readonly upsertRoleRules: (
        roleName: string,
        rules: ResourceRule[]
    ) => Effect.Effect<
        void,
        PermissionFailure,
        PermissionRepository | DatabasePort
    >
    readonly deleteRoleRules: (
        roleName: string
    ) => Effect.Effect<
        void,
        PermissionFailure,
        PermissionRepository | DatabasePort
    >
    readonly listRoleRules: () => Effect.Effect<
        RoleRuleRow[],
        PermissionFailure,
        PermissionRepository | DatabasePort
    >
}

/** Effect key = NestJS token. The implementation is below. */
export class PermissionService extends Context.Service<
    PermissionService,
    PermissionServiceShape
>()('identity/PermissionService') {
    /** Re-export so callers can catch typed permission denials */
    static readonly ForbiddenError = ForbiddenError
}

/**
 * Builds the engine per call: the loader needs the *current* Effect context to
 * query the repository, so the instance cannot be a field of a long-lived
 * service.
 */
function withEngine<A>(
    run: (engine: PermissionEngine) => Promise<A>
): Effect.Effect<A, PermissionFailure, PermissionRepository | DatabasePort> {
    return Effect.gen(function* () {
        const repo = yield* PermissionRepository
        const context = yield* Effect.context<DatabasePort>()

        const engine = new PermissionEngine({
            // No org layer — the mesh is the single tenant. Rules are keyed by the
            // user's platform role at eval time (see EngineContext).
            loadRoleRules: (role) =>
                Effect.runPromise(
                    repo.getRoleRules([role]).pipe(Effect.provide(context))
                ).catch(() => []),
        })

        // An engine denial is a refusal; any other throw is a bug in the engine, not a refusal.
        return yield* Effect.tryPromise({
            try: () => run(engine),
            catch: (cause) => cause,
        }).pipe(
            Effect.catch((cause) =>
                cause instanceof ForbiddenError
                    ? Effect.fail(
                          new PermissionDenied({ reason: cause.message })
                      )
                    : Effect.die(cause)
            )
        )
    })
}

export class PermissionServiceImpl implements PermissionServiceShape {
    /** Full in-memory permission check. Returns ALLOW | DENY with the matched rule. */
    check(
        ctx: EngineContext,
        resource: ProjectResource,
        action: string,
        resourceId?: string,
        record?: Record<string, unknown>
    ): Effect.Effect<
        PermissionCheckResult,
        PermissionFailure,
        PermissionRepository | DatabasePort
    > {
        return withEngine((engine) =>
            engine.check(ctx, resource, action, resourceId, record)
        )
    }

    /** Like check(), but fails with ForbiddenError when the result is DENY. */
    assert(
        ctx: EngineContext,
        resource: ProjectResource,
        action: string,
        resourceId?: string,
        record?: Record<string, unknown>
    ): Effect.Effect<
        void,
        PermissionFailure,
        PermissionRepository | DatabasePort
    > {
        return withEngine((engine) =>
            engine.assert(ctx, resource, action, resourceId, record)
        )
    }

    /**
     * Compiles rules to a Drizzle SQL predicate suitable for WHERE clauses.
     * Returns `undefined` when access is fully unrestricted (ALLOW ALL).
     *
     * @param idColumn  SQL expression for the id column of the resource table.
     * @param resolver  Maps dot-notation field path → Drizzle SQL expression.
     */
    buildWhereClause<
        TSchema extends object = Record<
            string,
            FilterableScalar | FilterableScalar[]
        >,
    >(
        ctx: EngineContext,
        resource: ProjectResource,
        action: string,
        idColumn: SQL,
        resolver: ColumnResolver<TSchema>
    ): Effect.Effect<
        SQL | undefined,
        PermissionFailure,
        PermissionRepository | DatabasePort
    > {
        return withEngine((engine) =>
            engine.buildWhereClause(ctx, resource, action, idColumn, resolver)
        )
    }

    upsertRoleRules(
        roleName: string,
        rules: ResourceRule[]
    ): Effect.Effect<
        void,
        PermissionFailure,
        PermissionRepository | DatabasePort
    > {
        return Effect.gen(function* () {
            const repo = yield* PermissionRepository
            return yield* repo.upsertRoleRules(roleName, rules)
        })
    }

    deleteRoleRules(
        roleName: string
    ): Effect.Effect<
        void,
        PermissionFailure,
        PermissionRepository | DatabasePort
    > {
        return Effect.gen(function* () {
            const repo = yield* PermissionRepository
            return yield* repo.deleteRoleRules(roleName)
        })
    }

    listRoleRules(): Effect.Effect<
        RoleRuleRow[],
        PermissionFailure,
        PermissionRepository | DatabasePort
    > {
        return Effect.gen(function* () {
            const repo = yield* PermissionRepository
            return yield* repo.listRoleRules()
        })
    }
}
