/**
 * Standard Schema v2 - Base Implementation
 *
 * Pure Standard Schema implementation without Zod dependency.
 * Uses @standard-schema/spec directly for schema definitions.
 */

// Core types
export {
    CONFIG_SYMBOL,
    SHAPE_SYMBOL,
    hasConfig,
    getConfig,
    withConfig,
    getSchemaShape,
    hasShape,
    type AnySchema,
    type HTTPMethod,
    type HTTPPath,
    type StandardSchemaV1,
    type SchemaShape,
    type ObjectSchema,
    type ObjectSchemaWithShape,
    type ArraySchema,
    type OptionalSchema,
    type NullableSchema,
    type LiteralSchema,
    type EnumSchema,
    type UnionSchema,
    type TupleSchema,
    type RecordSchema,
    type VoidSchema,
    type NeverSchema,
    type StringSchema,
    type NumberSchema,
    type BooleanSchema,
    type DateSchema,
    type UUIDSchema,
    type SchemaWithConfig,
    type EntitySchema,
    type RouteMetadata,
    type InferSchemaInput,
    type InferSchemaOutput,
} from "@repo/orpc-utils/operations/base/types";

// Schema factory functions
export {
    s,
    string,
    number,
    int,
    boolean,
    date,
    uuid,
    literal,
    enumeration,
    voidSchema,
    never,
    optional,
    nullable,
    array,
    tuple,
    union,
    object,
    record,
    extend,
    pick,
    omit,
    partial,
    unknown,
    any,
    coerceNumber,
    coerceBoolean,
    isoDatetime,
} from "@repo/orpc-utils/operations/base/schema";

// Query utilities
export * from "@repo/orpc-utils/operations/base/utils/index";

// Standard operations
export type { EntityOperationOptions, ListOperationOptions, ListPlainOptions } from "@repo/orpc-utils/operations/base/standard-operations";
