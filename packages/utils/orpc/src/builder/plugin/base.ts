/**
 * Schema transformer plugin — the single injection point for how the builder
 * CONSTRUCTS and INTROSPECTS schemas.
 *
 * Every place the builder previously called the hard-coded Standard Schema
 * factories (`objectSchema()`, `optionalSchema()`, `literalSchema()`,
 * `emptyObjectSchema()`, `voidSchema()`, `neverSchema()`, `unionSchema()`) —
 * and every place it introspected via `getSchemaShape()` / `isOptionalSchema()`
 * / `isObjectSchema()` / `isVoidSchema()` — now goes through this interface.
 *
 * The default implementation is `StandardPluginTransformer` (today's behavior).
 * Opting into `ZodPluginTransformer` makes every schema the builder creates a
 * REAL Zod schema from the start, so `InferInputSchema<contract>` / `z.infer`
 * work without any build()-time conversion.
 *
 * The plugin class is BOTH the runtime factory AND the type-level key: the
 * builder carries `TPlugin extends BasePluginTransformer` in its generics and
 * conditional types keyed on the plugin class map our marker types
 * (`ObjectSchema` / `OptionalSchema` / `LiteralSchema` / `VoidSchema` ...) to
 * the plugin's native equivalents (`z.ZodObject` / `z.ZodOptional` ...).
 */

 
import type { AnySchema } from "../../types/types";
import type { SchemaShape } from "../../types/standard-schema-helpers";
import type { ZodPluginTransformer } from "./zod";

/**
 * Type-level schema ops contract. Every plugin namespaces its type-level
 * schema operations under `$Infer` so the core can dispatch through the
 * plugin generic WITHOUT branching on the plugin's identity.
 *
 * Adding a new validation library = implement this interface in the new
 * plugin's `$Infer` member. The core only ever calls `PluginOp<TP, ...>`.
 */
export type PluginInfer = {
    /** Map a part schema to the plugin's native equivalent. */
    Field: <T extends AnySchema>(t: T) => unknown;
    /** Optional wrapper type produced by the plugin. */
    Optional: <T extends AnySchema>(t: T) => unknown;
    /** Object schema type produced by the plugin for a shape. */
    ObjectSchema: <TShape extends SchemaShape>(shape: TShape) => unknown;
    /** Empty object sentinel type produced by the plugin. */
    EmptyObject: unknown;
    /** Void sentinel type produced by the plugin. */
    Void: unknown;
    /** True when a part is an empty sentinel (used to omit keys). */
    IsEmptyPart: <T extends AnySchema>(t: T) => unknown;
    /** Empty-object detection for direct-body collapse. */
    IsEmptyObjectSchemaType: <T extends AnySchema>(t: T) => unknown;
    /** Built detailed input envelope (branded). */
    BuiltDetailedInput: <TParams extends AnySchema, TQuery extends AnySchema, TBody extends AnySchema, THeaders extends AnySchema>(
        params: TParams, query: TQuery, body: TBody, headers: THeaders,
    ) => unknown;
    /** Built detailed output envelope (branded). */
    DetailedOutput: <TStatus extends number, THeaders extends AnySchema, TBody extends AnySchema>(
        status: TStatus, headers: THeaders, body: TBody,
    ) => unknown;
    /** Detect detailed output structure from a plain schema. */
    DetectDetailedOutput: <T extends AnySchema>(t: T) => unknown;
    /** Extract the four parts from a detailed input envelope. */
    BrandedInputParts: <TInput extends AnySchema>(input: TInput) => unknown;
    /** Resolved contract input type. */
    BuildInput: <TInput extends AnySchema>(input: TInput) => unknown;
    /** Resolved contract output type. */
    BuildOutput: <TOutput extends AnySchema>(output: TOutput) => unknown;
    /** Field-shape extraction from a params schema. */
    ParamsShapeOf: <TParams extends AnySchema>(params: TParams) => unknown;
    /** Extract body schema from a detailed output envelope. */
    ExtractOutputBody: <T extends AnySchema>(t: T) => unknown;
    /** Extract numeric status code from a detailed output envelope. */
    ExtractOutputStatus: <T extends AnySchema>(t: T) => unknown;
    /** Extract headers schema from a detailed output envelope. */
    ExtractOutputHeaders: <T extends AnySchema>(t: T) => unknown;
    /** Public schema view for output consumers (200/no-headers → body). */
    OutputProxySchema: <TData extends AnySchema>(data: TData) => unknown;
}

/**
 * Extract the `$Infer` namespace from a plugin class (eager for concrete classes).
 */
export type InferOf<P> = P extends { readonly $Infer: infer N } ? N : never;

/** Whether the plugin produces Zod schemas (deferred ternary key). */
export type IsPluginZod<P> = P extends ZodPluginTransformer ? true : false;

/**
 * The per-plugin TYPE-OP DISPATCH lives in `./types` (`PluginField`, ...):
 * each plugin owns its concrete schema-type aliases (`Std*` / `Zod*`) in its
 * own module, and the dispatch branches on `IsPluginZod` to apply the right
 * one. Core code never inlines plugin logic and never uses `infer` on generic
 * function types (TypeScript has no higher-kinded types — `infer` on a generic
 * fn always resolves to the op's constraint, which collapses Zod to `AnySchema`).
 *
 * The `PluginInfer` interface below is the DOCUMENTED contract each plugin's
 * `$Infer` satisfies; the `$Infer` phantom member makes the namespace reachable
 * as `PluginTransformer.$Infer` for concrete classes.
 */

export abstract class BasePluginTransformer<TSchema extends AnySchema = AnySchema> {
    /** Phantom — the object-schema type this plugin produces (type-level only). */
    declare readonly schema: TSchema;



    // ---- construction ------------------------------------------------------
    
    static create<T extends BasePluginTransformer>(
        this: new () => T
    ): T {
        return new this();
    }

    /** Object envelope: `objectSchema(shape)` / `z.object(shape)`. */
    abstract object<TShape extends SchemaShape>(shape: TShape): TSchema;

    /** Empty object sentinel (unset params/query/headers). */
    abstract emptyObject(): TSchema;

    /** Void sentinel (no input/output value) — not an object schema. */
    abstract voidSchema(): AnySchema;

    /** Never sentinel (impossible value) — not an object schema. */
    abstract neverSchema(): AnySchema;

    /** Literal — output status codes. */
    abstract literalSchema<T extends string | number | boolean>(value: T): AnySchema;

    /** Optional wrapper — field accepts undefined. */
    abstract optional<T extends AnySchema>(schema: T): AnySchema;

    /** Union wrapper — multiple input/output variants. */
    abstract union<T extends readonly [AnySchema, AnySchema, ...AnySchema[]]>(options: T): AnySchema;

    // ---- introspection (re-chaining, direct-body detection) ----------------

    /** Field shape of an object schema, or null if not an object. */
    abstract getShape(schema: AnySchema): SchemaShape | null;

    /** True if the schema accepts undefined (optional). */
    abstract isOptional(schema: AnySchema): boolean;

    /** Inner schema of an optional (identity if not optional). */
    abstract unwrapOptional(schema: AnySchema): AnySchema;

    /** True if the schema represents "no fields" / void / never. */
    abstract isEmpty(schema: AnySchema): boolean;

    /** Literal value if literal, else null. */
    abstract getLiteralValue(schema: AnySchema): string | number | boolean | null;

    /**
     * Whether object envelopes should OMIT empty (void-like) fields.
     * Standard: false (keeps `{ params, query, body, headers }` — today's shape).
     * Zod:     true  (emits `{ body, headers }` — clean `z.infer`).
     */
    abstract omitEmptyParts(): boolean;

    /**
     * Whether this plugin produces native Zod schemas (affects how the built
     * contract is handed to ORPC: Zod passes through, Standard strips brands).
     */
    abstract producesZod(): boolean;
}
