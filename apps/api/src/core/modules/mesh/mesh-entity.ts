import type { ZodType } from "zod";
import type { MeshOperation } from "./mesh-operation";

export interface MeshEntity<
  TKey extends string,
  TItemSchema extends ZodType,
  TItemKey extends keyof z.infer<TItemSchema>,
  TOperations extends Record<string, MeshOperation<any, any>>,
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
  TOperations extends Record<string, MeshOperation<any, any>>,
>(config: {
  key: TKey;
  item: TItemSchema;
  itemKey: TItemKey;
  operations: TOperations;
}): MeshEntity<TKey, TItemSchema, TItemKey, TOperations> {
  return config;
}
