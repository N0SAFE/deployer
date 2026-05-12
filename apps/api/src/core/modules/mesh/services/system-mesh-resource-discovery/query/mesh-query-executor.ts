import { Injectable, Logger } from "@nestjs/common";
import type { MeshQueryBuilder } from "./mesh-query-builder";
import type { MeshQueryResult, MeshNodeResponse, MeshResolvedJoin } from "./mesh-query-builder-types";
import { applyOrdering } from "./mesh-order";
import { applyPagination } from "./mesh-pagination";

// ─── Node call abstraction ────────────────────────────────────────────────────

export interface MeshNodeCaller {
  callMany<TItem>(
    entityKey: string,
    methodName: string,
    payload: unknown,
    options: { organizationId?: string | null; timeoutMs?: number },
  ): Promise<{ nodeId: string; items: TItem[]; durationMs: number }[]>;
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
    const strategy = state.scopeOptions.strategy ?? "broadcast-merge";

    // 1. Collect raw items from all nodes
    const nodeResponses = await this.collectFromNodes<TItem>(
      entityKey,
      state.query.methodName ?? "list",
      {},
      {
        organizationId: state.scopeOptions.organizationId,
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
    const stitched = await this.executeJoins<TItem, TResultShape>(
      ordered as unknown as TResultShape[],
      state.joins,
    );

    // 6. Apply projections
    const projected = this.applyProjection<TResultShape>(
      stitched,
      state.selectedFields as (keyof TResultShape)[] | null,
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
        items: r.items,
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

  // ─── Node collection ───────────────────────────────────────────────────

  private async collectFromNodes<TItem>(
    entityKey: string,
    methodName: string,
    payload: unknown,
    options: { organizationId?: string | null; timeoutMs?: number },
  ): Promise<{ nodeId: string; items: TItem[]; durationMs: number }[]> {
    try {
      return await this.nodeCaller.callMany<TItem>(
        entityKey,
        methodName,
        payload,
        options,
      );
    } catch (err) {
      this.logger.error(
        `Failed to collect from nodes for entity '${entityKey}'`,
        err,
      );
      return [];
    }
  }

  // ─── Deduplication ─────────────────────────────────────────────────────

  private deduplicate<TItem>(
    items: TItem[],
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

  private async executeJoins<TItem, TResultShape>(
    items: TResultShape[],
    joins: readonly MeshResolvedJoin[],
  ): Promise<TResultShape[]> {
    if (joins.length === 0) return items;

    let current = items;

    for (const join of joins) {
      // Execute the joined builder fully (recursive — supports nested joins)
      const joinResult = await join.builder.execute();
      const rightItems = joinResult.items;

      current = current.map((leftItem) => {
        const matched = rightItems.filter((rightItem) =>
          join.on(leftItem, rightItem),
        );

        if (join.type === "inner" && matched.length === 0) {
          return null; // will be filtered below
        }

        return {
          ...leftItem,
          [join.alias]:
            join.type === "left"
              ? matched.length > 0
                ? matched[0] ?? null
                : null
              : matched[0] ?? null,
        };
      }).filter((item): item is TResultShape => item !== null);
    }

    return current;
  }

  // ─── Projection ────────────────────────────────────────────────────────

  private applyProjection<TResultShape>(
    items: TResultShape[],
    fields: (keyof TResultShape)[] | null,
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