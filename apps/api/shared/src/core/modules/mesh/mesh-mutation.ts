import type { z, ZodType } from "zod";

// ─── Brand ────────────────────────────────────────────────────────────────────

export const MESH_MUTATION_BRAND: unique symbol = Symbol('MESH_MUTATION_BRAND');

// ─── Core interface ───────────────────────────────────────────────────────────

/**
 * A mesh mutation operation definition — the raw primitive before entity binding.
 *
 * The `entityKey`, `methodName`, `itemSchema`, and `itemKey` fields are
 * set by `meshEntity()` at definition time. They are declared mutable here
 * because the factory `meshMutation()` does not know them yet.
 */
export interface MeshMutation<
  TInputSchema extends ZodType,
  TOutputSchema extends ZodType,
> {
  readonly [MESH_MUTATION_BRAND]: true;
  readonly inputSchema: TInputSchema;
  readonly outputSchema: TOutputSchema;

  // Attached by meshEntity() for discovery — present at runtime after entity creation.
  // Declared mutable so meshEntity() can write them; declared optional so meshMutation()
  // doesn't need to provide them.
  entityKey?: string;
  methodName?: string;
  itemSchema?: ZodType;
  itemKey?: string;
}

// ─── Any-type alias ───────────────────────────────────────────────────────────

export type AnyMeshMutation = MeshMutation<ZodType, ZodType>;

// ─── Type extractors ──────────────────────────────────────────────────────────

/** Extract the input payload type from a MeshMutation */
export type MeshMutationInput<TMutation extends AnyMeshMutation> =
  TMutation extends MeshMutation<infer TInput, ZodType> ? z.infer<TInput> : never;

/** Extract the output payload type from a MeshMutation */
export type MeshMutationOutput<TMutation extends AnyMeshMutation> =
  TMutation extends MeshMutation<ZodType, infer TOutput> ? z.infer<TOutput> : never;

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a mesh mutation operation.
 *
 * The returned object does NOT have `entityKey`, `methodName`, `itemSchema`,
 * or `itemKey` set — those are attached by `meshEntity()` when the mutation
 * is registered on an entity.
 */
export function meshMutation<
  TInputSchema extends ZodType,
  TOutputSchema extends ZodType,
>(
  inputSchema: TInputSchema,
  outputSchema: TOutputSchema,
): MeshMutation<TInputSchema, TOutputSchema> {
  return {
    [MESH_MUTATION_BRAND]: true,
    inputSchema,
    outputSchema,
  };
}