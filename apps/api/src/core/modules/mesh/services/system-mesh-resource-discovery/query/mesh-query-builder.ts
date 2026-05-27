import type { Observable } from "rxjs";
import { from, Subject, merge } from "rxjs";
import { map, share, switchMap } from "rxjs/operators";
import type { AnyRecord } from "../../../mesh-type-utils";
import type { MeshQueryExecutor } from "./mesh-query-executor";
import {
  type MeshQueryBuilderState,
  type MeshQueryScopeOptions,
  type MeshQueryResult,
  type MeshResolvedJoin,
  type MeshJoinType,
  type MeshQueryRef,
  MeshJoinConfigurator,
} from "./mesh-query-builder-types";
import { type MeshWhereExpression, isMeshWhereExpression, applyObjectWhere } from "./mesh-where";
import {
  type MeshOrderClause,
  type MeshOrderDirection,
} from "./mesh-order";
import { defaultPaginationState } from "./mesh-pagination";
import type { MeshChangeEvent, MeshListenResult, MeshStreamEvent } from "./mesh-observable-types";

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
    queryRef: MeshQueryRef<TItem>,
  ): MeshQueryBuilder<TItem, TItem> {
    return new MeshQueryBuilder<TItem, TItem>(executor, {
      query: queryRef,
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

  select<const K extends keyof TResultShape & string>(
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

  // ═══════════════════════════════════════════════════════════════════════════
  // Observable-based API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Request data once.
   * Returns a Promise that resolves with the result.
   *
   * @example
   * const result = await discovery.from(query).request();
   * console.log(result.items);
   */
  request(): Promise<MeshQueryResult<TResultShape>> {
    return this.executor.execute<TItem, TResultShape>(this);
  }

  /**
   * Stream items as they're retrieved.
   * Returns an Observable that emits each item individually.
   *
   * @example
   * discovery.from(query).stream().subscribe({
   *   next: (item) => console.log("Got item:", item),
   *   complete: () => console.log("Stream complete"),
   * });
   */
  stream(): Observable<TResultShape> {
    return from(this.request()).pipe(
      switchMap((result) => from(result.items)),
    );
  }

  /**
   * Listen for real-time updates.
   * Returns an Observable-based interface for continuous updates.
   *
   * Works for BOTH global and node-owned resources with the same API.
   *
   * @example
   * // Get updates as arrays
   * discovery.from(query).listen().items$.subscribe(items => {
   *   console.log("Current items:", items);
   * });
   *
   * // Get change events
   * discovery.from(query).listen().events$.subscribe(event => {
   *   console.log(`Item ${event.type}:`, event.changedItem);
   * });
   */
  listen(): MeshListenResult<TResultShape> {
    // Create subjects for the listen interface
    const itemsSubject = new Subject<readonly TResultShape[]>();
    const eventsSubject = new Subject<MeshChangeEvent<TResultShape>>();

    // Poll interval for updates (could be replaced with event-based updates for global resources)
    const pollIntervalMs = 5_000;
    let lastItems = new Map<unknown, TItem>();

    const poll = async (): Promise<void> => {
      try {
        const result = await this.executor.execute<TItem, TResultShape>(this);
        const currentItemsMap = new Map<unknown, TItem>();
        const itemKey = this._state.query.itemKey as keyof TItem & string;

        // Build current items map
        for (const item of result.items) {
          const key = (item as unknown as TItem)[itemKey];
          currentItemsMap.set(key, item as unknown as TItem);
        }

        const items = result.items;
        const timestamp = new Date().toISOString();

        // Detect changes
        if (lastItems.size > 0) {
          // Check for new and updated items
          for (const [key, item] of currentItemsMap) {
            if (!lastItems.has(key)) {
              // Created
              eventsSubject.next({
                type: "created",
                items,
                changedItem: item as unknown as TResultShape,
                timestamp,
              });
            } else {
              const lastItem = lastItems.get(key);
              if (lastItem !== item) {
                // Updated
                eventsSubject.next({
                  type: "updated",
                  items,
                  changedItem: item as unknown as TResultShape,
                  previousItem: lastItem as unknown as TResultShape,
                  timestamp,
                });
              }
            }
          }

          // Check for deleted items
          for (const [key, item] of lastItems) {
            if (!currentItemsMap.has(key)) {
              eventsSubject.next({
                type: "deleted",
                items,
                changedItem: item as unknown as TResultShape,
                timestamp,
              });
            }
          }
        } else {
          // Initial load
          eventsSubject.next({
            type: "initial",
            items,
            timestamp,
          });
        }

        lastItems = currentItemsMap;
        itemsSubject.next(items);
      } catch (err) {
        eventsSubject.error(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      // Schedule next poll
      setTimeout(() => { void poll(); }, pollIntervalMs);
    };

    // Start polling
    void poll();

    // Create the all$ observable that combines items and events
    const all$ = merge(
      itemsSubject.pipe(
        map((items): MeshStreamEvent<TResultShape> => ({
          type: "data",
          items,
        })),
      ),
      eventsSubject.pipe(
        map((event): MeshStreamEvent<TResultShape> => ({
          type: "data",
          items: event.items,
        })),
      ),
    ).pipe(share());

    return {
      items$: itemsSubject.asObservable().pipe(share()),
      events$: eventsSubject.asObservable().pipe(share()),
      all$,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Legacy async API (deprecated, use Promise-based request() instead)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @deprecated Use `.request()` instead for Promise-based API.
   */
  async execute(): Promise<MeshQueryResult<TResultShape>> {
    return this.executor.execute<TItem, TResultShape>(this);
  }

  // ─── Internal helpers (used by executor) ─────────────────────────────────

  _applyWhereClauses(item: TItem): boolean {
    for (const clause of this._state.whereClauses) {
      if (isMeshWhereExpression(clause)) {
        if (!clause.test(item as TItem & AnyRecord)) return false;
      } else {
        if (!applyObjectWhere(item, clause as Partial<TItem>)) return false;
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

  _getState(): MeshQueryBuilderState<TItem, TResultShape> {
    return this._state;
  }
}