/**
 * MeshResourceService — Abstract Base Class for Mesh Entities
 *
 * Every mesh entity service extends this class. It automatically:
 * 1. Registers ALL query handlers with MeshResourceDispatcher during onModuleInit()
 * 2. Registers ALL mutation handlers with MeshResourceDispatcher during onModuleInit()
 * 3. Cleans up handlers during onModuleDestroy()
 * 4. Provides the typed from() / call() / live() API for programmatic access
 *
 * The developer NEVER touches ORPC contracts, ORPC clients, or @Implement.
 * Everything is handled here and routed through MeshResourceDispatcher.
 *
 * @example
 * ```typescript
 * class DeploymentsService extends MeshResourceService<typeof deploymentEntity> {
 *   constructor(
 *     executor: MeshQueryExecutor,
 *     dispatcher: MeshResourceDispatcher,
 *   ) {
 *     super(executor, dispatcher, deploymentEntity);
 *     // onModuleInit() auto-registers all queries + mutations
 *   }
 * }
 *
 * // Usage:
 * const result = await deploymentsService
 *   .from("list")
 *   .where({ environment: "prod" })
 *   .limit(20)
 *   .request();
 *
 * const created = await deploymentsService.create({ ... });
 * ```
 */

import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";
import type {
  AnyMeshEntity,
  MeshEntityItem,
} from "../mesh-entity";
import type { MeshQuery, MeshQueryOutput, MeshQueryInput } from "../mesh-query";
import type { MeshMutationInput, MeshMutationOutput } from "../mesh-mutation";
import { MeshQueryExecutor } from "../services/system-mesh-resource-discovery/query/mesh-query-executor";
import { MeshQueryBuilder } from "../services/system-mesh-resource-discovery/query/mesh-query-builder";
import type { MeshQueryRef } from "../services/system-mesh-resource-discovery/query/mesh-query-builder-types";
import { MeshResourceDispatcher } from "../dispatcher/mesh-resource-dispatcher.service";

import { NotFoundError } from "@repo/errors";
@Injectable()
export abstract class MeshResourceService<
  TEntity extends AnyMeshEntity = AnyMeshEntity,
> implements OnModuleInit, OnModuleDestroy {
  readonly entityKey: string;
  readonly itemKey: string;
  protected readonly logger: Logger;

  constructor(
    protected readonly executor: MeshQueryExecutor,
    protected readonly dispatcher: MeshResourceDispatcher,
    readonly entity: TEntity,
  ) {
    this.entityKey = entity.key;
    this.itemKey = entity.itemKey as string;
    this.logger = new Logger(`MeshResource:${entity.key}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ══════════════════════════════════════════════════════════════════════════

  /** @inheritdoc */
  onModuleInit(): void {
    let queryCount = 0;
    let mutationCount = 0;

    // Register all query handlers
    for (const [methodName] of Object.entries(this.entity.queries)) {
      this.dispatcher.register(
        this.entityKey,
        methodName,
        async (input) => {
          // Default: execute via MeshQueryExecutor
          const builder = MeshQueryBuilder.create(
            this.executor,
            this.buildQueryRef(methodName),
          );
          const result = await builder
            .scope({})
            .request();
          return result;
        },
      );
      queryCount++;
    }

    // Register all mutation handlers
    for (const [methodName] of Object.entries(this.entity.mutations)) {
      this.dispatcher.register(
        this.entityKey,
        methodName,
        async (input) => {
          // Execute mutation through the executor's executeWithInput
          const queryRef = this.buildQueryRef(methodName);
          return this.executor.executeWithInput(queryRef, input);
        },
      );
      mutationCount++;
    }

    this.logger.log(
      `Registered ${queryCount} query + ${mutationCount} mutation handler(s) with dispatcher`,
    );
  }

  /** @inheritdoc */
  onModuleDestroy(): void {
    this.dispatcher.unregisterAll(this.entityKey);
    this.logger.log(`Unregistered all handlers for entity: ${this.entityKey}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // QUERY API
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Creates a typed query builder bound to the specified query method.
   *
   * @param methodName - The query method name (must be a key of TEntity["queries"])
   * @returns A typed MeshQueryBuilder with correct item + result shape types
   *
   * @example
   * ```typescript
   * const result = await service
   *   .from("list")
   *   .where({ environment: "prod" })
   *   .limit(20)
   *   .request();
   * ```
   */
  from<TMethodName extends keyof TEntity["queries"] & string>(
    methodName: TMethodName,
  ): MeshQueryBuilder<
    MeshQueryOutput<TEntity["queries"][TMethodName]>,
    MeshQueryOutput<TEntity["queries"][TMethodName]>
  > {
    const query = this.entity.queries[methodName]! satisfies MeshQuery<any, any>;
    const queryRef = this.buildQueryRef(methodName);
    return MeshQueryBuilder.create(this.executor, queryRef);
  }

  /**
   * Convenience: list all items with optional filter.
   * NOTE: Assumes the "list" query output schema matches the entity item schema.
   * Cast is safe since this is a structural convenience method.
   */
  async list(): Promise<readonly MeshEntityItem<TEntity>[]> {
    const result = await this.from("list").request();
    return result.items as readonly MeshEntityItem<TEntity>[];
  }

  /**
   * Convenience: get a single item by its key field.
   */
  async getById(id: string): Promise<MeshEntityItem<TEntity> | null> {
    const result = await this.from("getById")
      .where({ [this.itemKey]: id } as any)
      .request();
    return (result.items[0] ?? null) as MeshEntityItem<TEntity> | null;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MUTATION API
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Execute a named mutation with the given input.
   * Delegates to the dispatcher which routes to the registered handler.
   */
  async call<TMethodName extends keyof TEntity["mutations"] & string>(
    methodName: TMethodName,
    input: MeshMutationInput<TEntity["mutations"][TMethodName]>,
  ): Promise<MeshMutationOutput<TEntity["mutations"][TMethodName]>> {
    return this.dispatcher.dispatch(
      this.entityKey,
      methodName as string,
      input,
    ) as Promise<MeshMutationOutput<TEntity["mutations"][TMethodName]>>;
  }

  /**
   * Convenience: create an item.
   * NOTE: Assumes the "create" mutation input accepts { data: TItem }.
   * Cast is safe since this follows the standard entity mutation pattern.
   */
  async create(data: MeshEntityItem<TEntity>): Promise<MeshEntityItem<TEntity>> {
    return this.call("create", { data } as any) as Promise<MeshEntityItem<TEntity>>;
  }

  /**
   * Convenience: update an item.
   * NOTE: Assumes the "update" mutation accepts { [itemKey]: string, data: Partial<TItem> }.
   */
  async update(
    id: string,
    data: Partial<MeshEntityItem<TEntity>>,
  ): Promise<MeshEntityItem<TEntity>> {
    return this.call("update", { [this.itemKey]: id, data } as any) as Promise<MeshEntityItem<TEntity>>;
  }

  /**
   * Convenience: delete an item.
   * NOTE: Assumes the "delete" mutation returns { deleted: boolean }.
   */
  async delete(id: string): Promise<{ deleted: boolean }> {
    return this.call("delete", { [this.itemKey]: id } as any) as Promise<{ deleted: boolean }>;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STREAMING
  // ══════════════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════════════
  // INTERNAL HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  private buildQueryRef(methodName: string): MeshQueryRef<any> {
    // Try queries first, then mutations
    const queries = this.entity.queries as unknown as Record<string, MeshQuery<any, any>>;
    const mutations = this.entity.mutations as unknown as Record<string, MeshQuery<any, any>>;
    const operation = queries[methodName] ?? mutations[methodName];
    if (!operation) {
      throw new NotFoundError(`Operation '${methodName}' not found on entity '${this.entityKey}'`);
    }
    return {
      inputSchema: operation.inputSchema,
      outputSchema: operation.outputSchema,
      entityKey: this.entityKey,
      methodName,
    } as MeshQueryRef<any>;
  }
}
