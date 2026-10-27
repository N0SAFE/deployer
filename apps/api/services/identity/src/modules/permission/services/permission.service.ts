import { Context, Effect, Layer } from 'effect'
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

import {
    PermissionRepository,
    type PermissionRepositoryShape,
} from '../repositories/permission.repository'
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
    ) => Effect.Effect<PermissionCheckResult, PermissionFailure>
    readonly assert: (
        ctx: EngineContext,
        resource: ProjectResource,
        action: string,
        resourceId?: string,
        record?: Record<string, unknown>
    ) => Effect.Effect<void, PermissionFailure>
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
    ) => Effect.Effect<SQL | undefined, PermissionFailure>
    readonly upsertRoleRules: (
        roleName: string,
        rules: ResourceRule[]
    ) => Effect.Effect<void, PermissionFailure>
    readonly deleteRoleRules: (
        roleName: string
    ) => Effect.Effect<void, PermissionFailure>
    readonly listRoleRules: () => Effect.Effect<
        RoleRuleRow[],
        PermissionFailure
    >
}

/** Tag and implementation together: the tag is the contract, `Live` the one implementation. */
export class PermissionService extends Context.Service<
    PermissionService,
    PermissionServiceShape
>()('identity/PermissionService') {
    /** Leaves `PermissionRepository` open, so a test swaps it without touching the database. */
    static readonly Live: Layer.Layer<
        PermissionService,
        never,
        PermissionRepository
    > = Layer.effect(
        PermissionService,
        Effect.gen(function* () {
            const roleRules = yield* PermissionRepository
            return makePermissionService(roleRules)
        })
    )

    /** Re-export so callers can catch typed permission denials */
    static readonly ForbiddenError = ForbiddenError
}

/**
 * Wires the engine's loader to the repository and exposes the engine's operations as Effects.
 *
 * The engine is built per call, over the repository handed in here, so nothing about a request
 * lives in a long-lived field.
 */
export function makePermissionService(
    roleRules: PermissionRepositoryShape
): PermissionServiceShape {
    const withEngine = <A>(
        run: (engine: PermissionEngine) => Promise<A>
    ): Effect.Effect<A, PermissionFailure> => {
        const engine = new PermissionEngine({
            // No org layer — the mesh is the single tenant. Rules are keyed by the
            // user's platform role at eval time (see EngineContext).
            loadRoleRules: (role) =>
                Effect.runPromise(roleRules.getRoleRules([role])).catch(
                    () => []
                ),
        })

        // An engine denial is a refusal; any other throw is a bug in the engine, not a refusal.
        return Effect.tryPromise({
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
    }

    return {
        /** Full in-memory permission check. Returns ALLOW | DENY with the matched rule. */
        check: (ctx, resource, action, resourceId, record) =>
            withEngine((engine) =>
                engine.check(ctx, resource, action, resourceId, record)
            ),

        /** Like check(), but fails with PermissionDenied when the result is DENY. */
        assert: (ctx, resource, action, resourceId, record) =>
            withEngine((engine) =>
                engine.assert(ctx, resource, action, resourceId, record)
            ),

        /**
         * Compiles rules to a Drizzle SQL predicate suitable for WHERE clauses.
         * Returns `undefined` when access is fully unrestricted (ALLOW ALL).
         *
         * `idColumn` is the SQL expression for the id column of the resource table;
         * `resolver` maps a dot-notation field path to a Drizzle SQL expression.
         */
        buildWhereClause: (ctx, resource, action, idColumn, resolver) =>
            withEngine((engine) =>
                engine.buildWhereClause(
                    ctx,
                    resource,
                    action,
                    idColumn,
                    resolver
                )
            ),

        upsertRoleRules: (roleName, rules) =>
            roleRules.upsertRoleRules(roleName, rules),
        deleteRoleRules: (roleName) => roleRules.deleteRoleRules(roleName),
        listRoleRules: () => roleRules.listRoleRules(),
    }
}
