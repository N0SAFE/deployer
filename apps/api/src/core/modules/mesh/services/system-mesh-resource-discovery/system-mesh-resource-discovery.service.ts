import type { z } from "zod/v4";
import { Injectable } from "@nestjs/common";
import { MeshQueryBuilder } from "./query/mesh-query-builder";
import { MeshQueryExecutor } from "./query/mesh-query-executor";
import { buildQueryPlan, formatQueryPlan, type MeshQueryPlan } from "./query/mesh-query-plan";
import type { MeshQueryResult } from "./query/mesh-query-builder-types";
import type { AnyMeshEntity, MeshEntityItem } from "../../mesh-entity";
import type { MeshQueryRef } from "./query/mesh-query-builder-types";

// ─── Entity query ref extractor ───────────────────────────────────────────────

/**
 * Extracts the query method refs from an entity's queries map.
 * Used to type `Service.entities.foo.queries.list` correctly.
 *
 * Each query method ref carries the entity's item type, so the builder
 * can infer TItem from the method reference passed to `.from()`.
 */
export type EntityQueryRefs<TEntity extends AnyMeshEntity> = {
  [K in keyof TEntity["queries"]]: MeshQueryRef<MeshEntityItem<TEntity>>;
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
    queryRef: MeshQueryRef<TItem>,
  ): MeshQueryBuilder<TItem, TItem> {
    return MeshQueryBuilder.create<TItem>(this.executor, queryRef);
  }

  /**
   * Executes a query directly from a method ref with optional where clauses.
   * Convenience shorthand for `.from().where().execute()`.
   *
   * For queries with custom input schemas (e.g., search), use queryWithInput().
   */
  async query<TItem>(
    queryRef: MeshQueryRef<TItem>,
    where?: Partial<TItem>,
  ): Promise<MeshQueryResult<TItem>> {
    const builder = this.from(queryRef);
    return where ? builder.where(where).execute() : builder.execute();
  }

  /**
   * Executes a query with a custom input schema (e.g., search queries).
   * This bypasses the builder's where() filtering and passes the input
   * directly to the query handler.
   *
   * @example
   * await discovery.queryWithInput(
   *   service.queries.search,
   *   { query: "my-search", filters: { environment: "prod" } }
   * )
   */
  async queryWithInput<TItem, TInput extends z.ZodType, TOutput extends z.ZodType>(
    queryRef: MeshQueryRef<TItem, TInput, TOutput>,
    input: z.infer<TInput>,
  ): Promise<MeshQueryResult<TItem>> {
    // For queries with custom inputs, we execute directly through the executor
    // bypassing the builder's where-clause system
    return this.executor.executeWithInput<TItem, TInput, TOutput>(queryRef, input);
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