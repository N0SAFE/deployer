// ─── Types ────────────────────────────────────────────────────────────────────

export interface MeshPaginationState {
  readonly limit: number | null;
  readonly offset: number;
}

export const defaultPaginationState: MeshPaginationState = {
  limit: null,
  offset: 0,
};

// ─── Applier ──────────────────────────────────────────────────────────────────

export function applyPagination<T>(
  items: T[],
  pagination: MeshPaginationState,
): { items: T[]; hasMore: boolean; nextOffset: number | null } {
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