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
import { serviceOver } from "@deployer/effect-core"

import { DatabasePort } from '@identity/core/database/database.port'



import {
    PermissionDenied,
    PermissionRepositoryFailure,
    type PermissionFailure,
} from '../permission.failures'
import {
    PermissionRepository,
    type PermissionRepositoryShape,
} from '../repositories/permission.repository'

import type { RoleRuleRow } from '../permission.types'
import type { SQL } from 'drizzle-orm'

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
    ) => Effect.Effect<void, PermissionFailure, PermissionRepository | DatabasePort>
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
    ) => Effect.Effect<SQL | undefined, PermissionFailure, PermissionRepository | DatabasePort>
    readonly upsertRoleRules: (
        roleName: string,
        rules: ResourceRule[]
    ) => Effect.Effect<void, PermissionFailure, PermissionRepository | DatabasePort>
    readonly deleteRoleRules: (
        roleName: string
    ) => Effect.Effect<void, PermissionFailure, PermissionRepository | DatabasePort>
    readonly listRoleRules: () => Effect.Effect<
        RoleRuleRow[],
        PermissionFailure,
        PermissionRepository | DatabasePort
    >
}

/** Tag and implementation together: the tag is the contract, `Live` the one implementation. */
export class PermissionService extends Context.Service<
    PermissionService,
    PermissionServiceShape
>()('identity/PermissionService') {
    /** The repository is yielded when a method runs, so this is a constant the module provides with `useValue`. */
    static readonly live = serviceOver(PermissionRepository, makePermissionService);


    /** Re-export so callers can catch typed permission denials */
    static readonly ForbiddenError = ForbiddenError
}

/**
 * Wires the engine's loader to the repository and exposes the engine's operations as Effects.
 *
 * The engine is built per call, over the repository handed in here, so nothing about a request
 * lives in a long-lived field.
 */
function makePermissionService(
    roleRules: PermissionRepositoryShape
): PermissionServiceShape {
    const withEngine = <A>(
        run: (engine: PermissionEngine) => Promise<A>
    ): Effect.Effect<A, PermissionFailure> => {
        const engine = new PermissionEngine({
            // No org layer — the mesh is the single tenant. Rules are keyed by the
            // user's platform role at eval time (see EngineContext).
            // The engine's loader is Promise-based, so the repository Effect is run outside the context it would
            // need: the assertion states the requirement the engine cannot carry. A failed load is NOT swallowed —
            // an empty rule list means "deny everything", so hiding a database outage behind it turned an outage into
            // a permission policy, and the reason string said "No rules configured" instead of "the query failed".
            loadRoleRules: (role) =>
                Effect.runPromise(
                    roleRules.getRoleRules([role]) as Effect.Effect<
                        ResourceRule[],
                        PermissionRepositoryFailure
                    >
                ),
        })

        // An engine denial is a refusal, a repository failure is a dependency failure, and anything else is a bug in
        // the engine — thrown from here it becomes a defect, not a permission answer.
        return Effect.tryPromise({
            try: () => run(engine),
            catch: (cause: unknown): PermissionFailure => {
                if (cause instanceof ForbiddenError) {
                    return new PermissionDenied({ reason: cause.message })
                }
                if (cause instanceof PermissionRepositoryFailure) {
                    return cause
                }
                throw cause
            },
        })
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
