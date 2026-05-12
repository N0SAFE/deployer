import type { z, ZodType } from "zod";
import type { AnyMeshQuery } from "./mesh-query";
import type { AnyMeshMutation } from "./mesh-mutation";

// ─── Core interface ───────────────────────────────────────────────────────────

export interface MeshEntity<
  TKey extends string,
  TItemSchema extends ZodType,
  TItemKey extends keyof z.infer<TItemSchema> & string,
  TQueries extends Record<string, AnyMeshQuery>,
  TMutations extends Record<string, AnyMeshMutation>,
> {
  readonly key: TKey;
  readonly item: TItemSchema;
  readonly itemKey: TItemKey;
  readonly queries: TQueries;
  readonly mutations: TMutations;
}

export type AnyMeshEntity = MeshEntity<string, ZodType, string, any, any>;

// ─── Item type extraction ─────────────────────────────────────────────────────

export type MeshEntityItem<TEntity extends AnyMeshEntity> =
  TEntity extends MeshEntity<any, infer TSchema, any, any, any>
    ? z.infer<TSchema>
    : never;

export type MeshEntityItemKey<TEntity extends AnyMeshEntity> =
  TEntity extends MeshEntity<any, any, infer TKey, any, any>
    ? TKey
    : never;

// ─── Factory ──────────────────────────────────────────────────────────────────

export function meshEntity<
  TKey extends string,
  TItemSchema extends ZodType,
  TItemKey extends keyof z.infer<TItemSchema> & string,
  TQueries extends Record<string, AnyMeshQuery>,
  TMutations extends Record<string, AnyMeshMutation>,
>(config: {
  key: TKey;
  item: TItemSchema;
  itemKey: TItemKey;
  queries: TQueries;
  mutations: TMutations;
}): MeshEntity<TKey, TItemSchema, TItemKey, TQueries, TMutations> {
  const entity = { ...config } as MeshEntity<
    TKey,
    TItemSchema,
    TItemKey,
    TQueries,
    TMutations
  >;

  // Attach routing metadata to each query for topic derivation
  for (const [name, query] of Object.entries(entity.queries)) {
    query.entityKey = entity.key;
    query.methodName = name;
    query.itemSchema = entity.item;
    query.itemKey = entity.itemKey;
  }
  
  // Attach routing metadata to each mutation
  for (const [name, mutation] of Object.entries(entity.mutations)) {
    mutation.entityKey = entity.key;
    mutation.methodName = name;
    mutation.itemSchema = entity.item;
    mutation.itemKey = entity.itemKey;
  }

  return entity;
}