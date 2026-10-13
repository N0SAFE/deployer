// ─── Types ────────────────────────────────────────────────────────────────────

export type MeshOrderDirection = "asc" | "desc";

/**
 * A single ordering clause — field name is constrained to keyof TItem & string.
 */
export interface MeshOrderClause<TItem> {
  readonly field: keyof TItem & string;
  readonly direction: MeshOrderDirection;
}

// ─── Applier ──────────────────────────────────────────────────────────────────

/**
 * Applies ordering clauses to an array of items.
 * Clauses are applied in declaration order (primary sort first).
 *
 * Supports string (localeCompare), number, Date, and null handling.
 */
export function applyOrdering<TItem>(
  items: readonly TItem[],
  clauses: readonly MeshOrderClause<TItem>[],
): TItem[] {
  if (clauses.length === 0) return [...items];

  return [...items].sort((a, b) => {
    for (const clause of clauses) {
      const aVal = a[clause.field];
      const bVal = b[clause.field];

      let cmp = 0;

      if (typeof aVal === "string" && typeof bVal === "string") {
        cmp = aVal.localeCompare(bVal);
      } else if (typeof aVal === "number" && typeof bVal === "number") {
        cmp = aVal - bVal;
      } else if (aVal instanceof Date && bVal instanceof Date) {
        cmp = aVal.getTime() - bVal.getTime();
      } else if (aVal == null && bVal != null) {
        cmp = 1;
      } else if (aVal != null && bVal == null) {
        cmp = -1;
      } else {
        cmp = String(aVal).localeCompare(String(bVal));
      }

      if (cmp !== 0) {
        return clause.direction === "asc" ? cmp : -cmp;
      }
    }
    return 0;
  });
}