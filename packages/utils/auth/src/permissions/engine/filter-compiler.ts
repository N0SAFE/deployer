/**
 * filter-compiler.ts
 *
 * Compiles a DFilter condition into a Drizzle ORM SQL predicate.
 *
 * This module bridges the in-memory `matchFilter` (used by check()) with
 * a SQL-generating counterpart used by `buildWhereClause()` for list queries.
 *
 * Architecture:
 * - `ColumnResolver`: caller-provided function mapping a field path → SQL expression.
 *   The resolver is context-free — it maps strings, it doesn't know about resources.
 *   The NestJS module provides a resolver that knows the Drizzle schema for the resource.
 * - `compileDFilter()`: recursive; converts DFilter → `SQL | undefined`.
 *
 * Important: this module imports from `drizzle-orm` which is a peerDependency
 * of `@repo/auth`. Callers must have `drizzle-orm` in their dependencies.
 */

import {
    and,
    or,
    eq,
    ne,
    like,
    ilike,
    gt,
    gte,
    lt,
    lte,
    inArray,
    notInArray,
    isNull,
    isNotNull,
    sql as rawSql,
    type SQL,
    type SQLWrapper,
} from "drizzle-orm";
import type { DFilter, DFilterOperator, DynamicVars, FilterableScalar } from "./types";
import { isVariable } from "./types";
import { MAX_FILTER_DEPTH } from "./filter-matcher";

// ---------------------------------------------------------------------------
// ColumnResolver type
// ---------------------------------------------------------------------------

/**
 * Maps a field path from `TSchema` to a Drizzle SQL expression.
 *
 * - Return a typed column reference for direct columns.
 * - Return a subquery SQL fragment for relational paths.
 * - Return `undefined` for fields that cannot be resolved — the compiler skips them.
 *
 * @typeParam TSchema  The schema whose keys are valid field paths. Defaults to
 *   `Record<string, FilterableScalar | FilterableScalar[]>` (i.e. `string`
 *   keys) when the field set is not statically known.
 *
 * @example
 * ```ts
 * type ProjectSchema = { name: string; status: string; budget: number };
 *
 * const resolver: ColumnResolver<ProjectSchema> = (field) => ({
 *   name:   sql`"projects"."name"`,
 *   status: sql`"projects"."status"`,
 *   budget: sql`"projects"."budget"`,
 * })[field];
 * // field is now autocompleted as "name" | "status" | "budget"
 * ```
 */
export type ColumnResolver<
    TSchema extends object = Record<
        string,
        FilterableScalar | FilterableScalar[]
    >,
> = (fieldPath: keyof TSchema & string) => SQL | undefined;

// ---------------------------------------------------------------------------
// compileDFilter
// ---------------------------------------------------------------------------

/**
 * Compiles a DFilter into a Drizzle SQL predicate.
 *
 * @typeParam TSchema  Schema record mapping field paths to their value types.
 *                     Constrains both the resolver parameter types and the
 *                     field keys accepted in the filter.
 * @typeParam TVars    Dynamic-vars record for `_eq_var` / `_in_var` resolution.
 *
 * @param filter    The DFilter condition to compile.
 * @param resolver  Maps field paths to Drizzle SQL column expressions.
 * @param vars      Pre-resolved dynamic variables from EngineContext.
 * @param depth     Internal recursion counter — do not pass externally.
 * @returns Drizzle SQL predicate, or `undefined` if the filter produces no conditions.
 */
export function compileDFilter<
    TSchema extends object = Record<
        string,
        FilterableScalar | FilterableScalar[]
    >,
    TVars extends object = DynamicVars,
>(
    filter: DFilter<TSchema, TVars>,
    resolver: ColumnResolver<TSchema>,
    vars: Partial<TVars> = {} as Partial<TVars>,
    depth = 0,
): SQL | undefined {
    if (depth > MAX_FILTER_DEPTH) {
        throw new Error(
            `DFilter compile depth exceeded MAX_FILTER_DEPTH (${String(MAX_FILTER_DEPTH)}). ` +
                `Simplify the filter condition.`,
        );
    }

    // DFilter<TSchema, TVars> is a mapped-type intersection and has no string
    // index signature. Cast to a loose shape for safe key iteration — TVars
    // has already been enforced at the call site.
    const fields = filter as unknown as Record<
        string,
        DFilterOperator<unknown> | DFilter<TSchema, TVars>[] | undefined
    >;
    const parts: SQL[] = [];

    for (const key of Object.keys(fields)) {
        if (key === "_and") {
            const andClauses = filter._and;
            if (!Array.isArray(andClauses)) {
                throw new Error("DFilter._and must be an array");
            }
            const compiled = andClauses
                .map((sub) => compileDFilter<TSchema, TVars>(sub, resolver, vars, depth + 1))
                .filter((x): x is SQL => x !== undefined);
            if (compiled.length === 1) parts.push(...compiled);
            else if (compiled.length > 1) parts.push(sqlAnd(compiled));
            continue;
        }

        if (key === "_or") {
            const orClauses = filter._or;
            if (!Array.isArray(orClauses)) {
                throw new Error("DFilter._or must be an array");
            }
            const compiled = orClauses
                .map((sub) => compileDFilter<TSchema, TVars>(sub, resolver, vars, depth + 1))
                .filter((x): x is SQL => x !== undefined);
            if (compiled.length === 1) parts.push(...compiled);
            else if (compiled.length > 1) parts.push(sqlOr(compiled));
            continue;
        }

        // Field comparison — skip non-operator values (e.g. leftover _and/_or arrays)
        const rawValue = fields[key];
        if (rawValue === undefined || Array.isArray(rawValue)) continue;

        const column = resolver(key as keyof TSchema & string);
        if (!column) continue; // unresolvable field — skip silently

        const compiled = compileOperator(column, rawValue, vars as Record<string, unknown>);
        if (compiled) {
            parts.push(compiled);
        }
    }

    if (parts.length === 0) return undefined;
    if (parts.length === 1) {
        const [only] = parts;
        if (!only) return undefined;
        return only;
    }
    return sqlAnd(parts);
}

// ---------------------------------------------------------------------------
// per-operator SQL compilation
// ---------------------------------------------------------------------------

/**
 * Resolves a `Variable` reference from the runtime vars map.
 * Throws a descriptive error if the variable is not present in `vars`.
 */
function resolveVar(variable: { name: string }, vars: Record<string, unknown>, hint: string): unknown {
    const resolved = vars[variable.name];
    if (resolved === undefined) {
        throw new Error(
            `PermissionEngine filter-compiler: dynamic variable "${variable.name}" is not set in vars` +
                (hint ? ` (used in operator ${hint})` : ""),
        );
    }
    return resolved;
}

function compileOperator(
    column: SQL,
    op: DFilterOperator<unknown>,
    vars: Record<string, unknown>,
): SQL | undefined {
    const col = asWrapper(column);

    // Equality
    if ("_eq" in op && op._eq !== undefined) {
        const val = isVariable(op._eq) ? resolveVar(op._eq, vars, "_eq") : op._eq;
        return eq(col, val as FilterableScalar);
    }
    if ("_neq" in op && op._neq !== undefined) {
        const val = isVariable(op._neq) ? resolveVar(op._neq, vars, "_neq") : op._neq;
        return ne(col, val as FilterableScalar);
    }

    // Inclusion
    if ("_in" in op && op._in !== undefined) {
        const list = isVariable(op._in) ? resolveVar(op._in, vars, "_in") : op._in;
        if (!Array.isArray(list)) {
            throw new Error(
                isVariable(op._in)
                    ? `PermissionEngine filter-compiler: variable "${op._in.name}" must resolve to an array for _in`
                    : "DFilter._in operand must be an array",
            );
        }
        if (list.length === 0) return rawSql`1 = 0`;
        return inArray(col, list as FilterableScalar[]);
    }
    if ("_nin" in op && op._nin !== undefined) {
        const list = isVariable(op._nin) ? resolveVar(op._nin, vars, "_nin") : op._nin;
        if (!Array.isArray(list)) {
            throw new Error(
                isVariable(op._nin)
                    ? `PermissionEngine filter-compiler: variable "${op._nin.name}" must resolve to an array for _nin`
                    : "DFilter._nin operand must be an array",
            );
        }
        if (list.length === 0) return undefined;
        return notInArray(col, list as FilterableScalar[]);
    }

    // Null checks
    if ("_null" in op && op._null !== undefined) {
        return op._null ? isNull(col) : isNotNull(col);
    }
    if ("_nnull" in op && op._nnull !== undefined) {
        return op._nnull ? isNotNull(col) : isNull(col);
    }

    // String operators — like/ilike only accept SQL<unknown>, not SQLWrapper
    if ("_contains" in op && op._contains !== undefined) {
        const val = isVariable(op._contains) ? String(resolveVar(op._contains, vars, "_contains")) : op._contains;
        return like(column, `%${val}%`);
    }
    if ("_icontains" in op && op._icontains !== undefined) {
        const val = isVariable(op._icontains) ? String(resolveVar(op._icontains, vars, "_icontains")) : op._icontains;
        return ilike(column, `%${val}%`);
    }
    if ("_starts_with" in op && op._starts_with !== undefined) {
        const val = isVariable(op._starts_with) ? String(resolveVar(op._starts_with, vars, "_starts_with")) : op._starts_with;
        return like(column, `${val}%`);
    }
    if ("_ends_with" in op && op._ends_with !== undefined) {
        const val = isVariable(op._ends_with) ? String(resolveVar(op._ends_with, vars, "_ends_with")) : op._ends_with;
        return like(column, `%${val}`);
    }

    // Numeric comparisons
    if ("_gt" in op && op._gt !== undefined) {
        const val = isVariable(op._gt) ? resolveVar(op._gt, vars, "_gt") : op._gt;
        return gt(col, val as number | string);
    }
    if ("_gte" in op && op._gte !== undefined) {
        const val = isVariable(op._gte) ? resolveVar(op._gte, vars, "_gte") : op._gte;
        return gte(col, val as number | string);
    }
    if ("_lt" in op && op._lt !== undefined) {
        const val = isVariable(op._lt) ? resolveVar(op._lt, vars, "_lt") : op._lt;
        return lt(col, val as number | string);
    }
    if ("_lte" in op && op._lte !== undefined) {
        const val = isVariable(op._lte) ? resolveVar(op._lte, vars, "_lte") : op._lte;
        return lte(col, val as number | string);
    }

    throw new Error(`DFilter compiler: unknown operator in: ${JSON.stringify(op)}`);
}

// ---------------------------------------------------------------------------
// Internal SQL helpers
// ---------------------------------------------------------------------------

/**
 * Cast a SQL expression to SQLWrapper, which is accepted by all Drizzle operators.
 * SQL<T> always implements SQLWrapper (it has getSQL()), so this cast is safe.
 */
function asWrapper(s: SQL): SQLWrapper {
    return s as unknown as SQLWrapper;
}

/**
 * AND-combine an array of SQL fragments. Throws on empty input.
 */
function sqlAnd(parts: SQL[]): SQL {
    if (parts.length === 0) throw new Error("[IllogicalState] sqlAnd called with empty array");
    const result = and(...parts);
    if (!result) throw new Error("[IllogicalState] and() returned undefined with non-empty parts");
    return result;
}

/**
 * OR-combine an array of SQL fragments. Throws on empty input.
 */
function sqlOr(parts: SQL[]): SQL {
    if (parts.length === 0) throw new Error("[IllogicalState] sqlOr called with empty array");
    const result = or(...parts);
    if (!result) throw new Error("[IllogicalState] or() returned undefined with non-empty parts");
    return result;
}
