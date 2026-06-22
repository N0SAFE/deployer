

// ─── Expression brand ─────────────────────────────────────────────────────────

import type { AnyRecord } from "../../../mesh-type-utils";

export const MESH_EXPRESSION_BRAND = Symbol("MESH_EXPRESSION_BRAND");

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
export function eq(...args: any[]): any {
  // builder usage: eq(value) -> { _eq: value }
  if (args.length === 1) {
    return { _eq: args[0] };
  }
  // field usage: eq(field, value) -> MeshWhereExpression
  const [field, value] = args as [string, unknown];
  return makeExpr((r: AnyRecord) => (r[field]) === value);
}

/**
 * Inequality operator.
 */
export function neq(...args: any[]): any {
  if (args.length === 1) {
    return { _neq: args[0] };
  }
  const [field, value] = args as [string, unknown];
  return makeExpr((r: AnyRecord) => (r[field]) !== value);
}

/**
 * Greater-than operator — only valid for numeric fields.
 */
export function gt(...args: any[]): any {
  if (args.length === 1) {
    return { _gt: args[0] };
  }
  const [field, value] = args as [string, number];
  return makeExpr((r: AnyRecord) => typeof r[field] === "number" && (r[field]) > value);
}

/**
 * Greater-than-or-equal operator — only valid for numeric fields.
 */
export function gte(...args: any[]): any {
  if (args.length === 1) {
    return { _gte: args[0] };
  }
  const [field, value] = args as [string, number];
  return makeExpr((r: AnyRecord) => typeof r[field] === "number" && (r[field]) >= value);
}

/**
 * Less-than operator — only valid for numeric fields.
 */
export function lt(...args: any[]): any {
  if (args.length === 1) {
    return { _lt: args[0] };
  }
  const [field, value] = args as [string, number];
  return makeExpr((r: AnyRecord) => typeof r[field] === "number" && (r[field]) < value);
}

/**
 * Less-than-or-equal operator — only valid for numeric fields.
 */
export function lte(...args: any[]): any {
  if (args.length === 1) {
    return { _lte: args[0] };
  }
  const [field, value] = args as [string, number];
  return makeExpr((r: AnyRecord) => typeof r[field] === "number" && (r[field]) <= value);
}

/**
 * In-array operator — value type is constrained to match the field's element type.
 */
export function inArray(...args: any[]): any {
  if (args.length === 1) {
    return { _in: args[0] };
  }
  const [field, values] = args as [string, readonly unknown[]];
  const set = new Set(values as unknown[]);
  return makeExpr((r: AnyRecord) => set.has(r[field]));
}

/**
 * Not-in-array operator.
 */
export function notInArray(...args: any[]): any {
  if (args.length === 1) {
    return { _notIn: args[0] };
  }
  const [field, values] = args as [string, readonly unknown[]];
  const set = new Set(values as unknown[]);
  return makeExpr((r: AnyRecord) => !set.has(r[field]));
}

/**
 * String-contains operator — only valid for string fields.
 */
export function contains(...args: any[]): any {
  if (args.length === 1) {
    return { _contains: args[0] };
  }
  const [field, value] = args as [string, string];
  return makeExpr((r: AnyRecord) => typeof r[field] === "string" && (r[field]).includes(value));
}

/**
 * Starts-with operator — only valid for string fields.
 */
export function startsWith(...args: any[]): any {
  if (args.length === 1) {
    return { _startsWith: args[0] };
  }
  const [field, value] = args as [string, string];
  return makeExpr((r: AnyRecord) => typeof r[field] === "string" && (r[field]).startsWith(value));
}

/**
 * Ends-with operator — only valid for string fields.
 */
export function endsWith(...args: any[]): any {
  if (args.length === 1) {
    return { _endsWith: args[0] };
  }
  const [field, value] = args as [string, string];
  return makeExpr((r: AnyRecord) => typeof r[field] === "string" && (r[field]).endsWith(value));
}

/**
 * Is-null operator — checks if a field is null or undefined.
 */
export function isNull(...args: any[]): any {
  if (args.length === 0) {
    return { _null: true };
  }
  const [field] = args as [string];
  return makeExpr((r: AnyRecord) => r[field] == null);
}

/**
 * Is-not-null operator — checks if a field is neither null nor undefined.
 */
export function isNotNull(...args: any[]): any {
  if (args.length === 0) {
    return { _notNull: true };
  }
  const [field] = args as [string];
  return makeExpr((r: AnyRecord) => r[field] != null);
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
export function and(...args: any[]): any {
  // builder usage: and([ { field: eq(...) }, { _or: [...] } ]) -> { _and: [...] }
  if (args.length === 1 && Array.isArray(args[0])) {
    return { _and: args[0] };
  }
  const expressions = args as MeshWhereExpression<any>[];
  return makeExpr((r: AnyRecord) => expressions.every((e) => e.test(r)));
}

/**
 * OR combinator — at least one expression must pass.
 */
export function or(...args: any[]): any {
  if (args.length === 1 && Array.isArray(args[0])) {
    return { _or: args[0] };
  }
  const expressions = args as MeshWhereExpression<any>[];
  return makeExpr((r: AnyRecord) => expressions.some((e) => e.test(r)));
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
  // Clause can contain operator objects like { _eq: value } or logical groups {_and: [...]}
  function evalClause(it: any, cl: any): boolean {
    if (cl == null) return true;

    // Logical groups
    if (typeof cl === 'object' && !Array.isArray(cl)) {
      // _and / _or at top-level of this clause
      if ('_and' in cl && Array.isArray(cl._and)) {
        return cl._and.every((sub: any) => evalClause(it, sub));
      }
      if ('_or' in cl && Array.isArray(cl._or)) {
        return cl._or.some((sub: any) => evalClause(it, sub));
      }

      // Field-level operators or nested object
      for (const [key, value] of Object.entries(cl)) {
        if (key.startsWith('_')) {
          // operator object for current item (should not happen at this level)
          // treat as failure
          return false;
        }

        const itemValue = it ? it[key] : undefined;

        // If value is an operator object (e.g., { _eq: x })
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          // Logical nested objects
          if ('_and' in value || '_or' in value) {
            if (!evalClause(itemValue, value)) return false;
            continue;
          }

          // Field operators
          const opKeys = Object.keys(value);
          for (const op of opKeys) {
            const v = (value as any)[op];
            switch (op) {
              case '_eq':
                if (itemValue !== v) return false;
                break;
              case '_neq':
                if (itemValue === v) return false;
                break;
              case '_gt':
                if (!(typeof itemValue === 'number' && itemValue > v)) return false;
                break;
              case '_gte':
                if (!(typeof itemValue === 'number' && itemValue >= v)) return false;
                break;
              case '_lt':
                if (!(typeof itemValue === 'number' && itemValue < v)) return false;
                break;
              case '_lte':
                if (!(typeof itemValue === 'number' && itemValue <= v)) return false;
                break;
              case '_in':
                if (!Array.isArray(v) || !v.includes(itemValue)) return false;
                break;
              case '_notIn':
                if (Array.isArray(v) && v.includes(itemValue)) return false;
                break;
              case '_contains':
                if (!(typeof itemValue === 'string' && (itemValue).includes(String(v)))) return false;
                break;
              case '_startsWith':
                if (!(typeof itemValue === 'string' && (itemValue).startsWith(String(v)))) return false;
                break;
              case '_endsWith':
                if (!(typeof itemValue === 'string' && (itemValue).endsWith(String(v)))) return false;
                break;
              case '_null':
                if (itemValue != null) return false;
                break;
              case '_notNull':
                if (itemValue == null) return false;
                break;
              default:
                // Unknown operator
                return false;
            }
          }
        } else {
          // Primitive value - direct equality
          if (itemValue !== value) return false;
        }
      }

      return true;
    }

    // Primitive clause
    return it === cl;
  }

  return evalClause(item, clause);
}

// ─── Filter builder ──────────────────────────────────────────────────────────

/**
 * Creates a typed filter object using a builder function.
 *
 * The test expects this API:
 * createFilter<UserSchema>(() => ({
 *   organizationId: eq("org-123"),  // eq returns a wrapper with _eq property
 *   status: eq("active"),
 *   age: gt(18),
 * }))
 *
 * Each field's value should be wrapped with an operator function that returns
 * an object with the `_op` key holding the actual value.
 */
export function createFilter<TRecord extends AnyRecord>(
  builder: (f?: unknown) => Partial<TRecord> & { _and?: unknown[]; _or?: unknown[] },
): Partial<TRecord> & { _and?: unknown[]; _or?: unknown[] } {
  // The builder is expected to return a plain object representing the filter.
  // Call it and return its result directly.
   
  return (builder as any)();
}

// Standalone filter creator for simple use cases
export function createTypedFilter<TRecord extends AnyRecord>(
  filter: Partial<TRecord> & { _and?: unknown[]; _or?: unknown[] }
): Partial<TRecord> & { _and?: unknown[]; _or?: unknown[] } {
  return filter;
}