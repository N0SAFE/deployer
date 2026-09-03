 
/**
 * Default schema transformer — wraps the existing Standard Schema helpers.
 * This is exactly what the builder did before the plugin system existed:
 * zero behavior change when used (it is the default).
 */

import type { AnySchema } from "../../types/types";
import type {
    ObjectSchema,
    OptionalSchema,
    LiteralSchema,
    VoidSchema,
    NeverSchema,
    SchemaShape,
    ShouldBeOptional,
} from "../../types/standard-schema-helpers";
import {
    objectSchema,
    emptyObjectSchema,
    voidSchema,
    neverSchema,
    literalSchema,
    optionalSchema,
    unionSchema,
    isObjectSchema,
    isOptionalSchema,
    isVoidSchema,
    isNeverSchema,
    getSchemaShape,
} from "../../types/standard-schema-helpers";
import { BasePluginTransformer, type PluginInfer } from "./base";
import { DetailedInputBrand, DetailedOutputBrand } from "../core/route-builder";

/**
 * Standard plugin type-level schema ops (today's behavior).
 * Declared as an interface + merged onto the class via the `$Infer` phantom so
 * the core can dispatch through the plugin generic.
 */
/** Empty-part detection for a standard part. */
export type StdIsEmptyPart<T> =
    T extends ObjectSchema<infer S extends SchemaShape> ? ([keyof S] extends [never] ? true : false)
    : T extends OptionalSchema<infer I> ? StdIsEmptyPart<I>
    : T extends VoidSchema | NeverSchema ? true
    : false;

/** Empty-object detection for direct-body collapse. */
export type StdIsEmptyObjectSchemaType<T extends AnySchema> =
    T extends ObjectSchema<infer S extends SchemaShape> ? (keyof S extends never ? true : false) : false;

/** Map a part schema to its Standard equivalent (identity — today's behavior). */
export type StdField<T extends AnySchema> = T;

/** Optional wrapper. */
export type StdOptional<T extends AnySchema> = OptionalSchema<T>;

/** Object schema for a shape. */
export type StdObjectSchemaOf<TShape extends Record<string, AnySchema>> = ObjectSchema<TShape>;

/** Empty object sentinel. */
export type StdEmptyObject = ObjectSchema<Record<never, never>>;

/** Void sentinel. */
export type StdVoid = VoidSchema;

/** Built detailed input envelope (all four keys, branded). */
export type StdBuiltDetailedInput<
    TParams extends AnySchema,
    TQuery extends AnySchema,
    TBody extends AnySchema,
    THeaders extends AnySchema,
> = ObjectSchema<{
    params: ShouldBeOptional<TParams> extends true ? OptionalSchema<TParams> : TParams;
    query: ShouldBeOptional<TQuery> extends true ? OptionalSchema<TQuery> : TQuery;
    body: ShouldBeOptional<TBody> extends true ? OptionalSchema<TBody> : TBody;
    headers: ShouldBeOptional<THeaders> extends true ? OptionalSchema<THeaders> : THeaders;
}> & { readonly [DetailedInputBrand]: true };

/** Built detailed output envelope (status/headers/body, branded). */
export type StdDetailedOutput<
    TStatus extends number,
    THeaders extends AnySchema,
    TBody extends AnySchema,
> = ObjectSchema<{
    status: ReturnType<typeof literalSchema<TStatus>>;
    headers: THeaders;
    body: TBody;
}> & { readonly [DetailedOutputBrand]: true };

/** Detect detailed output structure from a plain schema (structural). */
export type StdDetectDetailedOutput<T> =
    T extends ObjectSchema<infer Shape>
        ? Shape extends { status: ReturnType<typeof literalSchema<infer S extends string | number | boolean>>, headers: infer H, body: infer B }
            ? S extends number
                ? H extends AnySchema
                    ? B extends AnySchema
                        ? StdDetailedOutput<S, H, B>
                        : T
                    : T
                : T
            : T
        : T;

/** Extract the four parts from a branded detailed input envelope. */
export type StdBrandedInputParts<TInput extends AnySchema> =
    TInput extends { readonly [DetailedInputBrand]: true }
        ? TInput extends ObjectSchema<infer Shape>
            ? {
                params: Shape extends { params: infer P extends AnySchema } ? P : StdEmptyObject;
                query: Shape extends { query: infer Q extends AnySchema } ? Q : StdEmptyObject;
                body: Shape extends { body: infer B extends AnySchema } ? B : StdEmptyObject;
                headers: Shape extends { headers: infer H extends AnySchema } ? H : StdEmptyObject;
            }
            : { params: StdEmptyObject; query: StdEmptyObject; body: TInput; headers: StdEmptyObject }
        : { params: StdEmptyObject; query: StdEmptyObject; body: TInput; headers: StdEmptyObject };

/** Resolved contract input (the brand is stripped at build-time; type passes through). */
export type StdBuildInput<TInput extends AnySchema> = TInput;

/** Resolved contract output (the brand is stripped at build-time; type passes through). */
export type StdBuildOutput<TOutput extends AnySchema> = TOutput;

/** Field-shape extraction from a params schema. */
export type StdParamsShapeOf<TParams extends AnySchema> =
    TParams extends ObjectSchema<infer S extends SchemaShape> ? S : Record<never, never>;

/** Extract body schema from a detailed output envelope. */
export type StdExtractOutputBody<T extends AnySchema> =
    T extends ObjectSchema<infer S> ? (S extends { body: infer B extends AnySchema } ? B : T) : T;

/** Extract numeric status code from a detailed output envelope. */
export type StdExtractOutputStatus<T extends AnySchema> =
    T extends ObjectSchema<infer S> ? (S extends { status: LiteralSchema<infer N extends number> } ? N : 200) : 200;

/** Extract headers schema from a detailed output envelope. */
export type StdExtractOutputHeaders<T extends AnySchema> =
    T extends ObjectSchema<infer S> ? (S extends { headers: infer H extends AnySchema } ? H : ObjectSchema<Record<never, never>>) : ObjectSchema<Record<never, never>>;

/** Public schema view for output consumers (200 + no headers → direct body). */
export type StdOutputProxySchema<TData extends AnySchema> =
    TData extends StdDetailedOutput<infer S, infer H, infer B>
        ? S extends 200
            ? (StdIsEmptyPart<H> extends true ? B : TData)
            : TData
        : TData;

export type StandardPluginInfer = PluginInfer & {
    Field: <T extends AnySchema>(t: T) => T;
    Optional: <T extends AnySchema>(t: T) => OptionalSchema<T>;
    ObjectSchema: <TShape extends SchemaShape>(shape: TShape) => ObjectSchema<TShape>;
    EmptyObject: ObjectSchema<Record<never, never>>;
    Void: VoidSchema;
    IsEmptyPart: <T extends AnySchema>(t: T) => StdIsEmptyPart<T>;
    IsEmptyObjectSchemaType: <T extends AnySchema>(t: T) => StdIsEmptyObjectSchemaType<T>;
    BuiltDetailedInput: <TParams extends AnySchema, TQuery extends AnySchema, TBody extends AnySchema, THeaders extends AnySchema>(
        params: TParams, query: TQuery, body: TBody, headers: THeaders,
    ) => ObjectSchema<{
        params: ShouldBeOptional<TParams> extends true ? OptionalSchema<TParams> : TParams;
        query: ShouldBeOptional<TQuery> extends true ? OptionalSchema<TQuery> : TQuery;
        body: ShouldBeOptional<TBody> extends true ? OptionalSchema<TBody> : TBody;
        headers: ShouldBeOptional<THeaders> extends true ? OptionalSchema<THeaders> : THeaders;
    }> & { readonly [DetailedInputBrand]: true };
    DetailedOutput: <TStatus extends number, THeaders extends AnySchema, TBody extends AnySchema>(
        status: TStatus, headers: THeaders, body: TBody,
    ) => ObjectSchema<{
        status: ReturnType<typeof literalSchema<TStatus>>;
        headers: THeaders;
        body: TBody;
    }> & { readonly [DetailedOutputBrand]: true };
    DetectDetailedOutput: <T extends AnySchema>(t: T) => T;
    BrandedInputParts: <TInput extends AnySchema>(input: TInput) => TInput extends { readonly [DetailedInputBrand]: true }
        ? TInput extends ObjectSchema<infer Shape>
            ? {
                params: Shape extends { params: infer P extends AnySchema } ? P : ObjectSchema<Record<never, never>>;
                query: Shape extends { query: infer Q extends AnySchema } ? Q : ObjectSchema<Record<never, never>>;
                body: Shape extends { body: infer B extends AnySchema } ? B : ObjectSchema<Record<never, never>>;
                headers: Shape extends { headers: infer H extends AnySchema } ? H : ObjectSchema<Record<never, never>>;
            }
            : { params: ObjectSchema<Record<never, never>>; query: ObjectSchema<Record<never, never>>; body: TInput; headers: ObjectSchema<Record<never, never>> }
        : { params: ObjectSchema<Record<never, never>>; query: ObjectSchema<Record<never, never>>; body: TInput; headers: ObjectSchema<Record<never, never>> };
    BuildInput: <TInput extends AnySchema>(input: TInput) => TInput;
    BuildOutput: <TOutput extends AnySchema>(output: TOutput) => TOutput;
    ParamsShapeOf: <TParams extends AnySchema>(params: TParams) => TParams extends ObjectSchema<infer S extends SchemaShape> ? S : Record<never, never>;
    ExtractOutputBody: <T extends AnySchema>(t: T) => T;
    ExtractOutputStatus: <T extends AnySchema>(t: T) => 200;
    ExtractOutputHeaders: <T extends AnySchema>(t: T) => ObjectSchema<Record<never, never>>;
    OutputProxySchema: <TData extends AnySchema>(data: TData) => TData;
}

export class StandardPluginTransformer extends BasePluginTransformer<ObjectSchema> {
    /** Type-level schema ops namespace (see StandardPluginInfer). */
    declare readonly $Infer: StandardPluginInfer;
    override object<TShape extends SchemaShape>(shape: TShape): ObjectSchema<TShape> {
        return objectSchema(shape);
    }

    override emptyObject(): ObjectSchema<Record<never, never>> {
        return emptyObjectSchema();
    }

    override voidSchema(): VoidSchema {
        return voidSchema();
    }

    override neverSchema(): NeverSchema {
        return neverSchema();
    }

    override literalSchema<T extends string | number | boolean>(value: T): LiteralSchema<T> {
        return literalSchema(value);
    }

    override optional<T extends AnySchema>(schema: T): OptionalSchema<T> {
        return optionalSchema(schema);
    }

    override union<T extends readonly [AnySchema, AnySchema, ...AnySchema[]]>(options: T) {
        return unionSchema(options);
    }

    override getShape(schema: AnySchema): SchemaShape | null {
         
         
        return isObjectSchema(schema) ? getSchemaShape(schema) : null;
    }

    override isOptional(schema: AnySchema): boolean {
        return isOptionalSchema(schema);
    }

    override unwrapOptional(schema: AnySchema): AnySchema {
        return isOptionalSchema(schema) ? (schema)._inner : schema;
    }

    override isEmpty(schema: AnySchema): boolean {
        if (isVoidSchema(schema) || isNeverSchema(schema)) return true;
        if (isOptionalSchema(schema)) return this.isEmpty((schema)._inner);
        if (isObjectSchema(schema)) return Object.keys(getSchemaShape(schema)).length === 0;
        return false;
    }

    override getLiteralValue(schema: AnySchema): string | number | boolean | null {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime literal probe on AnySchema
        return typeof schema === "object" && schema !== null && "_value" in schema
            ? (schema as LiteralSchema<string | number | boolean>)._value
            : null;
    }

    override omitEmptyParts(): boolean {
        return false;
    }

    override producesZod(): boolean {
        return false;
    }
}
