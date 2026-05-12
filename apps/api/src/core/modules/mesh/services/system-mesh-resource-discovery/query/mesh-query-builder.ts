import type { z } from "zod";
import type { AnyMeshQuery } from "../../../mesh-query";
import type { AnyRecord } from "../../../mesh-type-utils";
import type { MeshQueryExecutor } from "./mesh-query-executor";
import {
  type MeshQueryBuilderState,
  type MeshQueryScopeOptions,
  type MeshQueryResult,
  type MeshResolvedJoin,
  type MeshJoinType,
  MeshJoinConfigurator,
} from "./mesh-query-builder-types";
import { type MeshWhereExpression, isMeshWhereExpression, applyObjectWhere } from "./mesh-where";
import { type MeshOrderClause, type MeshOrderDirection } from "./mesh-order";
import { defaultPaginationState } from "./mesh-pagination";

// ─── Builder ──────────────────────────────────────────────────────────────────

export class MeshQueryBuilder<TItem, TResultShape = TItem> {
  // Internal state — readonly, never mutated
  readonly _state: MeshQueryBuilderState<TItem, TResultShape>;

  private constructor(
    private readonly executor: MeshQueryExecutor,
    state: MeshQueryBuilderState<TItem, TResultShape>,
  ) {
    this._state = state;
  }

  // ─── Static factory ───────────────────────────────────────────────────────

  static create<TItem>(
    executor: MeshQueryExecutor,
    query: AnyMeshQuery & { itemSchema: z.ZodType<TItem> },
  ): MeshQueryBuilder<TItem, TItem> {
    return new MeshQueryBuilder<TItem, TItem>(executor, {
      query,
      whereClauses: [],
      joins: [],
      selectedFields: null,
      orderClauses: [],
      pagination: defaultPaginationState,
      scopeOptions: {},
    });
  }

  // ─── Cloning helper ───────────────────────────────────────────────────────

  private clone<TNewResult = TResultShape>(
    overrides: Partial<MeshQueryBuilderState<TItem, TNewResult>>,
  ): MeshQueryBuilder<TItem, TNewResult> {
    return new MeshQueryBuilder<TItem, TNewResult>(this.executor, {
      ...(this._state as unknown as MeshQueryBuilderState<TItem, TNewResult>),
      ...overrides,
    });
  }

  // ─── scope() ─────────────────────────────────────────────────────────────

  scope(options: MeshQueryScopeOptions): MeshQueryBuilder<TItem, TResultShape> {
    return this.clone({ scopeOptions: { ...this._state.scopeOptions, ...options } });
  }

  // ─── where() — object form ────────────────────────────────────────────────

  where(clause: Partial<TItem>): MeshQueryBuilder<TItem, TResultShape>;

  // ─── where() — expression form ────────────────────────────────────────────

  where(
    expression: MeshWhereExpression<TItem & AnyRecord>,
  ): MeshQueryBuilder<TItem, TResultShape>;

  // ─── where() — implementation ─────────────────────────────────────────────

  where(
    clauseOrExpression: Partial<TItem> | MeshWhereExpression<TItem & AnyRecord>,
  ): MeshQueryBuilder<TItem, TResultShape> {
    return this.clone({
      whereClauses: [...this._state.whereClauses, clauseOrExpression],
    });
  }

  // ─── select() ────────────────────────────────────────────────────────────

  select<const K extends keyof TResultShape>(
    fields: readonly K[],
  ): MeshQueryBuilder<TItem, Pick<TResultShape, K>> {
    return this.clone<Pick<TResultShape, K>>({
      selectedFields: fields,
    });
  }

  // ─── orderBy() ───────────────────────────────────────────────────────────

  orderBy(
    field: keyof TItem & string,
    direction: MeshOrderDirection = "asc",
  ): MeshQueryBuilder<TItem, TResultShape> {
    const clause: MeshOrderClause<TItem> = { field, direction };
    return this.clone({
      orderClauses: [...this._state.orderClauses, clause],
    });
  }

  // ─── limit() ─────────────────────────────────────────────────────────────

  limit(n: number): MeshQueryBuilder<TItem, TResultShape> {
    return this.clone({
      pagination: { ...this._state.pagination, limit: n },
    });
  }

  // ─── offset() ────────────────────────────────────────────────────────────

  offset(n: number): MeshQueryBuilder<TItem, TResultShape> {
    return this.clone({
      pagination: { ...this._state.pagination, offset: n },
    });
  }

  // ─── join() ───────────────────────────────────────────────────────────────
  //
  // Accepts a right-side builder + a configurator callback.
  // The alias and join type are captured and propagated into the result shape.

  join<
    TRightBuilder extends MeshQueryBuilder<any, any>,
    TRight extends object = TRightBuilder extends MeshQueryBuilder<any, infer R> ? R : never,
    TAlias extends string = string,
    TJoinType extends MeshJoinType = "left",
  >(
    right: TRightBuilder,
    configure: (
      join: MeshJoinConfigurator<TResultShape, TRight>,
    ) => MeshJoinConfigurator<TResultShape, TRight>,
  ): MeshQueryBuilder<
    TItem,
    TResultShape & Record<TAlias, TJoinType extends "inner" ? TRight : TRight | null>
  > {
    const configurator = new MeshJoinConfigurator<TResultShape, TRight>();
    const configured = configure(configurator);
    const { alias, on, type } = configured.build();

    const resolvedJoin: MeshResolvedJoin = {
      alias,
      builder: right,
      on: on as (left: unknown, right: unknown) => boolean,
      type,
    };

    return this.clone<
      TResultShape & Record<TAlias, TJoinType extends "inner" ? TRight : TRight | null>
    >({
      joins: [...this._state.joins, resolvedJoin],
    });
  }

  // ─── execute() ───────────────────────────────────────────────────────────

  async execute(): Promise<MeshQueryResult<TResultShape>> {
    return this.executor.execute<TItem, TResultShape>(this);
  }

  // ─── stream() ────────────────────────────────────────────────────────────

  async *stream(): AsyncGenerator<TResultShape> {
    yield* this.executor.stream<TItem, TResultShape>(this);
  }

  // ─── Internal helpers (used by executor) ─────────────────────────────────

  _applyWhereClauses(item: TItem): boolean {
    for (const clause of this._state.whereClauses) {
      if (isMeshWhereExpression(clause)) {
        if (!clause.test(item as TItem & AnyRecord)) return false;
      } else {
        if (!applyObjectWhere(item, clause)) return false;
      }
    }
    return true;
  }

  _getEntityKey(): string {
    return this._state.query.entityKey;
  }

  _getItemKey(): string {
    return this._state.query.itemKey;
  }
}