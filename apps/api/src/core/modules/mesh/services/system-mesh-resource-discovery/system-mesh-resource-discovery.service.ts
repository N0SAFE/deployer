import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { MeshQueryBuilder } from "./query/mesh-query-builder";
import { MeshQueryExecutor } from './query/mesh-query-executor';
import { buildQueryPlan, formatQueryPlan, type MeshQueryPlan } from "./query/mesh-query-plan";
import type { AnyMeshQuery } from "../../mesh-query";
import type { AnyMeshEntity, MeshEntityItem } from "../../mesh-entity";
import type { MeshQueryResult } from "./query/mesh-query-builder-types";

// ─── Method reference types ───────────────────────────────────────────────────

/**
 * A query method reference — the object you pass to `.from()`.
 * Carries item schema, entity key, method name, and item key.
 */
export type MeshQueryMethodRef<TItem> = AnyMeshQuery & {
  readonly itemSchema: z.ZodType<TItem>;
  readonly entityKey: string;
  readonly methodName: string;
  readonly itemKey: string;
};

/**
 * Extracts the item type from a MeshQueryMethodRef.
 */
export type MethodRefItem<TRef> =
  TRef extends MeshQueryMethodRef<infer TItem> ? TItem : never;

// ─── Entity query ref extractor ───────────────────────────────────────────────

/**
 * Extracts the query method refs from an entity's queries map.
 * Used to type `Service.entities.foo.queries.list` correctly.
 */
export type EntityQueryRefs<TEntity extends AnyMeshEntity> = {
  [K in keyof TEntity["queries"]]: MeshQueryMethodRef<MeshEntityItem<TEntity>>;
};

// ─── Discovery service ────────────────────────────────────────────────────────

@Injectable()
export class SystemMeshResourceDiscoveryService {
  constructor(
    private readonly executor: MeshQueryExecutor,
  ) {}

  /**
   * Creates a typed query builder from a strongly typed query method reference.
   *
   * @example
   * discovery.from(DeploymentMeshService.entities.deployments.queries.list)
   */
  from<TItem>(
    queryRef: MeshQueryMethodRef<TItem>,
  ): MeshQueryBuilder<TItem, TItem> {
    return MeshQueryBuilder.create<TItem>(this.executor, queryRef);
  }

  /**
   * Executes a query directly from a method ref with optional where clauses.
   * Convenience shorthand for `.from().where().execute()`.
   */
  async query<TItem>(
    queryRef: MeshQueryMethodRef<TItem>,
    where?: Partial<TItem>,
  ): Promise<MeshQueryResult<TItem>> {
    const builder = this.from(queryRef);
    return where ? builder.where(where).execute() : builder.execute();
  }

  /**
   * Returns the query plan for a builder without executing it.
   * Useful for debugging and introspection.
   */
  explain<TItem, TResultShape>(
    builder: MeshQueryBuilder<TItem, TResultShape>,
  ): MeshQueryPlan {
    return buildQueryPlan(builder);
  }

  /**
   * Returns a formatted string representation of the query plan.
   */
  explainFormatted<TItem, TResultShape>(
    builder: MeshQueryBuilder<TItem, TResultShape>,
  ): string {
    return formatQueryPlan(buildQueryPlan(builder));
  }
}