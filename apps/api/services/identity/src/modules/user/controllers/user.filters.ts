
import type { OperatorFilter, UserFilter, UserSortField } from "../repositories/user.repository.types";

/** The sortable columns the user contract declares. */
const USER_SORT_FIELDS: ReadonlySet<string> = new Set(["createdAt", "name", "email", "updatedAt"]);

/**
 * Translate the contract's operator map into the repository filter.
 *
 * A malformed entry is dropped rather than cast: "no results" and "your filter
 * was ignored" must not look identical to a caller.
 */
export function readFilter(filter: unknown): UserFilter {
  if (typeof filter !== "object" || filter === null) return {};
  const source = filter as Record<string, unknown>;
  return {
    ...(toOperatorFilter(source.id) === undefined ? {} : { id: toOperatorFilter(source.id) }),
    ...(toOperatorFilter(source.email) === undefined ? {} : { email: toOperatorFilter(source.email) }),
    ...(toOperatorFilter(source.name) === undefined ? {} : { name: toOperatorFilter(source.name) }),
    ...(typeof source.emailVerified === "boolean" ? { emailVerified: source.emailVerified } : {}),
    ...(toOperatorFilter(source.createdAt) === undefined
      ? {}
      : { createdAt: toOperatorFilter(source.createdAt) }),
  };
}

/** Narrow the contract's `sortBy` into a column the repository can order by. */
export function readSortField(value: string | undefined): UserSortField {
  return value !== undefined && USER_SORT_FIELDS.has(value)
    ? (value as UserSortField)
    : "createdAt";
}

/** Read one entry of the contract's operator map, or drop a malformed one. */
function toOperatorFilter(value: unknown): OperatorFilter | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const entry = value as Record<string, unknown>;
  if (typeof entry.operator !== "string") return undefined;
  return { operator: entry.operator, value: entry.value };
}
