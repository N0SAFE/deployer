import type { z, ZodType } from "zod";

export interface MeshOperation<
  TRequestSchema extends ZodType = ZodType,
  TResponseSchema extends ZodType = ZodType,
> {
  readonly requestSchema: TRequestSchema;
  readonly responseSchema: TResponseSchema;
}

export function meshOperation<
  TRequestSchema extends ZodType,
  TResponseSchema extends ZodType,
>(
  requestSchema: TRequestSchema,
  responseSchema: TResponseSchema,
): MeshOperation<TRequestSchema, TResponseSchema> {
  return {
    requestSchema,
    responseSchema,
  };
}

export interface MeshEntity<
  TKey extends string = string,
  TItemSchema extends ZodType = ZodType,
  TItemKey extends keyof z.infer<TItemSchema> = any,
  TOperations extends Record<string, MeshOperation> = Record<string, MeshOperation>,
> {
  readonly key: TKey;
  readonly item: TItemSchema;
  readonly itemKey: TItemKey;
  readonly operations: TOperations;
}

export function meshEntity<
  TKey extends string,
  TItemSchema extends ZodType,
  TItemKey extends keyof z.infer<TItemSchema>,
  TOperations extends Record<string, MeshOperation>,
>(config: {
  key: TKey;
  item: TItemSchema;
  itemKey: TItemKey;
  operations: TOperations;
}): MeshEntity<TKey, TItemSchema, TItemKey, TOperations> {
  return config;
}
