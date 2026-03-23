/**
 * permission-engine.ts
 *
 * The PermissionEngine provides resource-rule-based access control checks
 * for the organisation layer of the deployer permission system.
 *
 * ── Evaluation algorithm ──────────────────────────────────────────────────
 *   1. platformRole === "superAdmin"  →  ALLOW (bypass everything)
 *   2. Load all role names for (userId, orgId) from the `member` table
 *   3. Load all ResourceRule[] for those role names from `organization_role`
 *   4. Filter rules by (resource, action) match
 *   5. Evaluate each rule's scope — keep only in-scope rules
 *   6. Resolve conflicts via priority:
 *        deny rules:  compute maxDenyPriority
 *        allow rules: any allow.priority > maxDenyPriority  →  ALLOW
 *        equal priority:  deny wins
 *   7. Default: DENY
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Phase A: check() and assert() — full in-memory evaluation.
 * Phase B: buildWhereClause() — compiles rules to a Drizzle SQL predicate.
 */

import type {
    DFilter,
    DynamicVars,
    EngineContext,
    FilterableScalar,
    PermissionCheckResult,
    ProjectResource,
    ResourceRule,
    ResourceScope,
} from "./types";
import { matchFilter } from "./filter-matcher";
import { getAncestorChain } from "./resource-graph";
import { compileDFilter, type ColumnResolver } from "./filter-compiler";
import { and, or, inArray, sql as rawSql, type SQL } from "drizzle-orm";

export type { ColumnResolver };

// ---------------------------------------------------------------------------
// Loader types — injected so the engine stays framework-agnostic
// ---------------------------------------------------------------------------

/**
 * Resolves all role names a user holds in an organisation.
 * Reads from the `member` table (multi-row; one row per role).
 */
export type MemberRoleLoader = (userId: string, orgId: string) => Promise<string[]>;

/**
 * Resolves all ResourceRule[] for a set of role names within an organisation.
 * Reads from `organization_role.resource_rules` (JSONB).
 */
export type OrgRoleLoader = (orgId: string, roleNames: string[]) => Promise<ResourceRule[]>;

/**
 * Optional: loads a resource record for filter-scope rule evaluation.
 * The returned object may include pre-joined relational data under dot-notation
 * keys (e.g. `{ "project.name": "foo" }`) for efficient filter matching.
 *
 * Returns undefined when the resource instance does not exist.
 */
export type ResourceRecordLoader = (
    resource: ProjectResource,
    resourceId: string,
    orgId: string,
) => Promise<Record<string, unknown> | undefined>;

// ---------------------------------------------------------------------------
// PermissionEngine
// ---------------------------------------------------------------------------

export interface PermissionEngineOptions {
    loadMemberRoles: MemberRoleLoader;
    loadOrgRoles: OrgRoleLoader;
    /**
     * Required when any stored rule uses `scope: { type: "filter" }`.
     * If absent and a filter-scope rule is encountered, check() throws.
     */
    loadResourceRecord?: ResourceRecordLoader;
}

export class PermissionEngine {
    constructor(private readonly opts: PermissionEngineOptions) {}

    // -----------------------------------------------------------------------
    // check()
    // -----------------------------------------------------------------------

    /**
     * Evaluates access for a (userId, orgId, resource, action) tuple.
     *
     * @param ctx         Engine context: userId, orgId, platformRole, pre-resolved vars.
     * @param resource    Resource type being accessed.
     * @param action      Action being attempted (e.g. "read", "delete").
     * @param resourceId  Specific resource instance UUID. Required for non-"all" scopes.
     * @param record      Pre-loaded resource object (bypasses loadResourceRecord if provided).
     */
    async check(
        ctx: EngineContext,
        resource: ProjectResource,
        action: string,
        resourceId?: string,
        record?: Record<string, unknown>,
    ): Promise<PermissionCheckResult> {
        // 1. superAdmin bypass
        if (ctx.platformRole === "superAdmin") {
            return { decision: "ALLOW", reason: "superAdmin bypass" };
        }

        // 2. Resolve the user's role names in this org
        const roleNames = await this.opts.loadMemberRoles(ctx.userId, ctx.orgId);
        if (roleNames.length === 0) {
            return { decision: "DENY", reason: "User has no roles in this organization" };
        }

        // 3. Collect all rules across all roles (union merge)
        const allRules = await this.opts.loadOrgRoles(ctx.orgId, roleNames);

        // 4. Filter to rules that match (resource, action)
        const matchingRules = allRules.filter((rule) =>
            ruleMatchesResourceAndAction(rule, resource, action),
        );

        if (matchingRules.length === 0) {
            return {
                decision: "DENY",
                reason: `No rule found for resource="${resource}" action="${action}"`,
            };
        }

        // 5. Evaluate scope for each matching rule
        const applicableRules: ResourceRule[] = [];
        for (const rule of matchingRules) {
            const inScope = await this.evaluateScope(
                rule.scope,
                resource,
                resourceId,
                record,
                ctx,
            );
            if (inScope) {
                applicableRules.push(rule);
            }
        }

        if (applicableRules.length === 0) {
            return {
                decision: "DENY",
                reason: `Resource "${resourceId ?? "(no id)"}" is out of scope for all matching rules`,
            };
        }

        // 6. Priority-based conflict resolution
        const denyRules = applicableRules.filter((r) => r.deny === true);
        const allowRules = applicableRules.filter((r) => r.deny !== true);

        const maxDenyPriority =
            denyRules.length > 0
                ? Math.max(...denyRules.map((r) => r.priority ?? 0))
                : -Infinity;

        const winningAllow = allowRules.find((r) => (r.priority ?? 0) > maxDenyPriority);
        if (winningAllow) {
            return {
                decision: "ALLOW",
                matchedRule: winningAllow,
                reason: "Matched allow rule",
            };
        }

        if (denyRules.length > 0) {
            const topDeny =
                denyRules.find((r) => (r.priority ?? 0) === maxDenyPriority) ?? denyRules[0];
            return {
                decision: "DENY",
                matchedRule: topDeny,
                reason: "Explicit deny rule (priority wins or tie-break)",
            };
        }

        // Allow rules exist but all have priority ≤ maxDenyPriority — deny wins
        return { decision: "DENY", reason: "Default deny (no allow rule exceeds deny priority)" };
    }

    // -----------------------------------------------------------------------
    // assert()
    // -----------------------------------------------------------------------

    /**
     * Like check(), but throws ForbiddenError when the result is DENY.
     * NestJS exception filters convert ForbiddenError → 403.
     */
    async assert(
        ctx: EngineContext,
        resource: ProjectResource,
        action: string,
        resourceId?: string,
        record?: Record<string, unknown>,
    ): Promise<void> {
        const result = await this.check(ctx, resource, action, resourceId, record);
        if (result.decision === "DENY") {
            throw new ForbiddenError(
                `Access denied: resource="${resource}" action="${action}"` +
                    (resourceId ? ` id="${resourceId}"` : "") +
                    `. Reason: ${result.reason}`,
            );
        }
    }

    // -----------------------------------------------------------------------
    // buildWhereClause()
    // -----------------------------------------------------------------------

    /**
     * Produces a Drizzle SQL WHERE predicate that restricts a list query to only
     * the resource instances the user is allowed to access with `action`.
     *
     * Returns `undefined` when the user can access ALL rows (scope: all, no deny).
     * Returns rawSql`1 = 0` when the user has no access at all.
     *
     * Deny rules are applied as NOT predicates over the deny scope.
     *
     * Phase B notes:
     *  - `scope: cascade` — conservatively allows all rows (TODO Phase B.2: FK-chain subquery)
     *  - Priority system is simplified: all deny rules subtract from the allow set.
     *
     * @param ctx        Engine context.
     * @param resource   Resource type being listed.
     * @param action     Action being checked (typically "read" / "list").
     * @param idColumn   SQL expression for the id column of the resource table.
     * @param resolver   Maps dot-notation field path → Drizzle SQL expression.
     */
    async buildWhereClause<
        TSchema extends object = Record<
            string,
            FilterableScalar | FilterableScalar[]
        >,
    >(
        ctx: EngineContext,
        resource: ProjectResource,
        action: string,
        idColumn: SQL,
        resolver: ColumnResolver<TSchema>,
    ): Promise<SQL | undefined> {
        // superAdmin bypass — no WHERE constraint
        if (ctx.platformRole === "superAdmin") {
            return undefined;
        }

        const roleNames = await this.opts.loadMemberRoles(ctx.userId, ctx.orgId);
        if (roleNames.length === 0) {
            return rawSql`1 = 0`; // no access
        }

        const allRules = await this.opts.loadOrgRoles(ctx.orgId, roleNames);
        const matchingRules = allRules.filter((rule) =>
            ruleMatchesResourceAndAction(rule, resource, action),
        );

        if (matchingRules.length === 0) {
            return rawSql`1 = 0`;
        }

        const vars = buildDynamicVars(ctx);
        const allowRules = matchingRules.filter((r) => r.deny !== true);
        const denyRules = matchingRules.filter((r) => r.deny === true);

        if (allowRules.length === 0) {
            return rawSql`1 = 0`; // no allow rules
        }

        // Build allow predicate
        let allowPredicate: SQL | undefined;
        const allowParts: SQL[] = [];
        let allowsAll = false;

        for (const rule of allowRules) {
            const part = this.compileScopeToPredicate<TSchema>(rule.scope, resource, idColumn, resolver, vars);
            if (part === null) {
                allowsAll = true;
                break;
            }
            if (part !== undefined) {
                allowParts.push(part);
            }
        }

        if (!allowsAll) {
            if (allowParts.length === 0) {
                return rawSql`1 = 0`;
            }
            allowPredicate = sqlOr(allowParts);
        }
        // if allowsAll, allowPredicate stays undefined (no WHERE constraint)

        // Build deny predicate
        if (denyRules.length === 0) {
            return allowPredicate;
        }

        const denyParts: SQL[] = [];
        for (const rule of denyRules) {
            const part = this.compileScopeToPredicate<TSchema>(rule.scope, resource, idColumn, resolver, vars);
            if (part === null) {
                return rawSql`1 = 0`; // deny:all — no access
            }
            if (part !== undefined) {
                denyParts.push(part);
            }
        }

        if (denyParts.length === 0) {
            return allowPredicate;
        }

        const denyPredicate = sqlOr(denyParts);
        const notDeny: SQL = rawSql`NOT (${denyPredicate})`;

        if (!allowPredicate) {
            return notDeny; // allowsAll + deny restrictions
        }
        return sqlAnd(allowPredicate, notDeny);
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    /**
     * Compiles a ResourceScope to a Drizzle SQL predicate for buildWhereClause.
     *
     * Returns:
     *  - `null`      when scope.type is "all" or "cascade" (matches all rows / stub)
     *  - `undefined` when no SQL can be produced
     *  - `SQL`       for ids and filter scopes
     */
    private compileScopeToPredicate<
        TSchema extends object = Record<
            string,
            FilterableScalar | FilterableScalar[]
        >,
    >(
        scope: ResourceScope,
        resource: ProjectResource,
        idColumn: SQL,
        resolver: ColumnResolver<TSchema>,
        vars: Partial<DynamicVars>,
    ): SQL | null | undefined {
        switch (scope.type) {
            case "all":
                return null; // signals "matches all rows"

            case "ids": {
                if (scope.values.length === 0) return rawSql`1 = 0`;
                return inArray(
                    idColumn as unknown as Parameters<typeof inArray>[0],
                    scope.values,
                );
            }

            case "cascade": {
                const ancestors = getAncestorChain(resource);
                if (!ancestors.includes(scope.from)) {
                    return undefined; // invalid cascade target — skip
                }
                // TODO (Phase B.2): real FK-chain subquery. For now: conservatively allow all.
                return null;
            }

            case "filter": {
                return compileDFilter<TSchema>(
                    scope.condition as unknown as DFilter<TSchema>,
                    resolver,
                    vars,
                ) ?? undefined;
            }
        }
    }

    private async evaluateScope(
        scope: ResourceScope,
        resource: ProjectResource,
        resourceId: string | undefined,
        record: Record<string, unknown> | undefined,
        ctx: EngineContext,
    ): Promise<boolean> {
        switch (scope.type) {
            case "all":
                return true;

            case "ids": {
                if (!resourceId) return false;
                return scope.values.includes(resourceId);
            }

            case "cascade": {
                if (!resourceId) return false;
                const ancestors = getAncestorChain(resource);
                if (!ancestors.includes(scope.from)) {
                    return false;
                }
                // Phase A: structural check is sufficient.
                // Phase B.2 will replace this with a real DB subquery.
                return true;
            }

            case "filter": {
                if (!resourceId) return false;

                let resolvedRecord = record;
                if (!resolvedRecord) {
                    if (!this.opts.loadResourceRecord) {
                        throw new Error(
                            `PermissionEngine: a filter-scope rule for resource="${resource}" ` +
                                `requires a loadResourceRecord implementation in PermissionEngineOptions.`,
                        );
                    }
                    const loaded = await this.opts.loadResourceRecord(
                        resource,
                        resourceId,
                        ctx.orgId,
                    );
                    if (!loaded) {
                        return false;
                    }
                    resolvedRecord = loaded;
                }

                const vars = buildDynamicVars(ctx);
                return matchFilter(resolvedRecord, scope.condition, vars);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// ForbiddenError
// ---------------------------------------------------------------------------

/**
 * Thrown by PermissionEngine.assert() on DENY.
 * NestJS exception filters should catch this and map to HttpStatus.FORBIDDEN (403).
 */
export class ForbiddenError extends Error {
    readonly code = "PERMISSION_DENIED" as const;

    constructor(message: string) {
        super(message);
        this.name = "ForbiddenError";
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function ruleMatchesResourceAndAction(
    rule: ResourceRule,
    resource: ProjectResource,
    action: string,
): boolean {
    const resourceMatch = rule.resource === "*" || rule.resource === resource;
    const actionMatch =
        rule.actions === "*" ||
        (Array.isArray(rule.actions) && rule.actions.includes(action));
    return resourceMatch && actionMatch;
}

function buildDynamicVars(ctx: EngineContext): Partial<DynamicVars> {
    return {
        $currentUser: ctx.userId,
        $currentOrg: ctx.orgId,
        ...ctx.vars,
    };
}

/**
 * Non-null-asserting OR combinator.
 * Drizzle's or() returns SQL | undefined, but we only call it with non-empty arrays.
 */
function sqlOr(parts: SQL[]): SQL {
    if (parts.length === 0) {
        throw new Error("[IllogicalState] sqlOr called with empty array");
    }
    const result = or(...parts);
    if (!result) throw new Error("[IllogicalState] or() returned undefined with non-empty parts");
    return result;
}

/**
 * Non-null-asserting AND combinator for exactly two SQL fragments.
 */
function sqlAnd(a: SQL, b: SQL): SQL {
    const result = and(a, b);
    if (!result) throw new Error("[IllogicalState] and() returned undefined with two non-null parts");
    return result;
}
