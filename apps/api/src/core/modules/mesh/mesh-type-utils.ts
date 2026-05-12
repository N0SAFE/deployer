import type { z } from "zod";
import type { MeshEntity } from "./mesh-entity";
import type { MeshQueryBuilder } from "./query/mesh-query-builder";
import type { MeshAggregator } from "./query/mesh-aggregate";

// ─── Entity helpers ───────────────────────────────────────────────────────────

/** Extract the inferred item type from a MeshEntity */
export type EntityItem<TEntity> =
  TEntity extends MeshEntity<any, infer TSchema, any, any, any>
    ? z.infer<TSchema>
    : never;

/** Extract the itemKey field name from a MeshEntity */
export type EntityItemKey<TEntity> =
  TEntity extends MeshEntity<any, any, infer TKey, any, any>
    ? TKey
    : never;

/** Extract query method names from a MeshEntity */
export type EntityQueryNames<TEntity> =
  TEntity extends MeshEntity<any, any, any, infer TQueries, any>
    ? keyof TQueries
    : never;

/** Extract mutation method names from a MeshEntity */
export type EntityMutationNames<TEntity> =
  TEntity extends MeshEntity<any, any, any, any, infer TMutations>
    ? keyof TMutations
    : never;

// ─── Builder helpers ──────────────────────────────────────────────────────────

/** Extract the result shape from a MeshQueryBuilder */
export type BuilderResult<TBuilder> =
  TBuilder extends MeshQueryBuilder<any, infer TResult>
    ? TResult
    : never;

/** Extract the raw item type from a MeshQueryBuilder */
export type BuilderItem<TBuilder> =
  TBuilder extends MeshQueryBuilder<infer TItem, any>
    ? TItem
    : never;

// ─── Join helpers ─────────────────────────────────────────────────────────────

/**
 * Produces the result shape of a join.
 * Left join: TJoined | null
 * Inner join: TJoined (never null)
 */
export type WithJoin<
  TBase,
  TAlias extends string,
  TJoined,
  TType extends "left" | "inner" = "left",
> = TBase & Record<TAlias, TType extends "inner" ? TJoined : TJoined | null>;

// ─── Where helpers ────────────────────────────────────────────────────────────

/** Deep partial for object-style where clauses */
export type MeshWhereInput<T> = {
  [K in keyof T]?: T[K] extends object
    ? MeshWhereInput<T[K]>
    : T[K] | undefined;
};

// ─── Aggregate helpers ────────────────────────────────────────────────────────

/** Infer the aggregate result type from an aggregator spec */
export type AggregateResult<TSpec extends Record<string, MeshAggregator<any>>> = {
  [K in keyof TSpec]: TSpec[K] extends MeshAggregator<infer R> ? R : never;
};

// ─── Schema helpers ───────────────────────────────────────────────────────────

/** Infer the output type of a Zod schema as a plain record */
export type SchemaOutput<TSchema extends z.ZodType> = z.infer<TSchema>;

// ─── Utility ──────────────────────────────────────────────────────────────────

export type AnyRecord = Record<string, unknown>;

export type Prettify<T> = { [K in keyof T]: T[K] } & {};

export type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};

export type NonNullableFields<T> = {
  [K in keyof T]-?: NonNullable<T[K]>;
};

/** Make specific keys required */
export type RequireKeys<T, K extends keyof T> = T & Required<Pick<T, K>>;

/** Unwrap a Promise */
export type Awaited<T> = T extends Promise<infer U> ? U : T;