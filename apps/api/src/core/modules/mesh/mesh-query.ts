import type { z, ZodType } from "zod";

// ─── Brand ────────────────────────────────────────────────────────────────────

export declare const MESH_QUERY_BRAND: unique symbol;

// ─── Core interface ───────────────────────────────────────────────────────────

/**
 * A mesh query operation definition — the raw primitive before entity binding.
 *
 * The `entityKey`, `methodName`, `itemSchema`, and `itemKey` fields are
 * set by `meshEntity()` at definition time. They are declared mutable here
 * because the factory `meshQuery()` does not know them yet.
 *
 * For the fully-typed version with all fields required, use `MeshQueryRef`
 * from `mesh-query-builder-types.ts`.
 */
export interface MeshQuery<
  TInputSchema extends ZodType,
  TOutputSchema extends ZodType,
> {
  readonly [MESH_QUERY_BRAND]: true;
  readonly inputSchema: TInputSchema;
  readonly outputSchema: TOutputSchema;

  // Attached by meshEntity() for discovery — present at runtime after entity creation.
  // Declared mutable so meshEntity() can write them; declared optional so meshQuery()
  // doesn't need to provide them. Use MeshQueryRef for the guaranteed-present version.
  entityKey?: string;
  methodName?: string;
  itemSchema?: ZodType;
  itemKey?: string;
}

// ─── Any-type alias ───────────────────────────────────────────────────────────

export type AnyMeshQuery = MeshQuery<ZodType, ZodType>;

// ─── Type extractors ──────────────────────────────────────────────────────────

/** Extract the input payload type from a MeshQuery */
export type MeshQueryInput<TQuery extends AnyMeshQuery> =
  TQuery extends MeshQuery<infer TInput, ZodType> ? z.infer<TInput> : never;

/** Extract the output payload type from a MeshQuery */
export type MeshQueryOutput<TQuery extends AnyMeshQuery> =
  TQuery extends MeshQuery<ZodType, infer TOutput> ? z.infer<TOutput> : never;

/** Extract the item type from a MeshQuery that has been bound to an entity */
export type MeshQueryItem<TQuery extends AnyMeshQuery> =
  TQuery extends MeshQuery<ZodType, ZodType> & { itemSchema: infer TSchema }
    ? TSchema extends ZodType
      ? z.infer<TSchema>
      : never
    : never;

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a mesh query operation.
 *
 * The returned object does NOT have `entityKey`, `methodName`, `itemSchema`,
 * or `itemKey` set — those are attached by `meshEntity()` when the query
 * is registered on an entity.
 */
export function meshQuery<
  TInputSchema extends ZodType,
  TOutputSchema extends ZodType,
>(
  inputSchema: TInputSchema,
  outputSchema: TOutputSchema,
): MeshQuery<TInputSchema, TOutputSchema> {
  return {
    [MESH_QUERY_BRAND]: true,
    inputSchema,
    outputSchema,
  };
}