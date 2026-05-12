

// ─── Expression brand ─────────────────────────────────────────────────────────

import type { AnyRecord } from "../../../mesh-type-utils";

export declare const MESH_EXPRESSION_BRAND: unique symbol;

// ─── Core expression interface ────────────────────────────────────────────────

export interface MeshWhereExpression<TRecord extends AnyRecord = AnyRecord> {
  readonly [MESH_EXPRESSION_BRAND]: true;
  readonly test: (record: TRecord) => boolean;
}

// ─── Guard ────────────────────────────────────────────────────────────────────

export function isMeshWhereExpression(value: unknown): value is MeshWhereExpression {
  return (
    typeof value === "object" &&
    value !== null &&
    MESH_EXPRESSION_BRAND in value
  );
}

// ─── Internal factory ─────────────────────────────────────────────────────────

function makeExpr<TRecord extends AnyRecord>(
  test: (record: TRecord) => boolean,
): MeshWhereExpression<TRecord> {
  return { [MESH_EXPRESSION_BRAND]: true, test };
}

// ─── Field path resolver ──────────────────────────────────────────────────────

function resolvePath(record: AnyRecord, dotPath: string): unknown {
  const segments = dotPath.split(".");
  let current: unknown = record;
  for (const seg of segments) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as AnyRecord)[seg];
  }
  return current;
}

// ─── Operators ────────────────────────────────────────────────────────────────

export function eq<TRecord extends AnyRecord, TValue>(
  field: keyof TRecord & string,
  value: TValue,
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => (r[field] as unknown) === value);
}

export function neq<TRecord extends AnyRecord, TValue>(
  field: keyof TRecord & string,
  value: TValue,
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => (r[field] as unknown) !== value);
}

export function gt<TRecord extends AnyRecord>(
  field: keyof TRecord & string,
  value: number,
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => typeof r[field] === "number" && (r[field] as number) > value);
}

export function gte<TRecord extends AnyRecord>(
  field: keyof TRecord & string,
  value: number,
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => typeof r[field] === "number" && (r[field] as number) >= value);
}

export function lt<TRecord extends AnyRecord>(
  field: keyof TRecord & string,
  value: number,
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => typeof r[field] === "number" && (r[field] as number) < value);
}

export function lte<TRecord extends AnyRecord>(
  field: keyof TRecord & string,
  value: number,
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => typeof r[field] === "number" && (r[field] as number) <= value);
}

export function inArray<TRecord extends AnyRecord, TValue>(
  field: keyof TRecord & string,
  values: readonly TValue[],
): MeshWhereExpression<TRecord> {
  const set = new Set(values as unknown[]);
  return makeExpr((r) => set.has(r[field]));
}

export function notInArray<TRecord extends AnyRecord, TValue>(
  field: keyof TRecord & string,
  values: readonly TValue[],
): MeshWhereExpression<TRecord> {
  const set = new Set(values as unknown[]);
  return makeExpr((r) => !set.has(r[field]));
}

export function contains<TRecord extends AnyRecord>(
  field: keyof TRecord & string,
  value: string,
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => typeof r[field] === "string" && (r[field] as string).includes(value));
}

export function startsWith<TRecord extends AnyRecord>(
  field: keyof TRecord & string,
  value: string,
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => typeof r[field] === "string" && (r[field] as string).startsWith(value));
}

export function endsWith<TRecord extends AnyRecord>(
  field: keyof TRecord & string,
  value: string,
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => typeof r[field] === "string" && (r[field] as string).endsWith(value));
}

export function isNull<TRecord extends AnyRecord>(
  field: keyof TRecord & string,
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => r[field] == null);
}

export function isNotNull<TRecord extends AnyRecord>(
  field: keyof TRecord & string,
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => r[field] != null);
}

export function pathEq<TRecord extends AnyRecord>(
  dotPath: string,
  value: unknown,
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => resolvePath(r, dotPath) === value);
}

export function pathIn<TRecord extends AnyRecord>(
  dotPath: string,
  values: readonly unknown[],
): MeshWhereExpression<TRecord> {
  const set = new Set(values);
  return makeExpr((r) => set.has(resolvePath(r, dotPath)));
}

// ─── Logical combinators ──────────────────────────────────────────────────────

export function and<TRecord extends AnyRecord>(
  ...expressions: readonly MeshWhereExpression<TRecord>[]
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => expressions.every((e) => e.test(r)));
}

export function or<TRecord extends AnyRecord>(
  ...expressions: readonly MeshWhereExpression<TRecord>[]
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => expressions.some((e) => e.test(r)));
}

export function not<TRecord extends AnyRecord>(
  expression: MeshWhereExpression<TRecord>,
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => !expression.test(r));
}

// ─── Object-style where clause applier ───────────────────────────────────────

/**
 * Converts a plain object where clause into a predicate.
 * Supports nested objects via deep equality.
 */
export function applyObjectWhere<TItem>(
  item: TItem,
  clause: Partial<TItem>,
): boolean {
  for (const [key, value] of Object.entries(clause as AnyRecord)) {
    const itemValue = (item as AnyRecord)[key];
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      if (!applyObjectWhere(itemValue as AnyRecord, value as AnyRecord)) return false;
    } else {
      if (itemValue !== value) return false;
    }
  }
  return true;
}