import type { z } from "zod";
import type { MeshQueryBuilder } from "./mesh-query-builder";
import type { MeshOrderClause } from "./mesh-order";
import type { MeshPaginationState } from "./mesh-pagination";
import type { MeshWhereExpression } from "./mesh-where";
import type { AnyRecord } from "../../../mesh-type-utils";
import type { MeshQuery } from "../../../mesh-query";

// ─── Join type ────────────────────────────────────────────────────────────────

export type MeshJoinType = "left" | "inner";

// ─── Join result shape ────────────────────────────────────────────────────────

/**
 * Computes the shape produced by a single join expansion.
 *
 * - left  → TRight | null  (unmatched rows keep the key, value is null)
 * - inner → TRight         (unmatched rows are dropped entirely)
 */
export type MeshJoinResultShape<
  TBase,
  TAlias extends string,
  TRight,
  TType extends MeshJoinType,
> = TBase & Record<TAlias, TType extends "inner" ? TRight : TRight | null>;

// ─── AccumulateJoins ──────────────────────────────────────────────────────────
//
// Folds a tuple of join descriptors into a final result shape.
//
// The trick: TypeScript does not allow referencing an inferred type variable
// inside the constraint of a *sibling* infer clause in the same conditional
// branch. Concretely this fails:
//
//   TJoins extends [infer THead extends Foo, ...infer TTail extends Bar<THead>]
//                                                                    ^^^^^^^^
//                                                        Cannot find name 'THead'
//
// Solution: infer THead and TTail *without* constraining TTail, then
// re-narrow both in a nested conditional where THead is already in scope.

/**
 * Recursively accumulates join expansions over a tuple of descriptors.
 *
 * Each step:
 *   1. Peel the head descriptor off the tuple (unconstrained infer).
 *   2. Narrow the head to MeshJoinDescriptor in a nested conditional
 *      where THead is already bound — TTail can now reference it.
 *   3. Compute the next TBase via MeshJoinResultShape.
 *   4. Recurse with the tail.
 */
export type AccumulateJoins<
  TBase,
  TJoins extends readonly MeshJoinDescriptor<string, unknown, MeshJoinType>[],
> =
  // Base case — empty tuple
  TJoins extends readonly []
    ? TBase
    // Step 1: peel head/tail with no constraint on TTail
    : TJoins extends readonly [infer THead, ...infer TTail]
      // Step 2: narrow THead now that it is in scope
      ? THead extends MeshJoinDescriptor<infer TAlias, infer TRight, infer TType>
        // Step 3+4: recurse — TTail can safely reference TAlias/TRight/TType
        ? AccumulateJoins<
            MeshJoinResultShape<TBase, TAlias, TRight, TType>,
            // Narrow TTail to the correct constraint now that THead is resolved
            TTail extends readonly MeshJoinDescriptor<string, unknown, MeshJoinType>[]
              ? TTail
              : readonly []
          >
        : TBase
      : TBase;

// ─── Join descriptor ──────────────────────────────────────────────────────────

/**
 * Fully typed descriptor for a single join.
 *
 * Intentionally does NOT carry TLeft — the left shape is always the
 * accumulated TBase at the point this descriptor is applied, which is
 * computed by AccumulateJoins. Carrying TLeft here would make the tuple
 * constraint circular and cause the same infer-reference error.
 *
 * @param TAlias  - Literal string alias for the nested result key
 * @param TRight  - Shape of the right-side builder's result
 * @param TType   - "left" | "inner"
 */
export interface MeshJoinDescriptor<
  TAlias extends string,
  TRight,
  TType extends MeshJoinType,
> {
  readonly alias: TAlias;
  readonly type: TType;
  /**
   * Phantom field — never read at runtime.
   * Exists solely to carry TRight into the type system so that
   * AccumulateJoins can extract it via `infer TRight`.
   */
  readonly _rightShape: TRight;
  /**
   * The actual right-side builder.
   * Typed as MeshQueryBuilder<unknown, TRight> so the executor can call
   * .execute() and get back TRight[].
   */
  readonly builder: MeshQueryBuilder<unknown, TRight>;
  /**
   * Join predicate.
   * TLeft is widened to AnyRecord here because the descriptor is stored
   * in a homogeneous array — the executor applies the predicate after
   * narrowing via the descriptor's alias.
   */
  readonly on: (left: AnyRecord, right: TRight) => boolean;
}

/**
 * Erased join descriptor stored inside MeshQueryBuilderState.joins.
 * All type parameters are widened so the array can be ReadonlyArray<MeshResolvedJoin>.
 * The executor reads alias/type/builder/on at runtime without needing the generics.
 */
export interface MeshResolvedJoin {
  readonly alias: string;
  readonly type: MeshJoinType;
  readonly builder: MeshQueryBuilder<unknown, AnyRecord>;
  readonly on: (left: AnyRecord, right: AnyRecord) => boolean;
}

// ─── Join configurator ────────────────────────────────────────────────────────

/**
 * Fluent builder for a single join configuration.
 *
 * @param TLeft   - Shape of the left-side result (outer builder's TResultShape)
 * @param TRight  - Shape of the right-side builder's result
 * @param TAlias  - Literal alias (narrows on every .as() call)
 * @param TType   - Literal join type (narrows on every .type() call)
 *
 * The alias and type generics are narrowed progressively so that the
 * final .build() return type carries the exact literal types, which
 * MeshQueryBuilder.join() uses to compute the expanded result shape.
 */
export class MeshJoinConfigurator<
  TLeft,
  TRight,
  TAlias extends string = "joined",
  TType extends MeshJoinType = "left",
> {
  private _alias: TAlias;
  private _type: TType;
  private _on: ((left: TLeft, right: TRight) => boolean) | null = null;

  constructor(
    defaultAlias: TAlias = "joined" as TAlias,
    defaultType: TType = "left" as TType,
  ) {
    this._alias = defaultAlias;
    this._type = defaultType;
  }

  /**
   * Sets the alias. Returns a new configurator with TAlias narrowed to
   * the provided literal string type.
   */
  as<TNewAlias extends string>(
    alias: TNewAlias,
  ): MeshJoinConfigurator<TLeft, TRight, TNewAlias, TType> {
    const next = new MeshJoinConfigurator<TLeft, TRight, TNewAlias, TType>(
      alias,
      this._type,
    );
    next._on = this._on;
    return next;
  }

  /**
   * Sets the join predicate.
   * Both sides are fully typed — TLeft and TRight, no widening.
   */
  on(
    predicate: (left: TLeft, right: TRight) => boolean,
  ): MeshJoinConfigurator<TLeft, TRight, TAlias, TType> {
    this._on = predicate;
    return this;
  }

  /**
   * Sets the join type. Returns a new configurator with TType narrowed
   * to the provided literal.
   */
  type<TNewType extends MeshJoinType>(
    joinType: TNewType,
  ): MeshJoinConfigurator<TLeft, TRight, TAlias, TNewType> {
    const next = new MeshJoinConfigurator<TLeft, TRight, TAlias, TNewType>(
      this._alias,
      joinType,
    );
    next._on = this._on;
    return next;
  }

  /**
   * Finalises the configuration.
   * Returns an object with exact literal types for alias and type,
   * which MeshQueryBuilder.join() uses to compute MeshJoinResultShape.
   */
  build(): {
    readonly alias: TAlias;
    readonly type: TType;
    readonly on: (left: TLeft, right: TRight) => boolean;
  } {
    if (this._on === null) {
      throw new Error(
        `MeshJoinConfigurator: .on() predicate is required before calling .build().`,
      );
    }
    return {
      alias: this._alias,
      type: this._type,
      on: this._on,
    };
  }
}

// ─── Query ref ────────────────────────────────────────────────────────────────

/**
 * A fully typed query method reference produced by meshEntity().
 *
 * @param TItem    - z.infer<itemSchema>
 * @param TInput   - The Zod input schema type
 * @param TOutput  - The Zod output schema type
 */
export interface MeshQueryRef<
  TItem,
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType = z.ZodType,
> extends MeshQuery<TInput, TOutput> {
  readonly itemSchema: z.ZodType<TItem>;
  readonly entityKey: string;
  readonly methodName: string;
  readonly itemKey: string;
}

export type AnyMeshQueryRef = MeshQueryRef<unknown>;

// ─── Builder internal state ───────────────────────────────────────────────────

/**
 * Immutable snapshot of a builder's configuration.
 *
 * @param TItem        - Raw item type from the entity
 * @param TResultShape - Current projected/joined result shape
 *
 * Every builder method returns a *new* state — this object is never mutated.
 */
export interface MeshQueryBuilderState<TItem, TResultShape> {
  /**
   * The query ref this builder was created from.
   */
  readonly query: MeshQueryRef<TItem>;

  /**
   * Accumulated where clauses in declaration order.
   * Applied as AND — all clauses must pass for an item to be included.
   */
  readonly whereClauses: readonly MeshWhereClause<TItem>[];

  /**
   * Accumulated join descriptors, erased to MeshResolvedJoin for storage.
   */
  readonly joins: readonly MeshResolvedJoin[];

  /**
   * Fields to include in the projection.
   * null = no projection, return full TResultShape.
   */
  readonly selectedFields: readonly (keyof TResultShape & string)[] | null;

  /**
   * Ordering clauses applied in declaration order.
   */
  readonly orderClauses: readonly MeshOrderClause<TItem>[];

  /**
   * Pagination state.
   */
  readonly pagination: MeshPaginationState;

  /**
   * Distributed execution scope options.
   */
  readonly scopeOptions: MeshQueryScopeOptions;
}

// ─── Scope options ────────────────────────────────────────────────────────────

export interface MeshQueryScopeOptions {
  readonly organizationId?: string | null;
  readonly broadcastAll?: boolean;
  readonly timeoutMs?: number;
  readonly strategy?: MeshQueryStrategy;
  readonly maxNodes?: number;
}

export type MeshQueryStrategy =
  | "broadcast-first"
  | "broadcast-merge"
  | "direct-node"
  | "local-only"
  | "quorum";

// ─── Result types ─────────────────────────────────────────────────────────────

export interface MeshNodeResponse<TItem> {
  readonly nodeId: string;
  readonly items: readonly TItem[];
  readonly respondedAt: string;
  readonly durationMs: number;
}

export interface MeshQueryResult<TResultShape> {
  readonly items: readonly TResultShape[];
  readonly total: number;
  readonly strategy: MeshQueryStrategy;
  readonly hasMore: boolean;
  readonly nextOffset: number | null;
  readonly nodeResponses: readonly MeshNodeResponse<TResultShape>[];
  readonly durationMs: number;
}

// ─── Builder shape extractors ─────────────────────────────────────────────────

/**
 * Extracts TResultShape from a MeshQueryBuilder.
 */
export type BuilderResultShape<TBuilder> =
  TBuilder extends MeshQueryBuilder<infer _TItem, infer TResult>
    ? TResult
    : never;

/**
 * Extracts TItem from a MeshQueryBuilder.
 */
export type BuilderItemShape<TBuilder> =
  TBuilder extends MeshQueryBuilder<infer TItem, infer _TResult>
    ? TItem
    : never;

// ─── Select result shape ──────────────────────────────────────────────────────

/**
 * Result shape after applying .select().
 * Keys are constrained to keyof TResultShape & string.
 */
export type MeshSelectResult<
  TResultShape,
  TKeys extends readonly (keyof TResultShape & string)[],
> = Pick<TResultShape, TKeys[number]>;

// ─── OrderBy field constraint ─────────────────────────────────────────────────

/**
 * Valid field names for .orderBy() — top-level keys of TItem only.
 */
export type MeshOrderByField<TItem> = keyof TItem & string;

// ─── Where clause union ───────────────────────────────────────────────────────

/**
 * Union of accepted where clause forms for a given TItem.
 */
export type MeshWhereClause<TItem> =
  | Partial<TItem>
  | MeshWhereExpression<TItem & AnyRecord>;