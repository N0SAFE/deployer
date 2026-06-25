// Re-export all builder functionality
export * from "./builder";
export * from "./query";

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
    type ZodEntitySchema,
    type ZodEntityOperationOptions,
    type EntityOperationOptions,
    type ListOperationOptions,
    type ListPlainOptions,
    type BuilderFilterField,
} from "./standard";

// Explicitly re-export the standard module's ComputeInputSchema/ComputeOutputSchema
// (overrides the query module's version which uses flattened filter fields)
export type {
    ComputeInputSchema,
    ComputeOutputSchema,
} from "./operations/zod/utils/query-builder";

// Convenience re-exports for most common use cases
export { RouteBuilder, route } from "./builder/core/route-builder";
export { QueryBuilder, createQueryBuilder, createListQuery, createSearchQuery, createAdvancedQuery } from "./query";
export type { InferInputSchema, InferOutputSchema, AnyContractBuilder, AnyContractProcedureOrBuilder } from "./types/type-helpers";
export {
    observable,
    getObservableSchemaDetails,
    OBSERVABLE_DETAILS_SYMBOL,
    type Observable,
    type ObservableObserver,
    type ObservableSubscription,
    type ObservableSchemaDetails,
} from "./utils/observable/contract";
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
} from "./observable/event-iterator";
export {
    ObservableLinkPlugin,
} from "./utils/observable/link-plugin";
export {
    createObservableQueryUtils,
    type ObservableQueryMode,
    type ObservablePipeInvoker,
    type ObservablePipeTransform,
    type ObservableQueryFnOptions,
    type StreamedObservableOptionsConfig,
    type LiveObservableOptionsConfig,
    type ObservableProcedureQueryUtils,
    type ObservableQueryUtils,
} from "./observable/tanstack-query";

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
    meshDomainErrorPayloadSchema,
    meshErrorResponseSchema,
    type MeshDomainErrorPayload,
    type MeshErrorCode,
    type MeshErrorResponse,
} from "./mesh-errors";
