/**
 * Query utilities public entrypoint.
 *
 * ARCHITECTURE NOTE:
 * This module is now a compatibility facade over the canonical
 * `standard/zod/utils` query implementation.
 *
 * Why:
 * - avoid divergent query stacks,
 * - keep `@repo/orpc-utils/query` stable for consumers,
 * - centralize maintenance in one canonical location.
 */

// Canonical query utilities (single source of truth)
export * from "../operations/zod/utils";

// Backward-compatible aliases from historical query API naming
export {
	createBasicListQuery as createListQuery,
	createSearchableListQuery as createSearchQuery,
} from "../operations/zod/utils/query-builder";

export {
	createAdvancedSearchSchema as createFullTextSearchSchema,
} from "../operations/zod/utils/search";
