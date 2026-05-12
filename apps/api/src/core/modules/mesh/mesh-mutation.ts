import type { z, ZodType } from "zod";

export declare const MESH_MUTATION_BRAND: unique symbol;

export interface MeshMutation<
  TInputSchema extends ZodType,
  TOutputSchema extends ZodType,
> {
  readonly [MESH_MUTATION_BRAND]: true;
  readonly inputSchema: TInputSchema;
  readonly outputSchema: TOutputSchema;

  // Attached by meshEntity() for discovery
  entityKey?: string;
  methodName?: string;
  itemSchema?: ZodType;
  itemKey?: string;
}

export type AnyMeshMutation = MeshMutation<ZodType, ZodType>;

export type MeshMutationInput<TMutation extends AnyMeshMutation> =
  TMutation extends MeshMutation<infer TInput, any> ? z.infer<TInput> : never;

export type MeshMutationOutput<TMutation extends AnyMeshMutation> =
  TMutation extends MeshMutation<any, infer TOutput> ? z.infer<TOutput> : never;

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