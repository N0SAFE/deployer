import type { AnyRecord } from "../../../mesh-type-utils";

// ─── Aggregator interface ─────────────────────────────────────────────────────

export interface MeshAggregator<TResult> {
  readonly __aggregatorBrand: "MeshAggregator";
  /** Computes a partial aggregate over a local slice of items */
  partial(items: AnyRecord[]): unknown;
  /** Merges partial results from all nodes into a final result */
  merge(partials: unknown[]): TResult;
}

// ─── count() ─────────────────────────────────────────────────────────────────

export function count(): MeshAggregator<number> {
  return {
    __aggregatorBrand: "MeshAggregator",
    partial: (items) => items.length,
    merge: (partials) => (partials as number[]).reduce((a, b) => a + b, 0),
  };
}

// ─── sum() ───────────────────────────────────────────────────────────────────

export function sum(field: string): MeshAggregator<number> {
  return {
    __aggregatorBrand: "MeshAggregator",
    partial: (items) =>
      items.reduce((acc, item) => {
        const v = item[field];
        return acc + (typeof v === "number" ? v : 0);
      }, 0),
    merge: (partials) => (partials as number[]).reduce((a, b) => a + b, 0),
  };
}

// ─── avg() ───────────────────────────────────────────────────────────────────

export function avg(field: string): MeshAggregator<number> {
  return {
    __aggregatorBrand: "MeshAggregator",
    partial: (items) => ({
      sum: items.reduce((acc, item) => {
        const v = item[field];
        return acc + (typeof v === "number" ? v : 0);
      }, 0),
      count: items.length,
    }),
    merge: (partials) => {
      const totals = partials as { sum: number; count: number }[];
      const totalSum = totals.reduce((a, b) => a + b.sum, 0);
      const totalCount = totals.reduce((a, b) => a + b.count, 0);
      return totalCount === 0 ? 0 : totalSum / totalCount;
    },
  };
}

// ─── min() ───────────────────────────────────────────────────────────────────

export function min(field: string): MeshAggregator<number | null> {
  return {
    __aggregatorBrand: "MeshAggregator",
    partial: (items) => {
      const values = items
        .map((i) => i[field])
        .filter((v): v is number => typeof v === "number");
      return values.length > 0 ? Math.min(...values) : null;
    },
    merge: (partials) => {
      const values = (partials as (number | null)[]).filter(
        (v): v is number => v !== null,
      );
      return values.length > 0 ? Math.min(...values) : null;
    },
  };
}

// ─── max() ───────────────────────────────────────────────────────────────────

export function max(field: string): MeshAggregator<number | null> {
  return {
    __aggregatorBrand: "MeshAggregator",
    partial: (items) => {
      const values = items
        .map((i) => i[field])
        .filter((v): v is number => typeof v === "number");
      return values.length > 0 ? Math.max(...values) : null;
    },
    merge: (partials) => {
      const values = (partials as (number | null)[]).filter(
        (v): v is number => v !== null,
      );
      return values.length > 0 ? Math.max(...values) : null;
    },
  };
}

// ─── groupBy() ───────────────────────────────────────────────────────────────

export function groupBy<T>(
  field: string,
  inner: MeshAggregator<T>,
): MeshAggregator<Record<string, T>> {
  return {
    __aggregatorBrand: "MeshAggregator",
    partial: (items) => {
      const groups = new Map<string, AnyRecord[]>();
      for (const item of items) {
        const key = String(item[field] ?? "__null__");
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
        (partials as Record<string, unknown>[]).flatMap((p) => Object.keys(p)),
      );
      const result: Record<string, T> = {};
      for (const key of allKeys) {
        const groupPartials = (partials as Record<string, unknown>[])
          .map((p) => p[key])
          .filter((v) => v !== undefined);
        result[key] = inner.merge(groupPartials);
      }
      return result;
    },
  };
}

// ─── collect() ───────────────────────────────────────────────────────────────

export function collect<T = unknown>(field: string): MeshAggregator<T[]> {
  return {
    __aggregatorBrand: "MeshAggregator",
    partial: (items) => items.map((i) => i[field]),
    merge: (partials) => (partials as T[][]).flat(),
  };
}

// ─── distinct() ──────────────────────────────────────────────────────────────

export function distinct(field: string): MeshAggregator<string[]> {
  return {
    __aggregatorBrand: "MeshAggregator",
    partial: (items) =>
      [...new Set(items.map((i) => String(i[field])).filter(Boolean))],
    merge: (partials) => [...new Set((partials as string[][]).flat())],
  };
}

// ─── Aggregate result type helper ─────────────────────────────────────────────

export type AggregateSpec = Record<string, MeshAggregator<any>>;

export type AggregateResult<TSpec extends AggregateSpec> = {
  [K in keyof TSpec]: TSpec[K] extends MeshAggregator<infer R> ? R : never;
};

// ─── Aggregate executor ───────────────────────────────────────────────────────

export function executeAggregate<TSpec extends AggregateSpec>(
  items: AnyRecord[],
  spec: TSpec,
): AggregateResult<TSpec> {
  const result = {} as AggregateResult<TSpec>;
  for (const [key, aggregator] of Object.entries(spec) as [keyof TSpec, MeshAggregator<any>][]) {
    const partial = aggregator.partial(items);
    result[key] = aggregator.merge([partial]);
  }
  return result;
}