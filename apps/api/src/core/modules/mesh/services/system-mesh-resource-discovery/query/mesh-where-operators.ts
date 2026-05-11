import type { AnyRecord } from "../types/mesh-resource-discovery-types";
import type { MeshFieldRef } from "./mesh-field-ref";
import {
    makeExpression,
    resolvePathValue,
    buildEqStateHint,
    type MeshWhereExpression,
} from "./mesh-where-expression";

/**
 * Opérateurs de filtre pour MeshResourceQueryBuilder.
 *
 * Tous retournent un MeshWhereExpression composable via and/or/not.
 *
 * @example
 * query.where(
 *   and(
 *     eq(f.ownerNodeId, "node-1"),
 *     contains(path(f.metadata, "region"), "eu"),
 *   )
 * )
 */

export function eq<TRecord extends AnyRecord, TValue>(
    field: MeshFieldRef<TRecord, TValue>,
    value: TValue,
): MeshWhereExpression<TRecord> {
    return makeExpression({
        test: (record) => resolvePathValue(record, field.rootKey, field.path) === value,
        applyState: buildEqStateHint(field, value),
    });
}

export function neq<TRecord extends AnyRecord, TValue>(
    field: MeshFieldRef<TRecord, TValue>,
    value: TValue,
): MeshWhereExpression<TRecord> {
    return makeExpression({
        test: (record) => resolvePathValue(record, field.rootKey, field.path) !== value,
    });
}

export function inArray<TRecord extends AnyRecord, TValue>(
    field: MeshFieldRef<TRecord, TValue>,
    values: readonly TValue[],
): MeshWhereExpression<TRecord> {
    return makeExpression({
        test: (record) =>
            values.includes(resolvePathValue(record, field.rootKey, field.path) as TValue),
    });
}

export function contains<TRecord extends AnyRecord>(
    field: MeshFieldRef<TRecord, unknown>,
    value: string,
): MeshWhereExpression<TRecord> {
    return makeExpression({
        test: (record) => {
            const resolved = resolvePathValue(record, field.rootKey, field.path);
            return typeof resolved === "string" ? resolved.includes(value) : false;
        },
    });
}

export function startsWith<TRecord extends AnyRecord>(
    field: MeshFieldRef<TRecord, unknown>,
    value: string,
): MeshWhereExpression<TRecord> {
    return makeExpression({
        test: (record) => {
            const resolved = resolvePathValue(record, field.rootKey, field.path);
            return typeof resolved === "string" ? resolved.startsWith(value) : false;
        },
    });
}

export function endsWith<TRecord extends AnyRecord>(
    field: MeshFieldRef<TRecord, unknown>,
    value: string,
): MeshWhereExpression<TRecord> {
    return makeExpression({
        test: (record) => {
            const resolved = resolvePathValue(record, field.rootKey, field.path);
            return typeof resolved === "string" ? resolved.endsWith(value) : false;
        },
    });
}

export function exists<TRecord extends AnyRecord>(
    field: MeshFieldRef<TRecord, unknown>,
): MeshWhereExpression<TRecord> {
    return makeExpression({
        test: (record) => {
            const resolved = resolvePathValue(record, field.rootKey, field.path);
            return resolved !== undefined && resolved !== null;
        },
    });
}

export function and<TRecord extends AnyRecord>(
    ...expressions: readonly MeshWhereExpression<TRecord>[]
): MeshWhereExpression<TRecord> {
    return makeExpression({
        test: (record) => expressions.every((expr) => expr.test(record)),
        // Propage tous les state hints en séquence
        applyState: (state) =>
            expressions.reduce(
                (current, expr) => (expr.applyState ? expr.applyState(current) : current),
                state,
            ),
    });
}

export function or<TRecord extends AnyRecord>(
    ...expressions: readonly MeshWhereExpression<TRecord>[]
): MeshWhereExpression<TRecord> {
    return makeExpression({
        // Pas de state hint pour or() — on ne peut pas propager une contrainte ambiguë
        test: (record) => expressions.some((expr) => expr.test(record)),
    });
}

export function not<TRecord extends AnyRecord>(
    expression: MeshWhereExpression<TRecord>,
): MeshWhereExpression<TRecord> {
    return makeExpression({
        test: (record) => !expression.test(record),
    });
}