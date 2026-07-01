/**
 * filter-matcher.ts
 *
 * In-memory evaluation of a DFilter against a plain JS object representing
 * a single resource record.  Used by PermissionEngine.check() for
 * filter-scoped rules (scope.type === "filter").
 *
 * Rules:
 *  - Max recursion depth: MAX_FILTER_DEPTH (10) — enforced at eval time.
 *  - Dynamic variables ($currentUser, etc.) are resolved from EngineContext.vars.
 *  - Relational dot-notation (e.g. "project.name") is resolved by first checking
 *    for an exact flat key, then walking the nested object structure.
 *    Callers may pre-flatten relational data into the record for efficiency.
 */

import type { DFilter, DFilterOperator, DynamicVars, FilterableScalar } from "./types";
import { isVariable } from "./types";
import { isRecord, isObjectLike } from "@repo/type-guards"

/**
 * Maximum allowed nesting depth for a DFilter condition.
 * Enforced both at storage time (rule-validator) and at eval time here.
 */
export const MAX_FILTER_DEPTH = 10;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true if the resource `record` satisfies `filter`.
 *
 * @typeParam TSchema  Schema record mapping field paths to their value types.
 *                     Constrains which field keys are valid in the filter.
 * @typeParam TVars    Dynamic-vars record for `_eq_var` / `_in_var` resolution.
 *
 * @param record  A plain object containing the resource's fields (supports
 *                pre-flattened dot-notation keys, e.g. `{ "project.name": "foo" }`).
 * @param filter  The DFilter condition to evaluate.
 * @param vars    Resolved dynamic variables from EngineContext.
 * @param depth   Internal recursion counter — do not pass externally.
 */

/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys. Used in place of `as Record<string, unknown>`
 * to avoid the runtime lie.
 */
export function matchFilter<
    TSchema extends object = Record<
        string,
        FilterableScalar | FilterableScalar[]
    >,
    TVars extends object = DynamicVars,
>(
    record: Record<string, unknown>,
    filter: DFilter<TSchema, TVars>,
    vars: Partial<TVars> = {},
    depth = 0,
): boolean {
    if (depth > MAX_FILTER_DEPTH) {
        throw new Error(
            `DFilter recursion depth exceeded MAX_FILTER_DEPTH (${String(MAX_FILTER_DEPTH)}). ` +
                `Simplify the filter condition.`,
        );
    }

    // DFilter<TSchema, TVars> is a mapped-type intersection with no string
    // index signature; cast to allow safe key iteration at runtime.
    const fields = filter as unknown as Record<
        string,
        DFilterOperator<unknown> | DFilter<TSchema, TVars>[] | undefined
    >;

    for (const key of Object.keys(fields)) {
        if (key === "_and") {
            const andClauses = filter._and;
            if (!Array.isArray(andClauses)) {
                throw new Error("DFilter._and must be an array of DFilter objects");
            }
            if (!andClauses.every((sub) => matchFilter<TSchema, TVars>(record, sub, vars, depth + 1))) {
                return false;
            }
            continue;
        }

        if (key === "_or") {
            const orClauses = filter._or;
            if (!Array.isArray(orClauses)) {
                throw new Error("DFilter._or must be an array of DFilter objects");
            }
            if (!orClauses.some((sub) => matchFilter<TSchema, TVars>(record, sub, vars, depth + 1))) {
                return false;
            }
            continue;
        }

        // Field-level comparison — skip non-operator values (e.g. leftover arrays)
        const rawValue = fields[key];
        if (rawValue === undefined || Array.isArray(rawValue)) continue;

        const fieldValue = resolveField(record, key);

        if (!matchOperator(fieldValue, rawValue, vars)) {
            return false;
        }
    }

    return true;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolves a (possibly dot-notation) field path from a record.
 *
 * Strategy:
 *   1. Exact key match first — supports callers that pre-flatten relational fields
 *      (e.g. `{ "project.name": "foo" }`).
 *   2. Fallback: walk the nested object structure by splitting on ".".
 */
function resolveField(record: Record<string, unknown>, path: string): unknown {
    if (Object.prototype.hasOwnProperty.call(record, path)) {
        return record[path];
    }

    const parts = path.split(".");
    let current: unknown = record;
    for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        if (typeof current !== "object") return undefined;
        current = (current as Record<string, unknown>)[part];
    }

    return current;
}

/**
 * Resolves a `Variable` reference from the runtime vars map.
 */
function resolveVar(variable: { name: string }, vars: Record<string, unknown>): unknown {
    const resolved = vars[variable.name];
    if (resolved === undefined) {
        throw new Error(
            `PermissionEngine: dynamic variable "${variable.name}" is not set in vars`,
        );
    }
    return resolved;
}

/**
 * Evaluates a single DFilterOperator against a resolved field value.
 *
 * @throws Error on unknown operator or invalid operand type.
 */
function matchOperator(
    fieldValue: unknown,
    op: DFilterOperator<unknown>,
    vars: Record<string, unknown>,
): boolean {
    // Equality
    if ("_eq" in op) {
        const val = isVariable(op._eq) ? resolveVar(op._eq, vars) : op._eq;
        return fieldValue === val;
    }
    if ("_neq" in op) {
        const val = isVariable(op._neq) ? resolveVar(op._neq, vars) : op._neq;
        return fieldValue !== val;
    }

    // Inclusion
    if ("_in" in op) {
        const list = isVariable(op._in) ? resolveVar(op._in, vars) : op._in;
        if (!Array.isArray(list)) throw new Error("DFilter._in operand must be an array");
        return list.includes(fieldValue);
    }
    if ("_nin" in op) {
        const list = isVariable(op._nin) ? resolveVar(op._nin, vars) : op._nin;
        if (!Array.isArray(list)) throw new Error("DFilter._nin operand must be an array");
        return !list.includes(fieldValue);
    }

    // Null checks
    if ("_null" in op) {
        const isNull = fieldValue === null || fieldValue === undefined;
        return op._null ? isNull : !isNull;
    }
    if ("_nnull" in op) {
        const isNotNull = fieldValue !== null && fieldValue !== undefined;
        return op._nnull ? isNotNull : !isNotNull;
    }

    // String operators
    if ("_contains" in op) {
        if (typeof fieldValue !== "string") return false;
        const pattern = isVariable(op._contains) ? String(resolveVar(op._contains, vars)) : op._contains;
        if (pattern === undefined) return false;
        return fieldValue.includes(pattern);
    }
    if ("_icontains" in op) {
        if (typeof fieldValue !== "string") return false;
        const pattern = isVariable(op._icontains) ? String(resolveVar(op._icontains, vars)) : op._icontains;
        if (pattern === undefined) return false;
        return fieldValue.toLowerCase().includes(pattern.toLowerCase());
    }
    if ("_starts_with" in op) {
        if (typeof fieldValue !== "string") return false;
        const pattern = isVariable(op._starts_with) ? String(resolveVar(op._starts_with, vars)) : op._starts_with;
        if (pattern === undefined) return false;
        return fieldValue.startsWith(pattern);
    }
    if ("_ends_with" in op) {
        if (typeof fieldValue !== "string") return false;
        const pattern = isVariable(op._ends_with) ? String(resolveVar(op._ends_with, vars)) : op._ends_with;
        if (pattern === undefined) return false;
        return fieldValue.endsWith(pattern);
    }

    // Numeric comparisons
    if ("_gt" in op) {
        const val = isVariable(op._gt) ? resolveVar(op._gt, vars) : op._gt;
        return typeof fieldValue === "number" && fieldValue > (val as number);
    }
    if ("_gte" in op) {
        const val = isVariable(op._gte) ? resolveVar(op._gte, vars) : op._gte;
        return typeof fieldValue === "number" && fieldValue >= (val as number);
    }
    if ("_lt" in op) {
        const val = isVariable(op._lt) ? resolveVar(op._lt, vars) : op._lt;
        return typeof fieldValue === "number" && fieldValue < (val as number);
    }
    if ("_lte" in op) {
        const val = isVariable(op._lte) ? resolveVar(op._lte, vars) : op._lte;
        return typeof fieldValue === "number" && fieldValue <= (val as number);
    }

    throw new Error(`DFilter: unknown operator in: ${JSON.stringify(op)}`);
}
