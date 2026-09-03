/* eslint-disable @typescript-eslint/no-explicit-any -- the plugin generic requires `any` to represent "any schema plugin" and impl signatures of overloaded fluent methods widen to `any` to satisfy tsgo's overload-compat check */
/**
 * Input builders for route-builder-v2
 * Handles detailed input structure: { params, query, body, headers }
 *
 * Schema construction is INJECTED through a plugin (default: Standard Schema,
 * opt-in: Zod) — the builder never calls the schema factories directly.
 */

import type { AnySchema, UnionTuple } from "../../types/types";
import type { ObjectSchema, VoidSchema, SchemaShape } from "../../types/standard-schema-helpers";
import { AsyncIteratorClass, eventIterator } from "@orpc/contract";
import type { Schema } from "@orpc/contract";
import { observable, type Observable } from "../../observable/contract";
import type { PathParam, PathParamBuilderWithExisting, ParamsToSchemaShape } from "../core/params-builder";
import { createPathParamBuilder } from "../core/params-builder";
import { ProxyBuilderBase } from "../core/proxy-builder.base";
import { s } from "../../operations/base/schema";
import { isRecord } from "@repo/type-guards"
import {
    BasePluginTransformer,
    StandardPluginTransformer,
    type PluginObjectSchema,
    type PluginEmptyObject,
    type PluginVoid,
    type PluginBuiltDetailedInput,
    type PluginIsEmptyObjectSchemaType,
    type PluginParamsShapeOf,
} from "../plugin";
import { DetailedInputBrand } from "../core/route-builder";

/**
 * Query builder - exposes current query schema and entity schema for direct chaining
 */
export class QueryBuilder<TQuery extends AnySchema, TParams extends AnySchema, TBody extends AnySchema, THeaders extends AnySchema, TEntitySchema extends AnySchema, TPlugin extends BasePluginTransformer = StandardPluginTransformer> {
    constructor(
        private _parent: DetailedInputBuilder<TParams, TQuery, TBody, THeaders, TEntitySchema, TPlugin>,
        private _schema: TQuery,
        private _entitySchema: TEntitySchema,
    ) {}

    /** Current query schema — chain Zod methods directly: `q.schema.extend({ ... })` */
    get schema(): TQuery {
        return this._schema;
    }

    /** Entity schema — use as the basis for the query: `q.entitySchema.pick([...])` */
    get entitySchema(): TEntitySchema {
        return this._entitySchema;
    }
}

/**
 * Params builder - exposes current params schema and entity schema for direct chaining
 */
export class ParamsBuilder<TParams extends AnySchema, TQuery extends AnySchema, TBody extends AnySchema, THeaders extends AnySchema, TEntitySchema extends AnySchema, TPlugin extends BasePluginTransformer = StandardPluginTransformer> {
    constructor(
        private _parent: DetailedInputBuilder<TParams, TQuery, TBody, THeaders, TEntitySchema, TPlugin>,
        private _schema: TParams,
        private _entitySchema: TEntitySchema,
    ) {}

    /** Current params schema — chain methods directly: `p.schema.extend({ ... })` */
    get schema(): TParams {
        return this._schema;
    }

    /** Entity schema */
    get entitySchema(): TEntitySchema {
        return this._entitySchema;
    }
}

/**
 * Body builder - exposes current body schema and entity schema for direct chaining
 */
export class BodyBuilder<TBody extends AnySchema, TParams extends AnySchema, TQuery extends AnySchema, THeaders extends AnySchema, TEntitySchema extends AnySchema, TPlugin extends BasePluginTransformer = StandardPluginTransformer> {
    constructor(
        private _parent: DetailedInputBuilder<TParams, TQuery, TBody, THeaders, TEntitySchema, TPlugin>,
        private _schema: TBody,
        private _entitySchema: TEntitySchema,
    ) {}

    /** Current body schema — chain Zod methods directly: `b.schema.extend({ ... })` */
    get schema(): TBody {
        return this._schema;
    }

    /** Entity schema — use as the basis for the body: `b.entitySchema.omit({ id: true })` */
    get entitySchema(): TEntitySchema {
        return this._entitySchema;
    }
}

/**
 * Headers builder - exposes current headers schema and entity schema for direct chaining
 */
export class HeadersBuilder<THeaders extends AnySchema, TParams extends AnySchema, TQuery extends AnySchema, TBody extends AnySchema, TEntitySchema extends AnySchema, TPlugin extends BasePluginTransformer = StandardPluginTransformer> {
    constructor(
        private _parent: DetailedInputBuilder<TParams, TQuery, TBody, THeaders, TEntitySchema, TPlugin>,
        private _schema: THeaders,
        private _entitySchema: TEntitySchema,
    ) {}

    /** Current headers schema — chain methods directly: `h.schema.extend({ ... })` */
    get schema(): THeaders {
        return this._schema;
    }

    /** Entity schema */
    get entitySchema(): TEntitySchema {
        return this._entitySchema;
    }
}

/**
 * Built detailed input schema.
 * - Standard mode: `ObjectSchema<{ params, query, body, headers }>` (all four keys, today).
 * - Zod mode: real `z.ZodObject` — empty (void-like) parts are OMITTED so
 *   `z.infer` gives `{ body, headers? }` instead of `{ params?: never, ... }`.
 *
 * BOTH branches carry the DetailedInputBrand symbol at the TYPE level so
 * re-chaining (a second `.input()` call) can reliably detect a detailed
 * envelope — a plain schema that happens to have a `query`/`body` field must
 * NOT be split into detailed parts.
 */
type BuiltDetailedInputSchema<TP extends BasePluginTransformer, TParams extends AnySchema, TQuery extends AnySchema, TBody extends AnySchema, THeaders extends AnySchema> =
    PluginBuiltDetailedInput<TP, TParams, TQuery, TBody, THeaders>;

type IsEmptyObjectSchemaType<TP extends BasePluginTransformer, T extends AnySchema> = PluginIsEmptyObjectSchemaType<TP, T>;

export type DetailedInputBuilderSchema<TP extends BasePluginTransformer, TParams extends AnySchema, TQuery extends AnySchema, TBody extends AnySchema, THeaders extends AnySchema> =
    IsEmptyObjectSchemaType<TP, TParams> extends true
        ? IsEmptyObjectSchemaType<TP, TQuery> extends true
            ? IsEmptyObjectSchemaType<TP, THeaders> extends true
                ? TBody
                : BuiltDetailedInputSchema<TP, TParams, TQuery, TBody, THeaders>
            : BuiltDetailedInputSchema<TP, TParams, TQuery, TBody, THeaders>
        : BuiltDetailedInputSchema<TP, TParams, TQuery, TBody, THeaders>;

/**
 * Extract the field-shape type from a params schema (plugin-aware).
 * Standard mode: our custom ObjectSchema. Zod mode: z.ZodObject.
 * Falls back to an empty shape when the params schema is neither.
 */
type ParamsShapeOf<TP extends BasePluginTransformer, TParams extends AnySchema> = PluginParamsShapeOf<TP, TParams>;

/**
 * Detailed input builder that handles input structure as:
 * { params, query, body, headers }
 *
 * Each field has its own builder that exposes the schema for direct manipulation.
 * Schema construction is injected through `TPlugin` (default StandardPluginTransformer).
 *
 * @example
 * ```typescript
 * inputBuilder(builder => builder
 *   .body(entitySchema)
 *   .query(q => q.schema(s => extendSchema(s, { limit: numberSchema })))
 *   .params(p => p.schema(s => extendSchema(s, { userId: stringSchema })))
 * )
 * ```
 */
export class DetailedInputBuilder<
    TParams extends AnySchema = VoidSchema,
    TQuery extends AnySchema = VoidSchema,
    TBody extends AnySchema = VoidSchema,
    THeaders extends AnySchema = VoidSchema,
    TEntitySchema extends AnySchema = VoidSchema,
    TPlugin extends BasePluginTransformer = StandardPluginTransformer,
> extends ProxyBuilderBase<DetailedInputBuilderSchema<TPlugin, TParams, TQuery, TBody, THeaders>> {
    public readonly $params: TParams;
    public readonly $query: TQuery;
    public readonly $body: TBody;
    public readonly $headers: THeaders;
    public readonly $entitySchema: TEntitySchema;
    /** @internal Path to be applied by RouteBuilder when using template literal params */
    public _pendingPath?: string;
    /** @internal Schema transformer plugin — drives ALL schema construction. */
    protected readonly _plugin: TPlugin;

    constructor(
        params: TParams,
        query: TQuery,
        body: TBody,
        headers: THeaders,
        entitySchema?: TEntitySchema,
        pendingPath?: string,
        plugin?: TPlugin,
    ) {
        super();
        this._plugin = plugin ?? (new StandardPluginTransformer() as unknown as TPlugin);
        this.$params = params;
        this.$query = query;
        this.$body = body;
        this.$headers = headers;
        this.$entitySchema = (entitySchema ?? this._plugin.voidSchema()) as TEntitySchema;
        this._pendingPath = pendingPath;
    }

    /**
     * Returns either:
     * - direct body schema (when params/query/headers are still empty defaults), or
     * - detailed object schema with params/query/body/headers.
     */
    get schema(): DetailedInputBuilderSchema<TPlugin, TParams, TQuery, TBody, THeaders> {
        if (this._isDirectBodySchemaMode()) {
            return this.$body as unknown as DetailedInputBuilderSchema<TPlugin, TParams, TQuery, TBody, THeaders>;
        }
        return this._build() as unknown as DetailedInputBuilderSchema<TPlugin, TParams, TQuery, TBody, THeaders>;
    }

    private _isDirectBodySchemaMode(): boolean {
        return this._plugin.isEmpty(this.$params) && this._plugin.isEmpty(this.$query) && this._plugin.isEmpty(this.$headers);
    }

    /**
     * Access to the entity schema for use in body modifications
     */
    get entitySchema(): TEntitySchema {
        return this.$entitySchema;
    }

    /**
     * Access the raw body schema being built
     * Useful for builder pattern to return the body schema directly without detailed wrapping
     *
     * @example
     * ```typescript
     * .input(b => b.body(userSchema).raw)
     * // Returns the body schema directly without wrapping in detailed structure
     * ```
     */
    get raw(): TBody {
        return this.$body;
    }

    /**
     * Body accessor that supports both callable and property access patterns
     *
     * Usage patterns:
     * 1. Direct schema: `.body(schema)`
     * 2. Builder callback: `.body(b => b.schema(s => s ...))`
     * 3. Streamed: `.body.streamed(schema)` - wraps schema in EventIterator for streaming
     * 4. Observable: `.body.observable(schema)` - wraps schema in Observable contract typing
     *
     * @example
     * ```typescript
     * // Direct schema
     * .body(userSchema)
     *
     * // Builder callback
     * .body(b => b.schema(s => transformSchema(s)))
     *
     * // Streamed body
     * .body.streamed(chunkSchema)
     * ```
     */
    get body() {
        // Create callable that handles both schema and builder callback
        type BodyCallable = {
            <TNewBody extends AnySchema>(
                factory: (b: BodyBuilder<TBody, TParams, TQuery, THeaders, TEntitySchema, TPlugin>) => TNewBody,
            ): DetailedInputBuilder<TParams, TQuery, TNewBody, THeaders, TEntitySchema, TPlugin>;
            <TNewBody extends AnySchema>(schema: TNewBody): DetailedInputBuilder<TParams, TQuery, TNewBody, THeaders, TEntitySchema, TPlugin>;
            streamed: <TYieldIn, TYieldOut, TReturnIn = unknown, TReturnOut = unknown>(
                yields: Schema<TYieldIn, TYieldOut>,
                returns?: Schema<TReturnIn, TReturnOut>,
            ) => DetailedInputBuilder<TParams, TQuery, Schema<AsyncIteratorObject<TYieldIn, TReturnIn, void>, AsyncIteratorClass<TYieldOut, TReturnOut, void>>, THeaders, TEntitySchema, TPlugin>;
            observable: <TYieldIn, TYieldOut>(
                yields: Schema<TYieldIn, TYieldOut>,
            ) => DetailedInputBuilder<TParams, TQuery, Schema<Observable<TYieldIn>, Observable<TYieldOut>>, THeaders, TEntitySchema, TPlugin>;
        };

        const callable = (<TNewBody extends AnySchema>(
            schemaOrFactory: TNewBody | ((b: BodyBuilder<TBody, TParams, TQuery, THeaders, TEntitySchema, TPlugin>) => TNewBody),
        ): DetailedInputBuilder<TParams, TQuery, TNewBody, THeaders, TEntitySchema, TPlugin> => {
            if (typeof schemaOrFactory === "function") {
                const newSchema = schemaOrFactory(new BodyBuilder(this, this.$body, this.$entitySchema));
                return new DetailedInputBuilder(this.$params, this.$query, newSchema, this.$headers, this.$entitySchema, this._pendingPath, this._plugin);
            }
            return new DetailedInputBuilder(this.$params, this.$query, schemaOrFactory, this.$headers, this.$entitySchema, this._pendingPath, this._plugin);
        }) as BodyCallable;

        // Add streamed method
        callable.streamed = <TYieldIn, TYieldOut, TReturnIn = unknown, TReturnOut = unknown>(yields: Schema<TYieldIn, TYieldOut>, returns?: Schema<TReturnIn, TReturnOut>) => {
            const streamedSchema = eventIterator(yields, returns);
            return new DetailedInputBuilder(this.$params, this.$query, streamedSchema, this.$headers, this.$entitySchema, this._pendingPath, this._plugin);
        };

        callable.observable = <TYieldIn, TYieldOut>(yields: Schema<TYieldIn, TYieldOut>) => {
            const observableSchema = observable(yields);
            return new DetailedInputBuilder(this.$params, this.$query, observableSchema, this.$headers, this.$entitySchema, this._pendingPath, this._plugin);
        };

        return callable;
    }

    /**
     * Query accessor - supports both direct schema and builder callback
     *
     * @example
     * ```typescript
     * // Direct schema
     * .query(querySchema)
     *
     * // Builder callback
     * .query(q => q.schema(s => extendSchema(s, { limit: numberSchema })))
     * ```
     */
    query<TNewQuery extends AnySchema>(
        factory: (q: QueryBuilder<TQuery, TParams, TBody, THeaders, TEntitySchema, TPlugin>) => TNewQuery,
    ): DetailedInputBuilder<TParams, TNewQuery, TBody, THeaders, TEntitySchema, TPlugin>;
    query<TNewQuery extends AnySchema>(schema: TNewQuery): DetailedInputBuilder<TParams, TNewQuery, TBody, THeaders, TEntitySchema, TPlugin>;
    query<TNewQuery extends AnySchema>(
        schemaOrFactory: TNewQuery | ((q: QueryBuilder<TQuery, TParams, TBody, THeaders, TEntitySchema, TPlugin>) => TNewQuery),
    ): DetailedInputBuilder<TParams, TNewQuery, TBody, THeaders, TEntitySchema, TPlugin> {
        if (typeof schemaOrFactory === "function") {
            const newSchema = schemaOrFactory(new QueryBuilder(this, this.$query, this.$entitySchema));
            return new DetailedInputBuilder(this.$params, newSchema, this.$body, this.$headers, this.$entitySchema, this._pendingPath, this._plugin);
        }
        return new DetailedInputBuilder(this.$params, schemaOrFactory, this.$body, this.$headers, this.$entitySchema, this._pendingPath, this._plugin);
    }

    /**
     * Params accessor - supports template literals, existing param references, and direct schema
     *
     * **Usage Patterns:**
     *
     * ### 1. Template literal with inline param definition
     * Define new params directly in the template using `p('name', schema)`:
     * ```typescript
     * .params(p => p`/orgs/${p('orgId', z.uuid())}/users`)
     * ```
     *
     * ### 2. Object definition + template literal
     * Define params in an object first, then reference them in template:
     * ```typescript
     * .params({ orgId: z.uuid() }, p => p`/orgs/${p.orgId}/users`)
     * ```
     *
     * ### 3. Direct schema
     * ```typescript
     * .params(paramsSchema)
     * ```
     *
     * ### 4. Builder callback
     * ```typescript
     * .params(p => p.schema(s => extendSchema(s, { userId: stringSchema })))
     * ```
     */
    // Overload 1: Template literal callback - access existing params
    params<
        TNewParams extends readonly PathParam[],
        TNewParamsShape extends SchemaShape = ParamsToSchemaShape<TNewParams>,
        TCurrentShape extends Record<string, AnySchema> = ParamsShapeOf<TPlugin, TParams>,
    >(
        templateFn: (p: PathParamBuilderWithExisting<TCurrentShape>) => { template: string; params: TNewParams },
    ): DetailedInputBuilder<
        PluginObjectSchema<TPlugin, {
            [K in keyof TCurrentShape | keyof TNewParamsShape]: K extends keyof TNewParamsShape ? TNewParamsShape[K] : K extends keyof TCurrentShape ? TCurrentShape[K] : never;
        }>,
        TQuery,
        TBody,
        THeaders,
        TEntitySchema,
        TPlugin
    >;

    // Overload 2: Object definition + template literal
    params<
        TNewParamsDef extends SchemaShape,
        TCurrentShape extends Record<string, AnySchema> = ParamsShapeOf<TPlugin, TParams>,
        TCombinedShape extends Record<string, AnySchema> = {
            [K in keyof TCurrentShape | keyof TNewParamsDef]: K extends keyof TNewParamsDef ? TNewParamsDef[K] : K extends keyof TCurrentShape ? TCurrentShape[K] : never;
        },
    >(
        newParams: TNewParamsDef,
        templateFn: (p: PathParamBuilderWithExisting<TCombinedShape>) => { template: string },
    ): DetailedInputBuilder<PluginObjectSchema<TPlugin, TCombinedShape>, TQuery, TBody, THeaders, TEntitySchema, TPlugin>;

    // Overload 3: Builder callback
    params<TNewParams extends AnySchema>(
        builder: (p: ParamsBuilder<TParams, TQuery, TBody, THeaders, TEntitySchema, TPlugin>) => DetailedInputBuilder<TNewParams, TQuery, TBody, THeaders, TEntitySchema, TPlugin>,
    ): DetailedInputBuilder<TNewParams, TQuery, TBody, THeaders, TEntitySchema, TPlugin>;

    // Overload 4: Direct schema
    params<TNewParams extends AnySchema>(schema: TNewParams): DetailedInputBuilder<TNewParams, TQuery, TBody, THeaders, TEntitySchema, TPlugin>;

    // Overload 5: Object-only (add/override param types without changing path)
    params<
        TNewParamsDef extends SchemaShape,
        TCurrentShape extends Record<string, AnySchema> = ParamsShapeOf<TPlugin, TParams>,
        TMergedShape extends Record<string, AnySchema> = {
            [K in keyof TCurrentShape | keyof TNewParamsDef]: K extends keyof TNewParamsDef ? TNewParamsDef[K] : K extends keyof TCurrentShape ? TCurrentShape[K] : never;
        },
    >(newParams: TNewParamsDef): DetailedInputBuilder<PluginObjectSchema<TPlugin, TMergedShape>, TQuery, TBody, THeaders, TEntitySchema, TPlugin>;

    // Implementation (no generics - rely on runtime shape + type assertion)
    params(paramsOrModifier: unknown, templateFnIfNewParams?: unknown): DetailedInputBuilder<any, TQuery, TBody, THeaders, TEntitySchema, TPlugin> {
        type TemplateResult = { template: string; params: readonly PathParam[] };
        type TemplateFn = (builder: PathParamBuilderWithExisting<SchemaShape>) => TemplateResult;
        const isTemplateFn = (value: unknown): value is TemplateFn => typeof value === "function";

        // Extract existing params shape at runtime (plugin-aware introspection)
        const existingParamsShape = this._plugin.getShape(this.$params) ?? {};

        // Overload 2: Object + template function
        if (typeof paramsOrModifier === "object" && paramsOrModifier !== null && !("~standard" in paramsOrModifier) && isTemplateFn(templateFnIfNewParams)) {
            const newParamsDef = paramsOrModifier as SchemaShape;

            // Combine existing params with new definitions for the builder
            const combinedForBuilder = { ...existingParamsShape, ...newParamsDef };

            // Create path param builder with combined params
            const builder = createPathParamBuilder(combinedForBuilder);
            const result = templateFnIfNewParams(builder);

            // Build new params shape from template result
            const newParamsShape = result.params.reduce<Record<string, AnySchema>>((acc, param) => {
                acc[param.name] = param.schema;
                return acc;
            }, {});

            // Final shape: existing + new definitions + template params
            const finalShape = { ...existingParamsShape, ...newParamsDef, ...newParamsShape };
            const paramsSchema = this._plugin.object(finalShape);

            // Trust overload signature for type inference
            return new DetailedInputBuilder(paramsSchema, this.$query, this.$body, this.$headers, this.$entitySchema, result.template, this._plugin);
        }

        // Overload 1: Template literal callback function
        if (typeof paramsOrModifier === "function") {
            // Check if result is a template result (has 'template' and 'params')
            const builder = createPathParamBuilder(existingParamsShape);
            const callbackFn = paramsOrModifier as (builder: PathParamBuilderWithExisting<SchemaShape>) => TemplateResult | DetailedInputBuilder<AnySchema, TQuery, TBody, THeaders, TEntitySchema, TPlugin>;
            const result = callbackFn(builder);

            // If result has template and params, it's a template literal usage
            if ("template" in result && "params" in result) {
                const templateResult = result;

                // Build new params shape from template result
                const newParamsShape = templateResult.params.reduce<Record<string, AnySchema>>((acc, param) => {
                    acc[param.name] = param.schema;
                    return acc;
                }, {});

                // Merge existing params with new params
                const combinedShape = { ...existingParamsShape, ...newParamsShape };
                const paramsSchema = this._plugin.object(combinedShape);

                // Trust overload signature for type inference
                return new DetailedInputBuilder(paramsSchema, this.$query, this.$body, this.$headers, this.$entitySchema, templateResult.template, this._plugin);
            }

            // Otherwise it's a builder callback that returns DetailedInputBuilder
            return result;
        }

        // Overload 3: Object-only (add/override param types without changing path)
        // Check if first arg is object without ~standard property and no second arg
        if (typeof paramsOrModifier === "object" && paramsOrModifier !== null && !("~standard" in paramsOrModifier) && !templateFnIfNewParams) {
            const overrides = paramsOrModifier as Record<string, AnySchema>;

            // Merge with existing params
            const finalShape = { ...existingParamsShape, ...overrides };
            const paramsSchema = this._plugin.object(finalShape);

            // Trust overload signature for type inference
            return new DetailedInputBuilder(paramsSchema, this.$query, this.$body, this.$headers, this.$entitySchema, this._pendingPath, this._plugin);
        }

        // Fallback: Direct schema
        return new DetailedInputBuilder(paramsOrModifier as AnySchema, this.$query, this.$body, this.$headers, this.$entitySchema, this._pendingPath, this._plugin);
    }

    /**
     * Headers accessor - supports direct schema, builder callback, and raw shape
     *
     * @example
     * ```typescript
     * // Direct schema
     * .headers(headersSchema)
     *
     * // Builder callback
     * .headers(h => h.schema(s => extendSchema(s, { 'x-api-key': stringSchema })))
     *
     * // Raw shape (object with schema values)
     * .headers({ 'if-match': z.string() })
     * ```
     */
    headers<TNewHeaders extends AnySchema>(
        factory: (h: HeadersBuilder<THeaders, TParams, TQuery, TBody, TEntitySchema, TPlugin>) => TNewHeaders,
    ): DetailedInputBuilder<TParams, TQuery, TBody, TNewHeaders, TEntitySchema, TPlugin>;
    headers<TNewHeaders extends AnySchema>(schema: TNewHeaders): DetailedInputBuilder<TParams, TQuery, TBody, TNewHeaders, TEntitySchema, TPlugin>;
    headers<TNewShape extends SchemaShape>(shape: TNewShape): DetailedInputBuilder<TParams, TQuery, TBody, ObjectSchema<TNewShape>, TEntitySchema, TPlugin>;
    headers(schemaOrFactoryOrShape: unknown): DetailedInputBuilder<TParams, TQuery, TBody, any, TEntitySchema, TPlugin> {
        if (typeof schemaOrFactoryOrShape === "function") {
            // Schema factory callback
            const factoryFn = schemaOrFactoryOrShape as (h: HeadersBuilder<THeaders, TParams, TQuery, TBody, TEntitySchema, TPlugin>) => AnySchema;
            const newSchema = factoryFn(new HeadersBuilder(this, this.$headers, this.$entitySchema));
            return new DetailedInputBuilder(this.$params, this.$query, this.$body, newSchema, this.$entitySchema, this._pendingPath, this._plugin);
        }

        // Check if it's a raw shape (object without ~standard property)
        if (typeof schemaOrFactoryOrShape === "object" && schemaOrFactoryOrShape !== null && !("~standard" in schemaOrFactoryOrShape)) {
            const schema = s.object(schemaOrFactoryOrShape as SchemaShape) as AnySchema;
            return new DetailedInputBuilder(this.$params, this.$query, this.$body, schema, this.$entitySchema, this._pendingPath, this._plugin);
        }

        // Direct schema
        return new DetailedInputBuilder(this.$params, this.$query, this.$body, schemaOrFactoryOrShape as AnySchema, this.$entitySchema, this._pendingPath, this._plugin);
    }

    /**
     * Apply custom modification to entity schema
     */
    custom<TNewEntitySchema extends AnySchema>(modifier: (schema: TEntitySchema) => TNewEntitySchema): DetailedInputBuilder<TParams, TQuery, TBody, THeaders, TNewEntitySchema, TPlugin> {
        const newSchema = modifier(this.$entitySchema);
        return new DetailedInputBuilder(this.$params, this.$query, this.$body, this.$headers, newSchema, this._pendingPath, this._plugin);
    }

    /**
     * Omit fields from the current body schema (or entity schema when body is not object-like).
     */
    omit(fields: readonly string[]): DetailedInputBuilder<TParams, TQuery, AnySchema, THeaders, TEntitySchema, TPlugin> {
        const target = this._resolveObjectSchemaTarget();
        if (!("omit" in target) || typeof target.omit !== "function") {
            throw new Error("omit() can only be called on object schemas");
        }

        const omitRecord = Object.fromEntries(fields.map((field) => [field, true])) as Record<string, true>;
        const schema = (target as { omit: (shape: Record<string, true>) => AnySchema }).omit(omitRecord);
        return new DetailedInputBuilder(this.$params, this.$query, schema, this.$headers, this.$entitySchema, this._pendingPath, this._plugin);
    }

    /**
     * Pick fields from the current body schema (or entity schema when body is not object-like).
     */
    pick(fields: readonly string[]): DetailedInputBuilder<TParams, TQuery, AnySchema, THeaders, TEntitySchema, TPlugin> {
        const target = this._resolveObjectSchemaTarget();
        if (!("pick" in target) || typeof target.pick !== "function") {
            throw new Error("pick() can only be called on object schemas");
        }

        const pickRecord = Object.fromEntries(fields.map((field) => [field, true])) as Record<string, true>;
        const schema = (target as { pick: (shape: Record<string, true>) => AnySchema }).pick(pickRecord);
        return new DetailedInputBuilder(this.$params, this.$query, schema, this.$headers, this.$entitySchema, this._pendingPath, this._plugin);
    }

    /**
     * Make all or selected fields optional on the current body schema.
     */
    partial(fields?: readonly string[]): DetailedInputBuilder<TParams, TQuery, AnySchema, THeaders, TEntitySchema, TPlugin> {
        const target = this._resolveObjectSchemaTarget();
        if (!("partial" in target) || typeof target.partial !== "function") {
            throw new Error("partial() can only be called on object schemas");
        }

        const schema = (target as { partial: (shape?: readonly string[]) => AnySchema }).partial(fields);
        return new DetailedInputBuilder(this.$params, this.$query, schema, this.$headers, this.$entitySchema, this._pendingPath, this._plugin);
    }

    /**
     * Extend the current body schema with additional fields.
     */
    extend(shape: Record<string, unknown>): DetailedInputBuilder<TParams, TQuery, AnySchema, THeaders, TEntitySchema, TPlugin> {
        const target = this._resolveObjectSchemaTarget();
        if (!("extend" in target) || typeof target.extend !== "function") {
            throw new Error("extend() can only be called on object schemas");
        }

        const schema = (target as { extend: (shape: Record<string, unknown>) => AnySchema }).extend(shape);
        return new DetailedInputBuilder(this.$params, this.$query, schema, this.$headers, this.$entitySchema, this._pendingPath, this._plugin);
    }

    /**
     * Build an input union from raw schemas and/or input builders.
     *
     * Mirrors output-side `.union([...])` ergonomics:
     * - accepts both plain schemas and builder instances
     * - supports edge case with a single variant
     * - preserves a shared pending path when all builder variants use the same path template
     */
    union<
        TItems extends readonly [
            AnySchema | DetailedInputBuilder<any, any, any, any, TEntitySchema, TPlugin>,
            ...(AnySchema | DetailedInputBuilder<any, any, any, any, TEntitySchema, TPlugin>)[],
        ],
    >(
        items: TItems,
    ): DetailedInputBuilder<AnySchema, AnySchema, AnySchema, AnySchema, TEntitySchema, TPlugin>;
    union(
        items: readonly [
            AnySchema | DetailedInputBuilder<any, any, any, any, TEntitySchema, TPlugin>,
            ...(AnySchema | DetailedInputBuilder<any, any, any, any, TEntitySchema, TPlugin>)[],
        ],
    ): DetailedInputBuilder<AnySchema, AnySchema, AnySchema, AnySchema, TEntitySchema, TPlugin> {
        const schemas = items.map((item) => {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- discriminates builder instances from raw schemas over a wildcard union
            if (typeof item === "object" && item !== null && "schema" in item) {
                return item.schema;
            }

            return item;
        });

        const variantPaths = items
            .map((item) => {
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- optional _pendingPath probe over a wildcard union
                if (typeof item === "object" && item !== null && "_pendingPath" in item) {
                    return (item as { _pendingPath?: string })._pendingPath;
                }

                return undefined;
            })
            .filter((path): path is string => typeof path === "string" && path.length > 0);

        const resolvedPendingPath =
            variantPaths.length > 0 && variantPaths.every((path) => path === variantPaths[0])
                ? variantPaths[0]
                : this._pendingPath;

        if (schemas.length < 2) {
            const single = schemas[0] ?? this._plugin.voidSchema();
            return new DetailedInputBuilder(
                this._plugin.emptyObject(),
                this._plugin.emptyObject(),
                single,
                this._plugin.emptyObject(),
                this.$entitySchema,
                resolvedPendingPath,
                this._plugin,
            );
        }

        const unified = this._plugin.union(schemas as unknown as UnionTuple);
        return new DetailedInputBuilder(
            this._plugin.emptyObject(),
            this._plugin.emptyObject(),
            unified,
            this._plugin.emptyObject(),
            this.$entitySchema,
            resolvedPendingPath,
            this._plugin,
        );
    }

    private _resolveObjectSchemaTarget(): AnySchema {
        if (typeof this.$body === "object") {
            return this.$body;
        }
        return this.$entitySchema;
    }

    /**
     * Build the final detailed input schema
     * Fields are made optional only when they are void/never or object schemas with all-optional properties.
     * Schema creation goes through the injected plugin (Standard wraps all four keys,
     * Zod omits empty parts so the envelope is a clean z.ZodObject).
     * @internal
     */
    _build(): BuiltDetailedInputSchema<TPlugin, TParams, TQuery, TBody, THeaders> {
        // Build shape with properly typed fields - preserves generics for inference
        const paramsOptional = shouldBeOptional(this.$params);
        const queryOptional = shouldBeOptional(this.$query);
        const bodyOptional = shouldBeOptional(this.$body);
        const headersOptional = shouldBeOptional(this.$headers);

        const shape: SchemaShape = {};
        if (!(this._plugin.omitEmptyParts() && this._plugin.isEmpty(this.$params))) {
            shape.params = paramsOptional ? this._plugin.optional(this.$params) : this.$params;
        }
        if (!(this._plugin.omitEmptyParts() && this._plugin.isEmpty(this.$query))) {
            shape.query = queryOptional ? this._plugin.optional(this.$query) : this.$query;
        }
        if (!(this._plugin.omitEmptyParts() && this._plugin.isEmpty(this.$body))) {
            shape.body = bodyOptional ? this._plugin.optional(this.$body) : this.$body;
        }
        if (!(this._plugin.omitEmptyParts() && this._plugin.isEmpty(this.$headers))) {
            shape.headers = headersOptional ? this._plugin.optional(this.$headers) : this.$headers;
        }

        const schema = this._plugin.object(shape);

        // Add DetailedInputBrand symbol for runtime detection
        // This allows RouteBuilder to distinguish DetailedInput from regular ObjectSchema
        (schema as unknown as Record<symbol, boolean>)[DetailedInputBrand] = true;

        // TypeScript can't evaluate conditional types from runtime branching,
        // so we assert the return type which is guaranteed by the runtime logic above
        return schema as unknown as BuiltDetailedInputSchema<TPlugin, TParams, TQuery, TBody, THeaders>;
    }
}

/**
 * Check if a single field schema is optional (accepts undefined).
 * Works with our custom OptionalSchema, Zod's isOptional(), and any Standard Schema.
 */
function isFieldOptional(field: AnySchema): boolean {
    // Our custom OptionalSchema marker
    if ("_inner" in field) return true;
    // Zod (and compatible libraries) expose isOptional()
    if ("isOptional" in field && typeof (field as { isOptional?: unknown }).isOptional === "function") {
        return (field as { isOptional: () => boolean }).isOptional();
    }
    // Universal fallback: validate undefined — if it succeeds, the field accepts undefined
    try {
        const result = isRecord((field as { "~standard": { validate: (v: unknown) => unknown } })["~standard"].validate(undefined)) ? (field as { "~standard": { validate: (v: unknown) => unknown } })["~standard"].validate(undefined) as Record<string, unknown> : {};
        return "value" in result;
    } catch {
        return false;
    }
}

/**
 * Check if a schema should be optional in the detailed input
 * A schema is optional if:
 * - It's void or never
 * - It's an empty object schema (no fields configured)
 * - It's an object where ALL properties are optional
 */
function shouldBeOptional(schema: AnySchema): boolean {
    // Check for void/never using our type markers
    if (typeof schema === "object" && "_type" in schema) {
        const type = (schema as { _type?: string })._type;
        if (type === "void" || type === "never") {
            return true;
        }
    }

    if (typeof schema === "object") {
        const shapeSymbol = Symbol.for("standard-schema:shape");

        // Resolve shape from our internal schemas (SHAPE_SYMBOL) or Zod/external schemas (.shape)
        let shape: Record<string, AnySchema> | null = null;
        if (shapeSymbol in schema) {
            shape = ((schema as unknown as Record<symbol, Record<string, AnySchema>>)[shapeSymbol]) ?? null;
        } else if (
            "~standard" in schema &&
            "shape" in schema &&
            typeof (schema as { shape?: unknown }).shape === "object" &&
            (schema as { shape: object | null }).shape !== null
        ) {
            shape = (schema as { shape: Record<string, AnySchema> }).shape;
        }

        if (shape !== null) {
            const keys = Object.keys(shape);
            // Empty object schema means nothing was configured — treat as optional
            if (keys.length === 0) return true;
            // All fields optional — make the whole container optional
            return keys.every((key) => { const f = shape[key]; return f !== undefined && isFieldOptional(f); });
        }
    }

    return false;
}

/**
 * Create a new detailed input builder with default schemas.
 * Schema defaults come from the injected plugin.
 */
export function createDetailedInputBuilder<
    TEntitySchema extends AnySchema = VoidSchema,
    TPlugin extends BasePluginTransformer = StandardPluginTransformer,
>(
    entitySchema?: TEntitySchema,
    plugin?: TPlugin,
): DetailedInputBuilder<PluginEmptyObject<TPlugin>, PluginEmptyObject<TPlugin>, PluginVoid<TPlugin>, PluginEmptyObject<TPlugin>, TEntitySchema, TPlugin> {
    const p = plugin ?? (new StandardPluginTransformer() as unknown as TPlugin);
    return new DetailedInputBuilder(
        p.emptyObject() as PluginEmptyObject<TPlugin>,
        p.emptyObject() as PluginEmptyObject<TPlugin>,
        p.voidSchema() as PluginVoid<TPlugin>,
        p.emptyObject() as PluginEmptyObject<TPlugin>,
        entitySchema,
        undefined,
        p,
    );
}
