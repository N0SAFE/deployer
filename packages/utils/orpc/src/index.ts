// Re-export all builder functionality
export * from "@repo/orpc-utils/builder/index";

// Re-export filter operators used by entity schemas
export { ALL_FILTER_OPERATORS, type FilterOperator } from "@repo/orpc-utils/operations/base/utils/index";

// Re-export standard operations (unified entry point)
export {
    standard,
    ZodStandardOperations,
    zodStandard,
    createZodStandardOperations,
    BaseStandardOperations,
    ListOperationBuilder,
    createListConfig,
    createFilterConfig,
    createPaginationConfigSchema,
    createSortingConfigSchema,
    type ZodEntitySchema,
    type ZodEntityOperationOptions,
    type EntityOperationOptions,
    type ListOperationOptions,
    type ListPlainOptions,
    type BuilderFilterField,
} from "@repo/orpc-utils/standard/index";

// Explicitly re-export the standard module's ComputeInputSchema/ComputeOutputSchema
// (overrides the query module's version which uses flattened filter fields)
export type {
    ComputeInputSchema,
    ComputeOutputSchema,
} from "@repo/orpc-utils/operations/zod/utils/query-builder";

// Convenience re-exports for most common use cases
export { RouteBuilder, route } from "@repo/orpc-utils/builder/core/route-builder";
export type { InferInputSchema, InferOutputSchema, AnyContractBuilder, AnyContractProcedureOrBuilder } from "@repo/orpc-utils/types/type-helpers";
export {
    observable,
    getObservableSchemaDetails,
    OBSERVABLE_DETAILS_SYMBOL,
    type Observable,
    type ObservableObserver,
    type ObservableSubscription,
    type ObservableSchemaDetails,
} from "@repo/orpc-utils/utils/observable/contract";
export {
    createDirectObservable,
    createEventIteratorFrame,
    isEventIteratorFrame,
    serializeEventIteratorFrame,
    deserializeEventIteratorFrame,
    deconstructObservableToEventIterator,
    reconstructObservableFromEventIterator,
    type DirectObservable,
    type DirectObserver,
    type DirectSubscription,
    type EventIteratorFrame,
    type EventIteratorFrameKind,
    type EventIteratorProtocolVersion,
    type EventSerializer,
    type EventDeserializer,
} from "@repo/orpc-utils/observable/event-iterator";
export {
    ObservableLinkPlugin,
} from "@repo/orpc-utils/utils/observable/link-plugin";
export {
    createObservableQueryUtils,
    type ObservableQueryMode,
    type ObservablePipeTransform,
    type ObservableQueryFnOptions,
    type StreamedObservableOptionsConfig,
    type LiveObservableOptionsConfig,
    type ObservableProcedureQueryUtils,
    type ObservableQueryUtils,
} from "@repo/orpc-utils/observable/tanstack-query";

// Re-export RxJS primitives to avoid requiring direct app-level rxjs installs.
export {
    Observable as RxObservable,
    Subscription as RxSubscription,
    debounceTime,
} from "rxjs";

// Re-export shared ORPC mesh error definitions (single source of truth
// for the contract + the HTTP exception filter).
export {
    MESH_ERROR_CODES,
    MESH_ERROR_HTTP_STATUS,
    MESH_ERROR_ORPC_CODE,
    meshDomainErrorContracts,
    meshDomainErrorPayload,
    meshDomainErrorPayloadSchema,
    meshErrorActions,
    meshErrorResponseSchema,
    type MeshDomainErrorPayload,
    type MeshErrorCode,
    type MeshErrorResponse,
} from "@repo/orpc-utils/mesh-errors";

// Re-export the generic product-domain error definitions (non-mesh) so
// every contract that can throw a domain error can declare typed errors.
export {
    domainErrorOptions,
    STANDARD_DOMAIN_ERROR_DEFS,
    STANDARD_DOMAIN_HTTP_STATUS,
    STANDARD_DOMAIN_ORPC_CODE,
    standardDomainErrorContracts,
    standardDomainErrorPayloadSchema,
    standardErrorActions,
    standardErrorOptions,
    type StandardDomainErrorPayload,
} from "@repo/orpc-utils/standard-errors";
