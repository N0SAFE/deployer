/**
 * Core type definitions for route-builder-v2
 * Maximizes reuse of types from @orpc/contract and @orpc/shared
 */

import type { AnySchema, Route } from "@orpc/contract";

/**
 * Re-export commonly used ORPC types
 */
export type { 
    HTTPMethod, 
    HTTPPath, 
    AnySchema, 
    Route,
    InputStructure,
    OutputStructure,
    ErrorMap,
    ErrorMapItem,
    InferSchemaInput,
    InferSchemaOutput,
    ContractProcedure,
} from "@orpc/contract";

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
