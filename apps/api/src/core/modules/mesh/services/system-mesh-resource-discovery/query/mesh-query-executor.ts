import type { z } from "zod/v4";
import { Injectable, Logger } from "@nestjs/common";
import type { MeshQueryBuilder } from "./mesh-query-builder";
import type {
  MeshQueryResult,
  MeshNodeResponse,
  MeshResolvedJoin,
  MeshQueryScopeOptions,
  MeshQueryStrategy,
} from "./mesh-query-builder-types";
import { applyOrdering, type MeshOrderClause } from "./mesh-order";
import { applyPagination, type MeshPaginationState } from "./mesh-pagination";
import type { AnyRecord } from "../../../mesh-type-utils";
import type { MeshQueryRef } from "./mesh-query-builder-types";
import type { MeshWatchHandle, MeshChangeEvent, MeshChangeType } from "./mesh-watch-types";

// ─── Node call abstraction ────────────────────────────────────────────────────

export interface MeshNodeCaller {
  callMany<TItem>(
    entityKey: string,
    methodName: string,
    payload: Record<string, unknown>,
    options: { organizationId?: string | null; timeoutMs?: number },
  ): Promise<readonly { nodeId: string; items: readonly TItem[]; durationMs: number }[]>;
}

// ─── Executor ─────────────────────────────────────────────────────────────────

@Injectable()
export class MeshQueryExecutor {
  private readonly logger = new Logger(MeshQueryExecutor.name);

  constructor(
    private readonly nodeCaller: MeshNodeCaller,
  ) {}

  // ─── execute() ─────────────────────────────────────────────────────────

  async execute<TItem, TResultShape>(
    builder: MeshQueryBuilder<TItem, TResultShape>,
  ): Promise<MeshQueryResult<TResultShape>> {
    const start = Date.now();
    const state = builder._state;
    const entityKey = builder._getEntityKey();
    const itemKey = builder._getItemKey();
    const strategy: MeshQueryStrategy = state.scopeOptions.strategy ?? "broadcast-merge";

    // 1. Collect raw items from all nodes
    const nodeResponses = await this.collectFromNodes<TItem>(
      entityKey,
      state.query.methodName ?? "list",
      {},
      {
        timeoutMs: state.scopeOptions.timeoutMs ?? 3_000,
      },
    );

    // 2. Deduplicate by itemKey (last-write-wins by response order)
    const deduped = this.deduplicate<TItem>(
      nodeResponses.flatMap((r) => r.items),
      itemKey as keyof TItem & string,
    );

    // 3. Apply where clauses
    const filtered = deduped.filter((item) => builder._applyWhereClauses(item));

    // 4. Apply ordering
    const ordered = applyOrdering(filtered, state.orderClauses);

    // 5. Execute joins and stitch result shapes
    const stitched = await this.executeJoins<TResultShape>(
      ordered as unknown as TResultShape[],
      state.joins,
    );

    // 6. Apply projections
    const projected = this.applyProjection<TResultShape>(
      stitched,
      state.selectedFields,
    );

    // 7. Apply pagination
    const { items, hasMore, nextOffset } = applyPagination(
      projected,
      state.pagination,
    );

    const durationMs = Date.now() - start;

    return {
      items,
      total: projected.length,
      strategy,
      hasMore,
      nextOffset,
      nodeResponses: nodeResponses.map((r) => ({
        nodeId: r.nodeId,
        items: r.items as unknown as readonly TResultShape[],
        respondedAt: new Date().toISOString(),
        durationMs: r.durationMs,
      })),
      durationMs,
    };
  }

  // ─── stream() ──────────────────────────────────────────────────────────

  async *stream<TItem, TResultShape>(
    builder: MeshQueryBuilder<TItem, TResultShape>,
  ): AsyncGenerator<TResultShape> {
    const result = await this.execute<TItem, TResultShape>(builder);
    for (const item of result.items) {
      yield item;
    }
  }

  // ─── executeWithInput() ────────────────────────────────────────────────

  /**
   * Execute a query with a custom input payload (bypasses builder where clauses).
   * Used for queries with non-standard input schemas like search.
   */
  async executeWithInput<TItem, TInput extends z.ZodType, TOutput extends z.ZodType>(
    queryRef: MeshQueryRef<TItem, TInput, TOutput>,
    input: z.infer<TInput>,
  ): Promise<MeshQueryResult<TItem>> {
    const start = Date.now();
    const entityKey = queryRef.entityKey;
    const methodName = queryRef.methodName;
    const strategy: MeshQueryStrategy = "broadcast-merge";

    // 1. Collect raw items from all nodes with the custom input
    const nodeResponses = await this.collectFromNodes<TItem>(
      entityKey,
      methodName,
      input as Record<string, unknown>,
      {
        timeoutMs: 3_000,
      },
    );

    // 2. Deduplicate by itemKey
    const deduped = this.deduplicate<TItem>(
      nodeResponses.flatMap((r) => r.items),
      queryRef.itemKey as keyof TItem & string,
    );

    const durationMs = Date.now() - start;

    return {
      items: deduped as unknown as readonly TItem[],
      total: deduped.length,
      strategy,
      hasMore: false,
      nextOffset: null,
      nodeResponses: nodeResponses.map((r) => ({
        nodeId: r.nodeId,
        items: r.items,
        respondedAt: new Date().toISOString(),
        durationMs: r.durationMs,
      })),
      durationMs,
    };
  }

  // ─── watch() ───────────────────────────────────────────────────────────

  /**
   * Watch for changes to items matching the builder's query.
   *
   * Unified API that works for both global and node-owned resources:
   * - Global resources use event subscriptions for real-time updates
   * - Node-owned resources use polling with incremental sync
   *
   * The caller doesn't need to know the difference - same API, same behavior.
   */
  watch<TItem, TResultShape>(
    builder: MeshQueryBuilder<TItem, TResultShape>,
    options: {
      onChange: (items: readonly TResultShape[], event: MeshChangeEvent<TItem>) => void | Promise<void>;
      onError?: (error: Error) => void;
      pollIntervalMs?: number;
    },
  ): MeshWatchHandle {
    const pollIntervalMs = options.pollIntervalMs ?? 5_000;
    let isActive = true;
    let lastItems = new Map<unknown, TItem>();
    let timeoutId: NodeJS.Timeout | null = null;

    const emitChange = async (
      items: readonly TResultShape[],
      event: MeshChangeEvent<TItem>,
    ): Promise<void> => {
      try {
        await options.onChange(items, event);
      } catch (err) {
        this.logger.error(`Error in watch onChange handler: ${err}`);
        options.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    };

    const poll = async (): Promise<void> => {
      if (!isActive) return;

      try {
        const result = await this.execute<TItem, TResultShape>(builder);
        const currentItems = new Map<unknown, TItem>();
        const itemKey = builder._getItemKey() as keyof TItem & string;

        // Build current items map
        for (const item of result.items) {
          const key = (item as unknown as TItem)[itemKey];
          currentItems.set(key, item as unknown as TItem);
        }

        // Detect changes by comparing with last poll
        if (lastItems.size > 0) {
          // Check for new items
          for (const [key, item] of currentItems) {
            if (!lastItems.has(key)) {
              await emitChange(result.items, {
                type: "created",
                item,
                timestamp: new Date().toISOString(),
              });
            } else {
              // Check for updates (simple reference equality check - in real impl would deep compare)
              const lastItem = lastItems.get(key);
              if (lastItem !== item) {
                await emitChange(result.items, {
                  type: "updated",
                  item,
                  previousItem: lastItem,
                  timestamp: new Date().toISOString(),
                });
              }
            }
          }

          // Check for deleted items
          for (const [key, item] of lastItems) {
            if (!currentItems.has(key)) {
              await emitChange(result.items, {
                type: "deleted",
                item,
                timestamp: new Date().toISOString(),
              });
            }
          }
        } else {
          // Initial load
          await emitChange(result.items, {
            type: "initial",
            timestamp: new Date().toISOString(),
          });
        }

        lastItems = currentItems;
      } catch (err) {
        this.logger.error(`Watch poll failed: ${err}`);
        options.onError?.(err instanceof Error ? err : new Error(String(err)));
      }

      if (isActive) {
        timeoutId = setTimeout(poll, pollIntervalMs);
      }
    };

    // Start polling
    poll();

    return {
      get isActive() {
        return isActive;
      },
      stop: () => {
        isActive = false;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      },
      refresh: async () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        await poll();
      },
    };
  }

  // ─── Node collection ───────────────────────────────────────────────────

  private async collectFromNodes<TItem>(
    entityKey: string,
    methodName: string,
    payload: Record<string, unknown>,
    options: { organizationId?: string | null; timeoutMs?: number },
  ): Promise<readonly { nodeId: string; items: readonly TItem[]; durationMs: number }[]> {
    try {
      return await this.nodeCaller.callMany<TItem>(
        entityKey,
        methodName,
        payload,
        options,
      );
    } catch (err: unknown) {
      this.logger.error(
        `Failed to collect from nodes for entity '${entityKey}'`,
        String(err),
      );
      return [];
    }
  }

  // ─── Deduplication ─────────────────────────────────────────────────────

  private deduplicate<TItem>(
    items: readonly TItem[],
    itemKey: keyof TItem & string,
  ): TItem[] {
    const seen = new Map<unknown, TItem>();
    for (const item of items) {
      const key = item[itemKey];
      // last-write-wins: later entries overwrite earlier ones
      seen.set(key, item);
    }
    return Array.from(seen.values());
  }

  // ─── Join execution ────────────────────────────────────────────────────

  private async executeJoins<TResultShape>(
    items: TResultShape[],
    joins: readonly MeshResolvedJoin[],
  ): Promise<TResultShape[]> {
    if (joins.length === 0) return items;

    let current: TResultShape[] = items;

    for (const join of joins) {
      // Execute the joined builder fully (recursive — supports nested joins)
      const joinResult = await join.builder.request();
      const rightItems = joinResult.items;

      current = current.flatMap((leftItem): TResultShape[] => {
        const matched = rightItems.filter((rightItem) =>
          join.on(leftItem as AnyRecord, rightItem),
        );

        if (join.type === "inner" && matched.length === 0) {
          return [];
        }

        const joinedValue = matched.length > 0 ? matched[0] : null;
        const stitched = {
          ...leftItem,
          [join.alias]: join.type === "left" ? joinedValue : joinedValue ?? null,
        } as TResultShape;

        return [stitched];
      });
    }

    return current;
  }

  // ─── Projection ────────────────────────────────────────────────────────

  private applyProjection<TResultShape>(
    items: TResultShape[],
    fields: readonly (keyof TResultShape & string)[] | null,
  ): TResultShape[] {
    if (!fields || fields.length === 0) return items;

    return items.map((item) => {
      const projected = {} as TResultShape;
      for (const field of fields) {
        projected[field] = item[field];
      }
      return projected;
    });
  }
}