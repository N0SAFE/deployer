/**
 * Core type definitions for route-builder-v2
 * Maximizes reuse of types from @orpc/contract and @orpc/shared
 *
 * oRPC v2 removed the standalone routing types (`HTTPMethod`, `HTTPPath`,
 * `Route`) from `@orpc/contract`: routing now lives in OpenAPI metadata
 * (`OpenAPIMeta`). They are defined here so the builder's public surface keeps
 * working, and `RouteMetadata` stays assignable to `OpenAPIMeta`.
 */

import type { AnySchema } from "@orpc/contract";
import type { OpenAPIMeta } from "@orpc/openapi";

/**
 * HTTP methods a procedure can be routed on. Mirrors `OpenAPIMeta['method']`
 * so `RouteMetadata` is assignable to `OpenAPIMeta` without a cast.
 */
export type HTTPMethod = NonNullable<OpenAPIMeta["method"]>;

/** URL path for a procedure, e.g. `/users/{id}`. */
export type HTTPPath = NonNullable<OpenAPIMeta["path"]>;

/**
 * Route metadata carried by `RouteBuilder`. Alias of `OpenAPIMeta` so a built
 * contract can be handed straight to `openapi()`.
 */
export type Route = OpenAPIMeta;

/**
 * Re-export commonly used ORPC types
 */
export type {
    AnySchema,
    ErrorMap,
    ErrorMapItem,
    InferSchemaInput,
    InferSchemaOutput,
    ProcedureContract,
} from "@orpc/contract";

/**
 * oRPC v2 renamed the input/output structure options; they now live on
 * `OpenAPIMeta`. Aliased here because the builder's public types reference them.
 */
export type InputStructure = NonNullable<OpenAPIMeta["inputStructure"]>;
export type OutputStructure = NonNullable<OpenAPIMeta["outputStructure"]>;

// Utility types (formerly from @orpc/shared)
export type IsEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export type IsNever<T> = [T] extends [never] ? true : false;

/**
 * Route metadata alias for backward compatibility
 */
export type RouteMetadata = Route;

/**
 * Custom modifier type for extending builder functionality
 */
export type CustomModifier<TInput = unknown, TOutput = unknown> = (schema: TInput) => TOutput;

/**
 * Contract procedure state
 */
export type ContractProcedureState = {
    input?: AnySchema;
    output?: AnySchema;
};

/**
 * Union tuple type - a tuple with at least 2 elements.
 * Required for unionSchema which needs at least 2 schemas.
 */
export type UnionTuple = readonly [AnySchema, AnySchema, ...AnySchema[]];
