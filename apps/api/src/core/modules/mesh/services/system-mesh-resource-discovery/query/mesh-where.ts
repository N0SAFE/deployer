

// ─── Expression brand ─────────────────────────────────────────────────────────

import type { AnyRecord } from "../../../mesh-type-utils";

export declare const MESH_EXPRESSION_BRAND: unique symbol;

// ─── Core expression interface ────────────────────────────────────────────────

/**
 * A composable where expression — the functional form of `.where()`.
 *
 * @param TRecord - The record type this expression tests against.
 *                  Defaults to AnyRecord for unconstrained usage.
 */
export interface MeshWhereExpression<TRecord extends AnyRecord = AnyRecord> {
  readonly [MESH_EXPRESSION_BRAND]: true;
  readonly test: (record: TRecord) => boolean;
}

// ─── Guard ────────────────────────────────────────────────────────────────────

export function isMeshWhereExpression(value: unknown): value is MeshWhereExpression<AnyRecord> {
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

// ─── Type-safe field value extractor ──────────────────────────────────────────

/**
 * Extracts the value type of a specific key from a record.
 * Used to constrain operator value types to match the field's actual type.
 */
type FieldValue<TRecord extends AnyRecord, K extends keyof TRecord & string> = TRecord[K];

// ─── Operators ────────────────────────────────────────────────────────────────

/**
 * Equality operator — value type is constrained to match the field's type.
 */
export function eq<TRecord extends AnyRecord, K extends keyof TRecord & string>(
  field: K,
  value: FieldValue<TRecord, K>,
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => (r[field] as unknown) === value);
}

/**
 * Inequality operator.
 */
export function neq<TRecord extends AnyRecord, K extends keyof TRecord & string>(
  field: K,
  value: FieldValue<TRecord, K>,
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => (r[field] as unknown) !== value);
}

/**
 * Greater-than operator — only valid for numeric fields.
 */
export function gt<TRecord extends AnyRecord, K extends keyof TRecord & string>(
  field: TRecord[K] extends number ? K : never,
  value: number,
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => typeof r[field] === "number" && (r[field] as number) > value);
}

/**
 * Greater-than-or-equal operator — only valid for numeric fields.
 */
export function gte<TRecord extends AnyRecord, K extends keyof TRecord & string>(
  field: TRecord[K] extends number ? K : never,
  value: number,
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => typeof r[field] === "number" && (r[field] as number) >= value);
}

/**
 * Less-than operator — only valid for numeric fields.
 */
export function lt<TRecord extends AnyRecord, K extends keyof TRecord & string>(
  field: TRecord[K] extends number ? K : never,
  value: number,
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => typeof r[field] === "number" && (r[field] as number) < value);
}

/**
 * Less-than-or-equal operator — only valid for numeric fields.
 */
export function lte<TRecord extends AnyRecord, K extends keyof TRecord & string>(
  field: TRecord[K] extends number ? K : never,
  value: number,
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => typeof r[field] === "number" && (r[field] as number) <= value);
}

/**
 * In-array operator — value type is constrained to match the field's element type.
 */
export function inArray<TRecord extends AnyRecord, K extends keyof TRecord & string>(
  field: K,
  values: readonly FieldValue<TRecord, K>[],
): MeshWhereExpression<TRecord> {
  const set = new Set(values as unknown[]);
  return makeExpr((r) => set.has(r[field]));
}

/**
 * Not-in-array operator.
 */
export function notInArray<TRecord extends AnyRecord, K extends keyof TRecord & string>(
  field: K,
  values: readonly FieldValue<TRecord, K>[],
): MeshWhereExpression<TRecord> {
  const set = new Set(values as unknown[]);
  return makeExpr((r) => !set.has(r[field]));
}

/**
 * String-contains operator — only valid for string fields.
 */
export function contains<TRecord extends AnyRecord, K extends keyof TRecord & string>(
  field: TRecord[K] extends string ? K : never,
  value: string,
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => typeof r[field] === "string" && (r[field] as string).includes(value));
}

/**
 * Starts-with operator — only valid for string fields.
 */
export function startsWith<TRecord extends AnyRecord, K extends keyof TRecord & string>(
  field: TRecord[K] extends string ? K : never,
  value: string,
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => typeof r[field] === "string" && (r[field] as string).startsWith(value));
}

/**
 * Ends-with operator — only valid for string fields.
 */
export function endsWith<TRecord extends AnyRecord, K extends keyof TRecord & string>(
  field: TRecord[K] extends string ? K : never,
  value: string,
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => typeof r[field] === "string" && (r[field] as string).endsWith(value));
}

/**
 * Is-null operator — checks if a field is null or undefined.
 */
export function isNull<TRecord extends AnyRecord, K extends keyof TRecord & string>(
  field: K,
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => r[field] == null);
}

/**
 * Is-not-null operator — checks if a field is neither null nor undefined.
 */
export function isNotNull<TRecord extends AnyRecord, K extends keyof TRecord & string>(
  field: K,
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => r[field] != null);
}

/**
 * Deep path equality — navigates a dot-separated path and compares.
 * Less type-safe than field-key operators; prefer those when possible.
 */
export function pathEq<TRecord extends AnyRecord>(
  dotPath: string,
  value: unknown,
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => resolvePath(r, dotPath) === value);
}

/**
 * Deep path in-array — navigates a dot-separated path and checks membership.
 */
export function pathIn<TRecord extends AnyRecord>(
  dotPath: string,
  values: readonly unknown[],
): MeshWhereExpression<TRecord> {
  const set = new Set(values);
  return makeExpr((r) => set.has(resolvePath(r, dotPath)));
}

// ─── Logical combinators ──────────────────────────────────────────────────────

/**
 * AND combinator — all expressions must pass.
 */
export function and<TRecord extends AnyRecord>(
  ...expressions: readonly MeshWhereExpression<TRecord>[]
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => expressions.every((e) => e.test(r)));
}

/**
 * OR combinator — at least one expression must pass.
 */
export function or<TRecord extends AnyRecord>(
  ...expressions: readonly MeshWhereExpression<TRecord>[]
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => expressions.some((e) => e.test(r)));
}

/**
 * NOT combinator — negates a single expression.
 */
export function not<TRecord extends AnyRecord>(
  expression: MeshWhereExpression<TRecord>,
): MeshWhereExpression<TRecord> {
  return makeExpr((r) => !expression.test(r));
}

// ─── Object-style where clause applier ───────────────────────────────────────

/**
 * Applies a plain-object where clause against an item.
 * Supports nested objects via deep equality.
 *
 * This is the runtime engine for `.where({ field: value })` calls.
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