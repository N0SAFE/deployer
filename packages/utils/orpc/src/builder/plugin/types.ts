/**
 * Plugin type-level mappers — the SINGLE dispatch site between the Standard
 * and Zod schema-type implementations, mirroring the plugin class hierarchy
 * (`BasePluginTransformer` / `StandardPluginTransformer` / `ZodPluginTransformer`).
 *
 * Each plugin owns its concrete type ops in its own module (`./standard`'s
 * `Std*` aliases, `./zod`'s `Zod*` aliases). These aliases are the ONLY
 * per-plugin logic; the dispatch below branches on the plugin brand and
 * applies the concrete alias — TypeScript resolves these eagerly (no
 * higher-kinded indirection), so the builder gets the precise per-plugin
 * schema type while the core never inlines plugin logic.
 *
 * Adding a new validation library = new plugin class + `$Infer` contract +
 * a new branch per op here. Everything schema-type lives with the plugin.
 */

import type { AnySchema } from "../../types/types";
import { ZodPluginTransformer } from "./zod";
import type {
    StdField,
    StdOptional,
    StdObjectSchemaOf,
    StdEmptyObject,
    StdVoid,
    StdIsEmptyPart,
    StdIsEmptyObjectSchemaType,
    StdBuiltDetailedInput,
    StdDetailedOutput,
    StdDetectDetailedOutput,
    StdBrandedInputParts,
    StdBuildInput,
    StdBuildOutput,
    StdParamsShapeOf,
    StdExtractOutputBody,
    StdExtractOutputStatus,
    StdExtractOutputHeaders,
    StdOutputProxySchema,
} from "./standard";
import type {
    ZodField,
    ZodOptional,
    ZodObjectSchemaOf,
    ZodEmptyObject,
    ZodVoid,
    ZodIsEmptyPart,
    ZodIsEmptyObjectSchemaType,
    ZodBuiltDetailedInput,
    ZodDetailedOutput,
    ZodDetectDetailedOutput,
    ZodBrandedInputParts,
    ZodBuildInput,
    ZodBuildOutput,
    ZodParamsShapeOf,
    ZodExtractOutputBody,
    ZodExtractOutputStatus,
    ZodExtractOutputHeaders,
    ZodOutputProxySchema,
} from "./zod";

/** Check whether a plugin produces Zod schemas (type-level). */
export type IsPluginZod<TP> = TP extends ZodPluginTransformer ? true : false;

/** Empty object sentinel type produced by a plugin. */
export type PluginEmptyObject<TP> = IsPluginZod<TP> extends true ? ZodEmptyObject : StdEmptyObject;

/** Void sentinel type produced by a plugin. */
export type PluginVoid<TP> = IsPluginZod<TP> extends true ? ZodVoid : StdVoid;

/** Map a part schema to the plugin's native equivalent. */
export type PluginField<TP, T extends AnySchema> = IsPluginZod<TP> extends true ? ZodField<T> : StdField<T>;

/** Optional wrapper type produced by a plugin. */
export type PluginOptional<TP, T extends AnySchema> = IsPluginZod<TP> extends true ? ZodOptional<T> : StdOptional<T>;

/** Object schema type produced by a plugin for a shape. */
export type PluginObjectSchema<TP, TShape extends Record<string, AnySchema>> = IsPluginZod<TP> extends true ? ZodObjectSchemaOf<TShape> : StdObjectSchemaOf<TShape>;

/** True when a part is an empty sentinel (used to omit keys in Zod mode). */
export type IsPluginEmptyPart<TP, T> = IsPluginZod<TP> extends true ? ZodIsEmptyPart<T> : StdIsEmptyPart<T>;

/** Empty-object detection for direct-body collapse. */
export type PluginIsEmptyObjectSchemaType<TP, T extends AnySchema> = IsPluginZod<TP> extends true ? ZodIsEmptyObjectSchemaType<T> : StdIsEmptyObjectSchemaType<T>;

/** Built detailed input envelope (branded). */
export type PluginBuiltDetailedInput<TP, TParams extends AnySchema, TQuery extends AnySchema, TBody extends AnySchema, THeaders extends AnySchema> =
    IsPluginZod<TP> extends true
        ? ZodBuiltDetailedInput<TParams, TQuery, TBody, THeaders>
        : StdBuiltDetailedInput<TParams, TQuery, TBody, THeaders>;

/** Built detailed output envelope (branded). */
export type PluginDetailedOutput<TP, TStatus extends number, THeaders extends AnySchema, TBody extends AnySchema> =
    IsPluginZod<TP> extends true
        ? ZodDetailedOutput<TStatus, THeaders, TBody>
        : StdDetailedOutput<TStatus, THeaders, TBody>;

/** Detect detailed output structure from a plain schema. */
export type PluginDetectDetailedOutput<TP, T extends AnySchema> =
    IsPluginZod<TP> extends true ? ZodDetectDetailedOutput<T> : StdDetectDetailedOutput<T>;

/** Extract the four parts from a branded detailed input envelope. */
export type PluginBrandedInputParts<TP, TInput extends AnySchema> =
    IsPluginZod<TP> extends true ? ZodBrandedInputParts<TInput> : StdBrandedInputParts<TInput>;

/** Resolved contract input type. */
export type PluginBuildInput<TP, TInput extends AnySchema> =
    IsPluginZod<TP> extends true ? ZodBuildInput<TInput> : StdBuildInput<TInput>;

/** Resolved contract output type. */
export type PluginBuildOutput<TP, TOutput extends AnySchema> =
    IsPluginZod<TP> extends true ? ZodBuildOutput<TOutput> : StdBuildOutput<TOutput>;

/** Field-shape extraction from a params schema. */
export type PluginParamsShapeOf<TP, TParams extends AnySchema> =
    IsPluginZod<TP> extends true ? ZodParamsShapeOf<TParams> : StdParamsShapeOf<TParams>;

/** Extract body schema from a detailed output envelope. */
export type PluginExtractOutputBody<TP, T extends AnySchema> =
    IsPluginZod<TP> extends true ? ZodExtractOutputBody<T> : StdExtractOutputBody<T>;

/** Extract numeric status code from a detailed output envelope. */
export type PluginExtractOutputStatus<TP, T extends AnySchema> =
    IsPluginZod<TP> extends true ? ZodExtractOutputStatus<T> : StdExtractOutputStatus<T>;

/** Extract headers schema from a detailed output envelope. */
export type PluginExtractOutputHeaders<TP, T extends AnySchema> =
    IsPluginZod<TP> extends true ? ZodExtractOutputHeaders<T> : StdExtractOutputHeaders<T>;

/** Public schema view for output consumers (200 + no headers → direct body). */
export type PluginOutputProxySchema<TP, TData extends AnySchema> =
    IsPluginZod<TP> extends true ? ZodOutputProxySchema<TData> : StdOutputProxySchema<TData>;
