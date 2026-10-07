/**
 * Query utilities for Standard Schema
 * Re-exports all query-related utilities
 */

// Pagination
export {
    createPaginationConfigSchema,
    createPaginationSchema,
    createPaginationMetaSchema,
    createPaginatedResponseSchema,
    offsetPagination,
    pagePagination,
    cursorPagination,
    fullPagination,
    type PaginationConfig,
    type PaginationSchemaOutput,
    type PaginationMetaSchemaOutput,
} from "@repo/orpc-utils/operations/base/utils/pagination";

// Sorting
export {
    createSortingConfigSchema,
    createSortingSchema,
    createSimpleSortSchema,
    createMultiSortSchema,
    sortDirection,
    nullsHandling,
    type SortingConfig,
    type SortingSchemaOutput,
} from "@repo/orpc-utils/operations/base/utils/sorting";

// Filtering
export {
    createFilteringConfigSchema,
    createFilteringSchema,
    createSimpleFilterSchema,
    field,
    stringField,
    numericField,
    comparisonField,
    ALL_FILTER_OPERATORS,
    COMPARISON_OPERATORS,
    STRING_OPERATORS,
    NUMERIC_OPERATORS,
    ARRAY_OPERATORS,
    NULL_OPERATORS,
    type FilterOperator,
    type FieldFilterConfig,
    type FilteringConfig,
} from "@repo/orpc-utils/operations/base/utils/filtering";

// Search
export {
    createSearchConfigSchema,
    createSearchSchema,
    createSimpleSearchSchema,
    createAdvancedSearchSchema,
    createFullTextSearchSchema,
    basicSearchSchema,
    type SearchConfig,
    type SearchSchemaOutput,
} from "@repo/orpc-utils/operations/base/utils/search";

// Query Builder
export {
    QueryBuilder,
    createQueryBuilder,
    createBasicListQuery,
    createSearchableListQuery,
    createAdvancedQuery,
    type QueryConfig,
    type ComputeInputSchema,
    type ComputeOutputSchema,
    type QueryBuilderOptions,
} from "@repo/orpc-utils/operations/base/utils/query-builder";
