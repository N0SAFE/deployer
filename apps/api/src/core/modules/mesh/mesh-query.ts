import type { z, ZodType } from "zod";

export declare const MESH_QUERY_BRAND: unique symbol;

export interface MeshQuery<
  TInputSchema extends ZodType,
  TOutputSchema extends ZodType,
> {
  readonly [MESH_QUERY_BRAND]: true;
  readonly inputSchema: TInputSchema;
  readonly outputSchema: TOutputSchema;

  // Attached by meshEntity() for discovery
  entityKey?: string;
  methodName?: string;
  itemSchema?: ZodType;
  itemKey?: string;
}

export type AnyMeshQuery = MeshQuery<ZodType, ZodType>;

export type MeshQueryInput<TQuery extends AnyMeshQuery> =
  TQuery extends MeshQuery<infer TInput, any> ? z.infer<TInput> : never;

export type MeshQueryOutput<TQuery extends AnyMeshQuery> =
  TQuery extends MeshQuery<any, infer TOutput> ? z.infer<TOutput> : never;

export type MeshQueryItem<TQuery extends AnyMeshQuery> =
  TQuery extends MeshQuery<any, any> & { itemSchema: infer TSchema }
    ? TSchema extends ZodType
      ? z.infer<TSchema>
      : never
    : never;

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