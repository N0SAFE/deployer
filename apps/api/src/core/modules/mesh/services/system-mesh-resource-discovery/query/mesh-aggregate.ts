import type { AnyRecord } from "../../../mesh-type-utils";

// ─── Aggregator interface ─────────────────────────────────────────────────────

/**
 * A distributed aggregator — computes partial aggregates per node,
 * then merges them into a final result on the caller.
 *
 * @param TResult - The type of the final aggregated result
 */
export interface MeshAggregator<TResult> {
  readonly __aggregatorBrand: "MeshAggregator";
  /** Computes a partial aggregate over a local slice of items */
  partial(items: readonly AnyRecord[]): unknown;
  /** Merges partial results from all nodes into a final result */
  merge(partials: readonly unknown[]): TResult;
}

// ─── count() ─────────────────────────────────────────────────────────────────

export function count(): MeshAggregator<number> {
  return {
    __aggregatorBrand: "MeshAggregator",
    partial: (items) => items.length,
    merge: (partials) => (partials as readonly number[]).reduce((a, b) => a + b, 0),
  };
}

// ─── sum() ───────────────────────────────────────────────────────────────────

/**
 * Sums a numeric field across all items.
 * Non-numeric values are treated as 0.
 */
export function sum<TItem extends AnyRecord, K extends keyof TItem & string>(
  field: TItem[K] extends number ? K : never,
): MeshAggregator<number> {
  return {
    __aggregatorBrand: "MeshAggregator",
    partial: (items) =>
      items.reduce((acc, item) => {
        const v = item[field as keyof AnyRecord];
        return acc + (typeof v === "number" ? v : 0);
      }, 0),
    merge: (partials) => (partials as readonly number[]).reduce((a, b) => a + b, 0),
  };
}

// ─── avg() ───────────────────────────────────────────────────────────────────

/**
 * Computes the average of a numeric field across all items.
 * Returns 0 if there are no items.
 */
export function avg<TItem extends AnyRecord, K extends keyof TItem & string>(
  field: TItem[K] extends number ? K : never,
): MeshAggregator<number> {
  return {
    __aggregatorBrand: "MeshAggregator",
    partial: (items) => ({
      sum: items.reduce((acc, item) => {
        const v = item[field as keyof AnyRecord];
        return acc + (typeof v === "number" ? v : 0);
      }, 0),
      count: items.length,
    }),
    merge: (partials) => {
      const totals = partials as readonly { sum: number; count: number }[];
      const totalSum = totals.reduce((a, b) => a + b.sum, 0);
      const totalCount = totals.reduce((a, b) => a + b.count, 0);
      return totalCount === 0 ? 0 : totalSum / totalCount;
    },
  };
}

// ─── min() ───────────────────────────────────────────────────────────────────

/**
 * Finds the minimum value of a numeric field.
 * Returns null if there are no numeric values.
 */
export function min<TItem extends AnyRecord, K extends keyof TItem & string>(
  field: TItem[K] extends number ? K : never,
): MeshAggregator<number | null> {
  return {
    __aggregatorBrand: "MeshAggregator",
    partial: (items) => {
      const values = items
        .map((i) => i[field as keyof AnyRecord])
        .filter((v): v is number => typeof v === "number");
      return values.length > 0 ? Math.min(...values) : null;
    },
    merge: (partials) => {
      const values = (partials as readonly (number | null)[]).filter(
        (v): v is number => v !== null,
      );
      return values.length > 0 ? Math.min(...values) : null;
    },
  };
}

// ─── max() ───────────────────────────────────────────────────────────────────

/**
 * Finds the maximum value of a numeric field.
 * Returns null if there are no numeric values.
 */
export function max<TItem extends AnyRecord, K extends keyof TItem & string>(
  field: TItem[K] extends number ? K : never,
): MeshAggregator<number | null> {
  return {
    __aggregatorBrand: "MeshAggregator",
    partial: (items) => {
      const values = items
        .map((i) => i[field as keyof AnyRecord])
        .filter((v): v is number => typeof v === "number");
      return values.length > 0 ? Math.max(...values) : null;
    },
    merge: (partials) => {
      const values = (partials as readonly (number | null)[]).filter(
        (v): v is number => v !== null,
      );
      return values.length > 0 ? Math.max(...values) : null;
    },
  };
}

// ─── groupBy() ───────────────────────────────────────────────────────────────

/**
 * Groups items by a field value and applies an inner aggregator to each group.
 *
 * @param field  - The field to group by
 * @param inner  - The aggregator to apply within each group
 */
export function groupBy<TItem extends AnyRecord, K extends keyof TItem & string, T>(
  field: K,
  inner: MeshAggregator<T>,
): MeshAggregator<Record<string, T>> {
  return {
    __aggregatorBrand: "MeshAggregator",
    partial: (items) => {
      const groups = new Map<string, AnyRecord[]>();
      for (const item of items) {
        const key = String(item[field as keyof AnyRecord] ?? "__null__");
        if (!groups.has(key)) groups.set(key, []);
        const value = groups.get(key);
        if (!value) throw new Error('[Illogical] Grouping error: group not found after creation');
        value.push(item);
      }
      const result: Record<string, unknown> = {};
      for (const [key, groupItems] of groups) {
        result[key] = inner.partial(groupItems);
      }
      return result;
    },
    merge: (partials) => {
      const allKeys = new Set<string>(
        (partials as readonly Record<string, unknown>[]).flatMap((p) => Object.keys(p)),
      );
      const result: Record<string, T> = {};
      for (const key of allKeys) {
        const groupPartials = (partials as readonly Record<string, unknown>[])
          .map((p) => p[key])
          .filter((v): v is unknown => v !== undefined);
        result[key] = inner.merge(groupPartials);
      }
      return result;
    },
  };
}

// ─── collect() ───────────────────────────────────────────────────────────────

/**
 * Collects all values of a field into an array.
 */
export function collect<TItem extends AnyRecord, K extends keyof TItem & string, T = TItem[K]>(
  field: K,
): MeshAggregator<T[]> {
  return {
    __aggregatorBrand: "MeshAggregator",
    partial: (items) => items.map((i) => i[field as keyof AnyRecord] as T),
    merge: (partials) => (partials as readonly T[][]).flat(),
  };
}

// ─── distinct() ──────────────────────────────────────────────────────────────

/**
 * Collects distinct string values of a field.
 */
export function distinct<TItem extends AnyRecord, K extends keyof TItem & string>(
  field: K,
): MeshAggregator<string[]> {
  return {
    __aggregatorBrand: "MeshAggregator",
    partial: (items) =>
      [...new Set(items.map((i) => String(i[field as keyof AnyRecord])).filter(Boolean))],
    merge: (partials) => [...new Set((partials as readonly string[][]).flat())],
  };
}

// ─── Aggregate result type helper ─────────────────────────────────────────────

export type AggregateSpec = Record<string, MeshAggregator<any>>;

export type AggregateResult<TSpec extends AggregateSpec> = {
  [K in keyof TSpec]: TSpec[K] extends MeshAggregator<infer R> ? R : never;
};

// ─── Aggregate executor ───────────────────────────────────────────────────────

/**
 * Executes an aggregate spec against a local slice of items.
 * For distributed aggregation, use the two-phase approach:
 *   1. `partialAggregate()` on each node
 *   2. `mergeAggregates()` on the caller
 */
export function executeAggregate<TSpec extends AggregateSpec>(
  items: readonly AnyRecord[],
  spec: TSpec,
): AggregateResult<TSpec> {
  const result = {} as AggregateResult<TSpec>;
  for (const [key, aggregator] of Object.entries(spec) as [keyof TSpec & string, MeshAggregator<unknown>][]) {
    const partial = aggregator.partial(items);
    result[key] = aggregator.merge([partial]) as AggregateResult<TSpec>[typeof key];
  }
  return result;
}