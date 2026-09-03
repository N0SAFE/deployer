/**
 * Zod schema transformer — every schema the builder creates becomes a REAL
 * Zod schema, so the contract's inferred input/output schemas are Zod from
 * the start (`z.infer`, `.parse()`, `.extend()` all work).
 *
 * Constraint: in Zod mode the PARTS passed to the builder (`.body(x)`,
 * `.headers(h)`, `.query(q)` ...) must be Zod schemas — the Zod transformer
 * reuses them by reference (identity), it only wraps the envelope itself.
 *
 * Introspection is built on zod v4's runtime def structure (verified):
 *   - `_zod.def.type` is the discriminator
 *     ("object" | "optional" | "undefined" | "never" | "literal" ...)
 *   - `_zod.def.shape` is a plain OBJECT of field schemas (not a function)
 *   - optional inner: `_zod.def.innerType`
 *   - literal value: `_zod.def.values[0]` (array — zod v4 literal unions)
 */

 
import * as z from "zod";
import type { Schema } from "@orpc/contract";
import type { AnySchema } from "../../types/types";
import type { SchemaShape, OptionalSchema, LiteralSchema, VoidSchema, NeverSchema, ObjectSchema } from "../../types/standard-schema-helpers";
import { BasePluginTransformer, type PluginInfer } from "./base";
import { DetailedInputBrand, DetailedOutputBrand } from "../core/route-builder";

/**
 * Make a shape field satisfy `z.ZodObject`'s `SomeType` constraint (`_zod`)
 * WITHOUT corrupting the schema's `~standard` input/output types.
 *
 * - Real Zod schemas pass through unchanged.
 * - ORPC custom `Schema<TIn, TOut>` bodies (observable / streamed /
 *   eventIterator) are intersected with a PARAMETRIZED `z.ZodType<TOut, TIn>`
 *   so the resulting `~standard.input/output` keep their Observable /
 *   AsyncIterable types. A bare `& z.ZodType` would collapse
 *   `~standard.output` to `unknown`, breaking client stream inference.
 * - Anything else falls back to `& z.ZodType`.
 */
export type ZodShapeField<T> =
    T extends z.ZodType ? T
    : T extends Schema<infer TIn, infer TOut> ? T & z.ZodType<TOut, TIn>
    : T & z.ZodType;

/**
 * Zod plugin type-level schema ops. All Zod schema-type decisions live here,
 * namespaced under `$Infer` so the core dispatches through the plugin generic.
 *
 * Primitives are hoisted to standalone aliases (ZodField / ZodOptional / ...)
 * so the interface members reference THOSE, never `ZodPluginInfer[...]`
 * (self-referential interface members crash tsgo).
 */
/** Map a part schema to its Zod equivalent. */
export type ZodField<T extends AnySchema> =
    T extends OptionalSchema<infer I> ? z.ZodOptional<ZodShapeField<ZodField<I>>>
    : T extends LiteralSchema<infer V extends string | number | boolean> ? z.ZodLiteral<V>
    : T extends VoidSchema ? z.ZodUndefined
    : T extends NeverSchema ? z.ZodNever
    : T extends ObjectSchema<infer Sh extends SchemaShape> ? ZodObjectSchemaOf<Sh>
    : T;

/** Optional wrapper. */
export type ZodOptional<T extends AnySchema> =
    T extends OptionalSchema<infer I> ? z.ZodOptional<ZodShapeField<ZodField<I>>> : z.ZodOptional<ZodShapeField<T>>;

/** Object schema for a shape. */
export type ZodObjectSchemaOf<TShape extends Record<string, AnySchema>> =
    z.ZodObject<{ [K in keyof TShape]: ZodShapeField<ZodField<TShape[K]>> }>;

/** Empty-object detection for direct-body collapse. */
export type ZodIsEmptyObjectSchemaType<T extends AnySchema> =
    T extends z.ZodObject<infer S> ? ([keyof S] extends [never] ? true : false)
    : T extends z.ZodOptional<infer I extends z.ZodType> ? ZodIsEmptyObjectSchemaType<I>
    : T extends z.ZodUndefined | z.ZodNever ? true
    : false;

/** Empty-part detection (used to omit keys from the envelope). */
export type ZodIsEmptyPart<T> =
    T extends z.ZodObject<infer S> ? ([keyof S] extends [never] ? true : false)
    : T extends z.ZodOptional<infer I extends z.ZodType> ? ZodIsEmptyPart<I>
    : T extends z.ZodUndefined | z.ZodNever ? true
    : false;

/** Void sentinel. */
export type ZodVoid = z.ZodUndefined;

/**
 * Mirrors the runtime `shouldBeOptional()` for a detailed-input part:
 * a part is optional when it is explicitly optional (ZodOptional / nullable /
 * undefined / never / our OptionalSchema marker), when it is an empty object,
 * or when it is an object whose fields are ALL optional. A plain required
 * schema (e.g. `z.custom<WebhookEvent>()`) is NOT optional.
 */
export type ZodShouldBeOptional<T extends AnySchema> =
    T extends z.ZodOptional<any> ? true
    : T extends z.ZodNullable<infer I extends z.ZodType> ? ZodShouldBeOptional<I>
    : T extends z.ZodUndefined | z.ZodNever ? true
    : T extends OptionalSchema<infer I> ? ZodShouldBeOptional<I>
    : T extends VoidSchema | NeverSchema ? true
    : T extends ObjectSchema<infer S extends SchemaShape>
        ? ([keyof S] extends [never] ? true : false)
    : T extends z.ZodObject<infer S extends Record<string, z.ZodType>>
        ? ([keyof S] extends [never] ? true : ZodAllFieldsOptional<S>)
    : false;

/** True when every field of a ZodObject shape is itself optional. */
type ZodAllFieldsOptional<S extends Record<string, z.ZodType>> =
    false extends { [K in keyof S]: S[K] extends z.ZodOptional<any> ? true : false }[keyof S] ? false : true;

/**
 * A detailed-input part converted for the envelope, preserving the source
 * schema's OWN optionality and applying positional optionality only where the
 * runtime would (all-optional / empty parts). Never double-wraps an already
 * optional schema. Never adds optionality to a required schema.
 */
export type ZodEnvelopeField<T extends AnySchema> =
    ZodShouldBeOptional<T> extends true
        ? (T extends z.ZodOptional<any> ? ZodShapeField<ZodField<T>> : z.ZodOptional<ZodShapeField<ZodField<T>>>)
        : ZodShapeField<ZodField<T>>;

/**
 * Built detailed input envelope — real Zod, empty parts OMITTED, branded.
 *
 * Each field PRESERVES the source schema's OWN optionality: a required
 * `z.custom<WebhookEvent>()` stays required (`body: WebhookEvent`); a schema
 * declared `.optional()` stays optional (`headers?: {...}`); an all-optional
 * query object stays positionally optional. We NEVER add optionality a schema
 * didn't declare.
 */
export type ZodBuiltDetailedInput<
    TParams extends AnySchema,
    TQuery extends AnySchema,
    TBody extends AnySchema,
    THeaders extends AnySchema,
> = z.ZodObject<{
    [K in "params" | "query" | "body" | "headers" as
        (ZodEnvelopeField<{ params: TParams; query: TQuery; body: TBody; headers: THeaders }[K]> extends infer FK extends AnySchema
            ? ZodIsEmptyObjectSchemaType<FK> extends true ? never : K
            : never)
    ]: ZodEnvelopeField<{ params: TParams; query: TQuery; body: TBody; headers: THeaders }[K]>;
}> & { readonly [DetailedInputBrand]: true };

/** Built detailed output envelope — real Zod, empty parts OMITTED, branded. */
export type ZodDetailedOutput<
    TStatus extends number,
    THeaders extends AnySchema,
    TBody extends AnySchema,
> = z.ZodObject<{
    status: ZodField<ReturnType<typeof import("../../types/standard-schema-helpers").literalSchema<TStatus>>>;
    body: ZodShapeField<ZodField<TBody>>;
} & (ZodIsEmptyObjectSchemaType<THeaders> extends true ? Record<never, never> : { headers: ZodShapeField<ZodField<THeaders>> })> & { readonly [DetailedOutputBrand]: true };

/** Detect detailed output structure — Zod never auto-detects from a plain schema. */
export type ZodDetectDetailedOutput<T> = T;

/** Extract the four parts from a branded detailed input envelope. */
export type ZodBrandedInputParts<TInput extends AnySchema> =
    TInput extends { readonly [DetailedInputBrand]: true }
        ? TInput extends z.ZodObject<infer Shape>
            ? {
                params: Shape extends { params: infer P extends AnySchema } ? P : ZodEmptyObject;
                query: Shape extends { query: infer Q extends AnySchema } ? Q : ZodEmptyObject;
                body: Shape extends { body: infer B extends AnySchema } ? B : ZodEmptyObject;
                headers: Shape extends { headers: infer H extends AnySchema } ? H : ZodEmptyObject;
            }
            : { params: ZodEmptyObject; query: ZodEmptyObject; body: TInput; headers: ZodEmptyObject }
        : { params: ZodEmptyObject; query: ZodEmptyObject; body: TInput; headers: ZodEmptyObject };

/** Resolved contract input — already real Zod, pass through. */
export type ZodBuildInput<TInput extends AnySchema> = TInput;

/** Resolved contract output — already real Zod, pass through. */
export type ZodBuildOutput<TOutput extends AnySchema> = TOutput;

/** Field-shape extraction from a params schema. Unwraps optional-wrapped params. */
export type ZodParamsShapeOf<TParams extends AnySchema> =
    TParams extends z.ZodOptional<infer I extends z.ZodType> ? ZodParamsShapeOf<I>
    : TParams extends z.ZodObject<infer S>
        ? { [K in keyof S]: S[K] extends AnySchema ? S[K] : AnySchema }
        : Record<never, never>;

/** Extract body schema from a detailed output envelope. */
export type ZodExtractOutputBody<T extends AnySchema> =
    T extends z.ZodObject<infer S> ? (S extends { body: infer B extends AnySchema } ? B : T) : T;

/** Extract numeric status code from a detailed output envelope. */
export type ZodExtractOutputStatus<T extends AnySchema> =
    T extends z.ZodObject<infer S> ? (S extends { status: z.ZodLiteral<infer N extends number> } ? N : 200) : 200;

/** Extract headers schema from a detailed output envelope. */
export type ZodExtractOutputHeaders<T extends AnySchema> =
    T extends z.ZodObject<infer S> ? (S extends { headers: infer H extends AnySchema } ? H : ZodEmptyObject) : ZodEmptyObject;

/** Public schema view for output consumers (200 + no headers → direct body). */
export type ZodOutputProxySchema<TData extends AnySchema> =
    TData extends z.ZodObject<infer Shape>
        ? Shape extends { status: z.ZodLiteral<infer S extends number> }
            ? S extends 200
                ? Shape extends { body: infer B extends z.ZodType }
                    ? ("headers" extends keyof Shape ? TData : B)
                    : TData
                : TData
            : TData
        : TData;

export type ZodPluginInfer = PluginInfer & {
    Field: <T extends AnySchema>(t: T) => ZodField<T>;
    Optional: <T extends AnySchema>(t: T) => ZodOptional<T>;
    ObjectSchema: <TShape extends SchemaShape>(shape: TShape) => ZodObjectSchemaOf<TShape>;
    EmptyObject: z.ZodObject<Record<never, never>>;
    Void: z.ZodUndefined;
    IsEmptyPart: <T extends AnySchema>(t: T) =>
        T extends z.ZodObject<infer S> ? ([keyof S] extends [never] ? true : false)
        : T extends z.ZodOptional<infer I extends z.ZodType> ? ZodIsEmptyObjectSchemaType<I>
        : T extends z.ZodUndefined | z.ZodNever ? true
        : false;
    IsEmptyObjectSchemaType: <T extends AnySchema>(t: T) => ZodIsEmptyObjectSchemaType<T>;
    BuiltDetailedInput: <TParams extends AnySchema, TQuery extends AnySchema, TBody extends AnySchema, THeaders extends AnySchema>(
        params: TParams, query: TQuery, body: TBody, headers: THeaders,
    ) => ZodBuiltDetailedInput<TParams, TQuery, TBody, THeaders>;
    DetailedOutput: <TStatus extends number, THeaders extends AnySchema, TBody extends AnySchema>(
        status: TStatus, headers: THeaders, body: TBody,
    ) => ZodDetailedOutput<TStatus, THeaders, TBody>;
    DetectDetailedOutput: <T extends AnySchema>(t: T) => T;
    BrandedInputParts: <TInput extends AnySchema>(input: TInput) => TInput extends { readonly [DetailedInputBrand]: true }
        ? TInput extends z.ZodObject<infer Shape>
            ? {
                params: Shape extends { params: infer P extends AnySchema } ? P : ZodEmptyObject;
                query: Shape extends { query: infer Q extends AnySchema } ? Q : ZodEmptyObject;
                body: Shape extends { body: infer B extends AnySchema } ? B : ZodEmptyObject;
                headers: Shape extends { headers: infer H extends AnySchema } ? H : ZodEmptyObject;
            }
            : { params: ZodEmptyObject; query: ZodEmptyObject; body: TInput; headers: ZodEmptyObject }
        : { params: ZodEmptyObject; query: ZodEmptyObject; body: TInput; headers: ZodEmptyObject };
    BuildInput: <TInput extends AnySchema>(input: TInput) => TInput;
    BuildOutput: <TOutput extends AnySchema>(output: TOutput) => TOutput;
    ParamsShapeOf: <TParams extends AnySchema>(params: TParams) =>
        TParams extends z.ZodObject<infer S> ? { [K in keyof S]: S[K] extends AnySchema ? S[K] : AnySchema } : Record<never, never>;
    ExtractOutputBody: <T extends AnySchema>(t: T) =>
        T extends z.ZodObject<infer S> ? (S extends { body: infer B extends AnySchema } ? B : T) : T;
    ExtractOutputStatus: <T extends AnySchema>(t: T) =>
        T extends z.ZodObject<infer S> ? (S extends { status: z.ZodLiteral<infer N extends number> } ? N : 200) : 200;
    ExtractOutputHeaders: <T extends AnySchema>(t: T) =>
        T extends z.ZodObject<infer S> ? (S extends { headers: infer H extends AnySchema } ? H : ZodEmptyObject) : ZodEmptyObject;
    OutputProxySchema: <TData extends AnySchema>(data: TData) =>
        TData extends z.ZodObject<infer Shape>
            ? Shape extends { status: z.ZodLiteral<infer S extends number> }
                ? S extends 200
                    ? Shape extends { body: infer B extends z.ZodType }
                        ? ("headers" extends keyof Shape ? TData : B)
                        : TData
                    : TData
                : TData
            : TData;
}

/** Zod empty object sentinel. */
export type ZodEmptyObject = z.ZodObject<Record<never, never>>;

export class ZodPluginTransformer extends BasePluginTransformer<z.ZodType> {
    /** Type-level schema ops namespace (see ZodPluginInfer). */
    declare readonly $Infer: ZodPluginInfer;
     
     
     
    override object<TShape extends SchemaShape>(shape: TShape): z.ZodObject<Record<keyof TShape, z.ZodType>> {
        const zodShape: Record<string, z.ZodType> = {};
        for (const [key, field] of Object.entries(shape)) {
            zodShape[key] = field as z.ZodType; // Zod mode requires Zod parts
        }
        // The index-signature result is not assignable to the mapped key shape — cast is required.
        return z.object(zodShape) as z.ZodObject<Record<keyof TShape, z.ZodType>>;
    }

    override emptyObject(): z.ZodObject<Record<never, never>> {
        return z.object({});
    }

    override voidSchema(): z.ZodUndefined {
        return z.undefined();
    }

    override neverSchema(): z.ZodNever {
        return z.never();
    }

    override literalSchema<T extends string | number | boolean>(value: T): z.ZodLiteral<T> {
        return z.literal(value);
    }

    override optional<T extends AnySchema>(schema: T): z.ZodType {
        return z.optional(schema as unknown as z.ZodType);
    }

    override union<T extends readonly [AnySchema, AnySchema, ...AnySchema[]]>(options: T) {
        return z.union(options as unknown as readonly [z.ZodType, z.ZodType, ...z.ZodType[]]);
    }

    override getShape(schema: AnySchema): SchemaShape | null {
        const def = (schema as { _zod?: { def?: { type?: string; shape?: Record<string, unknown> } } })._zod?.def;
        if (def?.type === "object" && typeof def.shape === "object") {
            const out: SchemaShape = {};
            for (const [key, value] of Object.entries(def.shape)) out[key] = value as AnySchema;
            return out;
        }
        return null;
    }

    override isOptional(schema: AnySchema): boolean {
        const s = schema as { isOptional?: () => boolean };
        return typeof s.isOptional === "function" && s.isOptional();
    }

    override unwrapOptional(schema: AnySchema): AnySchema {
        const def = (schema as { _zod?: { def?: { type?: string; innerType?: AnySchema } } })._zod?.def;
        if (def?.type === "optional" && def.innerType) return def.innerType;
        return schema;
    }

    override isEmpty(schema: AnySchema): boolean {
        const unwrapped = this.isOptional(schema) ? this.unwrapOptional(schema) : schema;
        const def = (unwrapped as { _zod?: { def?: { type?: string } } })._zod?.def?.type;
        if (def === "undefined" || def === "never") return true;
        const shape = this.getShape(unwrapped);
        return shape !== null && Object.keys(shape).length === 0;
    }

    override getLiteralValue(schema: AnySchema): string | number | boolean | null {
        const def = (schema as { _zod?: { def?: { type?: string; values?: readonly (string | number | boolean)[] } } })._zod?.def;
        if (def?.type === "literal" && def.values && def.values.length > 0) return def.values[0] ?? null;
        return null;
    }

    override omitEmptyParts(): boolean {
        return true;
    }

    override producesZod(): boolean {
        return true;
    }
}
