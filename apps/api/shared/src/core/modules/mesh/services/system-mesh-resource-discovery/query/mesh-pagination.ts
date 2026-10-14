// ─── Types ────────────────────────────────────────────────────────────────────

export interface MeshPaginationState {
  readonly limit: number | null;
  readonly offset: number;
}

export const defaultPaginationState: MeshPaginationState = {
  limit: null,
  offset: 0,
} as const;

// ─── Applier ──────────────────────────────────────────────────────────────────

export interface MeshPaginationResult<T> {
  readonly items: readonly T[];
  readonly hasMore: boolean;
  readonly nextOffset: number | null;
}

/**
 * Applies pagination to an array of items.
 * Returns the sliced items along with hasMore and nextOffset metadata.
 */
export function applyPagination<T>(
  items: readonly T[],
  pagination: MeshPaginationState,
): MeshPaginationResult<T> {
  const start = pagination.offset;
  const sliced =
    pagination.limit !== null
      ? items.slice(start, start + pagination.limit)
      : items.slice(start);

  const hasMore =
    pagination.limit !== null
      ? start + pagination.limit < items.length
      : false;

  const nextOffset = hasMore
    ? start + (pagination.limit ?? sliced.length)
    : null;

  return { items: sliced, hasMore, nextOffset };
}