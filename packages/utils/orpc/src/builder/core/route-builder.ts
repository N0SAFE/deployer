/* eslint-disable @typescript-eslint/no-dynamic-delete */
/* eslint-disable @typescript-eslint/no-explicit-any -- the plugin generic requires `any` to represent "any schema plugin" and impl signatures of overloaded fluent methods widen to `any` to satisfy tsgo's overload-compat check */
/**
 * Main RouteBuilder class for route-builder-v2
 * Provides fluent API for creating ORPC contracts with Standard Schema
 */

import { oc } from "@orpc/contract";
import type { ContractProcedure } from "@orpc/contract";
import type { HTTPPath, AnySchema } from "../../types/types";
import type { 
    RouteMetadata, 
    HTTPMethod, 
    ErrorMap,
} from "../../types/types";
import type { 
    SchemaShape, 
    ObjectSchema, 
    OptionalSchema,
    VoidSchema,
    NeverSchema,
    ShouldBeOptional,
} from "../../types/standard-schema-helpers";
import {
    voidSchema,
    objectSchema,
    optionalSchema,
    literalSchema,
} from "../../types/standard-schema-helpers";
import {
    BasePluginTransformer,
    StandardPluginTransformer,
    type PluginEmptyObject,
    type PluginDetailedOutput,
    type PluginDetectDetailedOutput,
    type PluginBrandedInputParts,
    type PluginBuildInput,
    type PluginBuildOutput,
} from "../plugin";
import { type DetailedInputBuilderSchema, DetailedInputBuilder } from "../input/builder";
import { InputSchemaProxy } from "../input/proxy";
import { createOutputSchemaProxy, type OutputSchemaProxy, type OutputSchemaProxySchema } from "../output/proxy";
import { error, type ErrorDefinitionBuilder, type ExtractErrorsFromBuilders } from "./error-builder";

// ============================================================================
// DETAILED INPUT TYPE (for requests: params, query, body, headers)
// ============================================================================

/**
 * Brand symbol to identify DetailedInput types at compile time
 * Using Symbol.for() to ensure it matches the runtime symbol applied by builders
 */
export const DetailedInputBrand = Symbol.for('DetailedInputBrand');

type NormalizeDetailedInputField<T extends AnySchema> =
    ShouldBeOptional<T> extends true
        ? T extends VoidSchema
            ? OptionalSchema<NeverSchema>
            : OptionalSchema<T>
        : T;

type IsVoidLikeDetailedField<T extends AnySchema> =
    T extends VoidSchema | NeverSchema
        ? true
        : T extends ObjectSchema<infer S extends SchemaShape>
            ? keyof S extends never
                ? true
                : false
        : T extends OptionalSchema<infer I extends AnySchema>
            ? I extends VoidSchema | NeverSchema
                ? true
                : I extends ObjectSchema<infer S extends SchemaShape>
                    ? keyof S extends never
                        ? true
                        : false
                : false
            : false;

type CompactDetailedInputShape<
    P extends AnySchema,
    Q extends AnySchema,
    B extends AnySchema,
    H extends AnySchema,
> = {
    [K in 'params' | 'query' | 'body' | 'headers' as K extends 'params'
        ? IsVoidLikeDetailedField<NormalizeDetailedInputField<P>> extends true
            ? never
            : K
        : K extends 'query'
            ? IsVoidLikeDetailedField<NormalizeDetailedInputField<Q>> extends true
                ? never
                : K
            : K extends 'body'
                ? IsVoidLikeDetailedField<NormalizeDetailedInputField<B>> extends true
                    ? never
                    : K
                : IsVoidLikeDetailedField<NormalizeDetailedInputField<H>> extends true
                    ? never
                    : K]: K extends 'params'
        ? NormalizeDetailedInputField<P>
        : K extends 'query'
            ? NormalizeDetailedInputField<Q>
            : K extends 'body'
                ? NormalizeDetailedInputField<B>
                : NormalizeDetailedInputField<H>;
};

/**
 * DetailedInput structure type - ensures input has proper REQUEST structure
 * This is the canonical shape for structured input with params, query, body, headers
 * 
 * Includes a brand for type-level detection - this brand is removed when building the final contract
 */
export type DetailedInput<
    TParams extends AnySchema = VoidSchema,
    TQuery extends AnySchema = VoidSchema,
    TBody extends AnySchema = VoidSchema,
    THeaders extends AnySchema = VoidSchema
> = ObjectSchema<{
    params: NormalizeDetailedInputField<TParams>;
    query: NormalizeDetailedInputField<TQuery>;
    body: NormalizeDetailedInputField<TBody>;
    headers: NormalizeDetailedInputField<THeaders>;
}>;

/**
 * Check if a type is DetailedInput (has the brand)
 */
export type IsDetailedInput<T> = IsDetailedInputShape<T>;

/**
 * Remove the DetailedInput brand from a type (for building final contract)
 * This strips the brand but keeps the ObjectSchema structure
 * If T is not a DetailedInput, return it as-is
 */
export type IsDetailedInputShape<T> = T extends ObjectSchema<infer Shape>
    ? Shape extends {
        params: AnySchema;
        query: AnySchema;
        body: AnySchema;
        headers: AnySchema;
    }
        ? true
        : false
    : false;

export type RemoveDetailedInputBrand<T> = T extends ObjectSchema<infer Shape>
    ? Shape extends {
        params: infer P extends AnySchema;
        query: infer Q extends AnySchema;
        body: infer B extends AnySchema;
        headers: infer H extends AnySchema;
    }
        ? ObjectSchema<CompactDetailedInputShape<P, Q, B, H>>
        : T
    : T;

// ============================================================================
// DETAILED OUTPUT TYPE (for responses: status, headers, body)
// ============================================================================

/**
 * Brand symbol to identify DetailedOutput types at compile time
 * Using Symbol.for() to ensure it matches the runtime symbol applied by builders
 */
export const DetailedOutputBrand = Symbol.for('DetailedOutputBrand');

/**
 * DetailedOutput structure type - ensures output has proper RESPONSE structure
 * This is the canonical shape for structured output with status, headers, body
 * 
 * Note: TStatus is the numeric value, but the actual schema wraps it in literalSchema
 * 
 * Includes a brand for type-level detection - this brand is removed when building the final contract
 * 
 * TPlugin (default StandardPluginTransformer): with ZodPluginTransformer the envelope
 * is a REAL z.ZodObject (status: z.ZodLiteral, body, optional headers), so the
 * contract's InferOutputSchema is Zod and z.infer works.
 */
export type DetailedOutput<
    TStatus extends number = number,
    THeaders extends AnySchema = AnySchema,
    TBody extends AnySchema = AnySchema,
    TPlugin extends BasePluginTransformer = StandardPluginTransformer,
> = PluginDetailedOutput<TPlugin, TStatus, THeaders, TBody>;

/**
 * Check if a type is DetailedOutput (has the brand)
 */
export type IsDetailedOutput<T> = T extends { readonly [DetailedOutputBrand]: true } ? true : false;

/**
 * Remove the DetailedOutput brand from a type (for building final contract)
 * This strips the brand but keeps the ObjectSchema structure.
 * Structural strip — does not match `DetailedOutput<infer S,H,B>` (which is now
 * a plugin-resolved envelope type whose parts aren't directly inferrable).
 */
export type RemoveDetailedOutputBrand<T> =
    T extends { readonly [DetailedOutputBrand]: true }
        ? T extends ObjectSchema<infer Shape>
            ? ObjectSchema<{
                [K in keyof Shape]: Shape[K];
            }>
            : T
        : T;

/**
 * Detect if a schema has DetailedOutput structure (status, headers, body fields)
 * and convert it to DetailedOutput type if it does
 * 
 * Note: The status field should be a literalSchema<number>, headers and body should be AnySchema
 * 
 * In Zod mode a plain schema is never auto-detected as detailed — the output
 * builder produces DetailedOutput directly via its own methods.
 */
type DetectDetailedOutputStructure<TP extends BasePluginTransformer, T extends AnySchema> = PluginDetectDetailedOutput<TP, T>;

/**
 * Current detailed input parts.
 * The brand check happens HERE (on TInput — concrete at use sites, so the
 * object shape is indexable even when TP is generic). The plugin op only
 * handles the BRANDED re-chain extraction (rare, deferred until TP is concrete).
 */
type CurrentDetailedInputParts<TP extends BasePluginTransformer, TInput extends AnySchema> =
    TInput extends { readonly [DetailedInputBrand]: true }
        ? PluginBrandedInputParts<TP, TInput>
        : {
            params: PluginEmptyObject<TP>;
            query: PluginEmptyObject<TP>;
            body: TInput;
            headers: PluginEmptyObject<TP>;
        };

type CurrentInputParams<TInput extends AnySchema, TP extends BasePluginTransformer> = CurrentDetailedInputParts<TP, TInput>["params"];
type CurrentInputQuery<TInput extends AnySchema, TP extends BasePluginTransformer> = CurrentDetailedInputParts<TP, TInput>["query"];
type CurrentInputBody<TInput extends AnySchema, TP extends BasePluginTransformer> = CurrentDetailedInputParts<TP, TInput>["body"];
type CurrentInputHeaders<TInput extends AnySchema, TP extends BasePluginTransformer> = CurrentDetailedInputParts<TP, TInput>["headers"];

// ============================================================================
// BACKWARD COMPATIBILITY - Keep old Detailed type as alias to DetailedInput
// ============================================================================

/**
 * @deprecated Use DetailedInputBrand instead - DetailedBrand is now an alias for backward compatibility
 */
export const DetailedBrand = DetailedInputBrand;

/**
 * @deprecated Use DetailedInput instead - Detailed now refers to input structure
 */
export type Detailed<
    TParams extends AnySchema = AnySchema,
    TQuery extends AnySchema = AnySchema,
    TBody extends AnySchema = AnySchema,
    THeaders extends AnySchema = AnySchema
> = DetailedInput<TParams, TQuery, TBody, THeaders>;

/**
 * @deprecated Use IsDetailedInput instead
 */
export type IsDetailed<T> = IsDetailedInput<T>;

/**
 * @deprecated Use RemoveDetailedInputBrand instead
 */
export type RemoveDetailedBrand<T> = RemoveDetailedInputBrand<T>;

/**
 * Concrete runtime value for entity schema carried by RouteBuilder.
 *
 * The default generic (`VoidSchema`) means “no entity provided”, but remains
 * a concrete schema value (not `undefined`) so type signatures stay precise.
 */
export type RouteEntitySchemaValue<TEntitySchema extends AnySchema> = TEntitySchema;



/**
 * Resolved contract input schema type for a plugin.
 * Standard (default): strip the DetailedInput brand and compact void-like keys (today).
 * Zod: the schema is already a real Zod schema — pass through unchanged.
 */
type BuildInput<TP extends BasePluginTransformer, TInput extends AnySchema> = PluginBuildInput<TP, TInput>;

/**
 * Resolved contract output schema type for a plugin.
 * Standard (default): strip the DetailedOutput brand (today).
 * Zod: the schema is already a real Zod schema — pass through unchanged.
 */
type BuildOutput<TP extends BasePluginTransformer, TOutput extends AnySchema> = PluginBuildOutput<TP, TOutput>;

/**
 * Clone a Standard Schema wrapper and remove the (enumerable) brand symbols.
 * The DetailedOutput brand is non-enumerable (defineProperty) so it is not copied.
 */
function stripBrand<T extends object>(schema: T): T {
    const clone = { ...schema } as Record<PropertyKey, unknown>;
    delete clone[DetailedInputBrand];
    delete clone[DetailedOutputBrand];
    return clone as T;
}

// ============================================================================
// ROUTE BUILDER CLASS
// ============================================================================

/**
 * Route builder for creating ORPC contracts with Standard Schema
 * 
 * TInput/TOutput can be either:
 * - Simple AnySchema (when using direct schema or callback returning schema)
 * - Detailed structure (when using builder methods like .body(), .query(), etc.)
 * 
 * @example
 * ```typescript
 * // Simple schema
 * const contract = new RouteBuilder()
 *   .route({ method: "GET", path: "/users/{id}" })
 *   .input(userIdSchema)
 *   .output(userSchema)
 *   .build();
 * 
 * // Detailed via builder
 * const contract = new RouteBuilder()
 *   .input(b => b.body(userSchema).query(querySchema))
 *   .output(b => b.body(responseSchema).status(200))
 *   .build();
 * ```
 */
export class RouteBuilder<
    TInput extends AnySchema = VoidSchema,
    TOutput extends AnySchema = VoidSchema,
    TMethod extends HTTPMethod = "GET",
    TEntitySchema extends AnySchema = VoidSchema,
    TErrors extends ErrorMap = Record<never, never>,
    TPlugin extends BasePluginTransformer = StandardPluginTransformer,
> {
    private _metadata: RouteMetadata;
    private _input: TInput;
    private _output: TOutput;
    private _method: TMethod;
    private _entitySchema: RouteEntitySchemaValue<TEntitySchema>;
    private _errors: TErrors;
    private _plugin: TPlugin;

    constructor(
        defaults?: {
            input?: TInput;
            output?: TOutput;
            method?: TMethod;
            path?: HTTPPath;
            entitySchema?: RouteEntitySchemaValue<TEntitySchema>;
            errors?: TErrors;
            metadata?: RouteMetadata;
            /** Schema transformer plugin — default StandardPluginTransformer (today's behavior). */
            use?: TPlugin;
        }
    ) {
        this._metadata = {
            ...(defaults?.metadata ?? {}),
            ...(defaults?.path && !defaults.metadata?.path ? { path: defaults.path } : {}),
        };
        // Schema construction is INJECTED, never hard-coded: everything the builder
        // creates (object/optional/literal/union/empty/void envelopes) goes through
        // the plugin. Default = Standard (today's behavior), opt-in = Zod.
        this._plugin = defaults?.use ?? (new StandardPluginTransformer() as unknown as TPlugin);
        // Default to void schema (simple mode)
        this._input = defaults?.input ?? (this._plugin.voidSchema() as unknown as TInput);
        this._output = (defaults?.output ?? this._plugin.voidSchema() as unknown as TOutput);
        this._method = defaults?.method ?? ("GET" as TMethod);
        this._entitySchema = (defaults?.entitySchema ?? this._plugin.voidSchema()) as RouteEntitySchemaValue<TEntitySchema>;
        this._errors = (defaults?.errors ?? {}) as TErrors;
    }

    // ============================================================================
    // METADATA SETTERS
    // ============================================================================

    /**
     * Set route metadata
     */
    route(metadata: RouteMetadata): RouteBuilder<TInput, TOutput, TMethod, TEntitySchema, TErrors, TPlugin> {
        return new RouteBuilder({
            metadata: { ...this._metadata, ...metadata },
            input: this._input,
            output: this._output,
            method: this._method,
            entitySchema: this._entitySchema,
            errors: this._errors,
            use: this._plugin,
        });
    }

    /**
     * Update route metadata (alias for route)
     */
    updateRoute(metadata: Partial<RouteMetadata>): RouteBuilder<TInput, TOutput, TMethod, TEntitySchema, TErrors, TPlugin> {
        return this.route(metadata);
    }

    /**
     * Set HTTP method
     */
    method<TNewMethod extends HTTPMethod>(method: TNewMethod): RouteBuilder<TInput, TOutput, TNewMethod, TEntitySchema, TErrors, TPlugin> {
        return new RouteBuilder({
            metadata: { ...this._metadata, method },
            input: this._input,
            output: this._output,
            method,
            entitySchema: this._entitySchema,
            errors: this._errors,
            use: this._plugin,
        });
    }

    /**
     * Set the route path (simple string path without params)
     */
    path(path: HTTPPath): RouteBuilder<TInput, TOutput, TMethod, TEntitySchema, TErrors, TPlugin> {
        return new RouteBuilder({
            metadata: { ...this._metadata, path },
            input: this._input,
            output: this._output,
            method: this._method,
            entitySchema: this._entitySchema,
            errors: this._errors,
            use: this._plugin,
        });
    }

    /**
     * Set route summary (OpenAPI)
     */
    summary(summary: string): RouteBuilder<TInput, TOutput, TMethod, TEntitySchema, TErrors, TPlugin> {
        return new RouteBuilder({
            metadata: { ...this._metadata, summary },
            input: this._input,
            output: this._output,
            method: this._method,
            entitySchema: this._entitySchema,
            errors: this._errors,
            use: this._plugin,
        });
    }

    /**
     * Set route description (OpenAPI)
     */
    description(description: string): RouteBuilder<TInput, TOutput, TMethod, TEntitySchema, TErrors, TPlugin> {
        return new RouteBuilder({
            metadata: { ...this._metadata, description },
            input: this._input,
            output: this._output,
            method: this._method,
            entitySchema: this._entitySchema,
            errors: this._errors,
            use: this._plugin,
        });
    }

    /**
     * Add tags (OpenAPI)
     */
    tags(...tags: string[]): RouteBuilder<TInput, TOutput, TMethod, TEntitySchema, TErrors, TPlugin> {
        return new RouteBuilder({
            metadata: { ...this._metadata, tags: [...(this._metadata.tags ?? []), ...tags] },
            input: this._input,
            output: this._output,
            method: this._method,
            entitySchema: this._entitySchema,
            errors: this._errors,
            use: this._plugin,
        });
    }

    /**
     * Mark route as deprecated
     */
    deprecated(deprecated = true): RouteBuilder<TInput, TOutput, TMethod, TEntitySchema, TErrors, TPlugin> {
        return new RouteBuilder({
            metadata: { ...this._metadata, deprecated },
            input: this._input,
            output: this._output,
            method: this._method,
            entitySchema: this._entitySchema,
            errors: this._errors,
            use: this._plugin,
        });
    }

    // ============================================================================
    // SCHEMA GETTERS
    // ============================================================================

    /**
     * Get the input schema
     */
    getInputSchema(): TInput {
        return this._input;
    }

    /**
     * Get the output schema  
     */
    getOutputSchema(): TOutput {
        return this._output;
    }

    /**
     * Get the entity schema
     */
    getEntitySchema(): RouteEntitySchemaValue<TEntitySchema> {
        return this._entitySchema;
    }

    /**
     * Get route metadata (method, path, summary, etc.)
     */
    getRouteMetadata(): RouteMetadata {
        return {
            ...this._metadata,
            method: this._metadata.method ?? this._method,
        };
    }

    /**
     * Get the schema transformer plugin in use.
     * @internal Used by the input/output proxies to keep schema construction injected.
     */
    getPlugin(): TPlugin {
        return this._plugin;
    }

    // ============================================================================
    // INPUT/OUTPUT API - BUILDER PATTERN
    // ============================================================================

    /**
     * Set input schema - supports direct schema or builder callback
     * 
     * Usage patterns:
     * - `.input(schema)` → Non-detailed: direct schema
     * - `.input(b => schema)` → Non-detailed: callback returns plain schema
     * - `.input(b => b.body(schema).query(querySchema))` → Detailed: callback returns builder
    * - `.input(b => b.union([schemaA, schemaB]))` → Union: multiple input variants
     * 
     * @example
     * ```typescript
     * // Non-detailed (direct schema)
     * .input(userSchema)
     * .input(b => userSchema)
     * 
     * // Detailed (builder methods)
     * .input(b => b.body(userSchema).query(querySchema))
     * .input(b => b.params(p => p`/users/${p('id', idSchema)}`).body(userSchema))
    *
    * // Union input variants
    * .input(b => b.union([
    *   b.body(emailLookupSchema),
    *   b.body(idLookupSchema),
    * ]))
     * ```
     */
    input<TNewInput extends AnySchema>(
        builder: (b: InputSchemaProxy<CurrentInputParams<TInput, TPlugin>, CurrentInputQuery<TInput, TPlugin>, CurrentInputBody<TInput, TPlugin>, CurrentInputHeaders<TInput, TPlugin>, TEntitySchema, TPlugin>) => TNewInput
    ): RouteBuilder<TNewInput, TOutput, TMethod, TEntitySchema, TErrors, TPlugin>;
    input<TParams extends AnySchema, TQuery extends AnySchema, TBody extends AnySchema, THeaders extends AnySchema>(
        builder: (b: InputSchemaProxy<CurrentInputParams<TInput, TPlugin>, CurrentInputQuery<TInput, TPlugin>, CurrentInputBody<TInput, TPlugin>, CurrentInputHeaders<TInput, TPlugin>, TEntitySchema, TPlugin>) => DetailedInputBuilder<TParams, TQuery, TBody, THeaders, TEntitySchema, TPlugin>
    ): RouteBuilder<DetailedInputBuilderSchema<TPlugin, TParams, TQuery, TBody, THeaders>, TOutput, TMethod, TEntitySchema, TErrors, TPlugin>;
    input<TNewInput extends AnySchema>(
        schema: TNewInput
    ): RouteBuilder<TNewInput, TOutput, TMethod, TEntitySchema, TErrors, TPlugin>;
    input<TNewInput extends AnySchema>(
        schemaOrBuilder: TNewInput | ((b: InputSchemaProxy<CurrentInputParams<TInput, TPlugin>, CurrentInputQuery<TInput, TPlugin>, CurrentInputBody<TInput, TPlugin>, CurrentInputHeaders<TInput, TPlugin>, TEntitySchema, TPlugin>) => TNewInput | InputSchemaProxy<AnySchema, AnySchema, AnySchema, AnySchema, TEntitySchema, TPlugin>)
    ): RouteBuilder<any, TOutput, TMethod, TEntitySchema, TErrors, TPlugin> {
        // Callback mode
        if (typeof schemaOrBuilder === "function") {
            // Build the input proxy from existing input parts
            const detailedBuilder = this._createInputBuilder();
            const result = schemaOrBuilder(detailedBuilder);
            
            // Check if result is an InputSchemaProxy (has _build method)
            if (typeof result === 'object' && '_build' in result && typeof result._build === 'function') {
                const builder = result;
                const inputSchema = builder.schema;
                
                // Extract pending path if set by template literal params
                const pendingPath = builder._pendingPath;
                const metadata = pendingPath 
                    ? { ...this._metadata, path: pendingPath as HTTPPath }
                    : this._metadata;
                
                return new RouteBuilder({
                    metadata,
                    input: inputSchema,
                    output: this._output,
                    method: this._method,
                    entitySchema: this._entitySchema,
                    errors: this._errors,
                    use: this._plugin,
                });
            }
            
            // Schema mode - callback returned a schema directly
            return new RouteBuilder({
                metadata: this._metadata,
                input: result as TNewInput,
                output: this._output,
                method: this._method,
                entitySchema: this._entitySchema,
                errors: this._errors,
                use: this._plugin,
            });
        }
        
        // Direct schema mode
        return new RouteBuilder({
            metadata: this._metadata,
            input: schemaOrBuilder,
            output: this._output,
            method: this._method,
            entitySchema: this._entitySchema,
            errors: this._errors,
            use: this._plugin,
        });
    }

    /**
     * Set output schema - supports direct schema, builder callback, or union callback
     * 
     * Usage patterns:
     * - `.output(schema)` → Non-detailed: direct schema
     * - `.output(b => schema)` → Non-detailed: callback returns plain schema
     * - `.output(b => b.body(schema).status(201))` → Detailed: callback returns builder
     * - `.output(b => b.union([b.status(200).body(s1), b.status(404).body(s2)]))` → Union: multiple status variants
     * 
     * @example
     * ```typescript
     * // Non-detailed (direct schema)
     * .output(userSchema)
     * .output(b => userSchema)
     * 
     * // Detailed (builder methods)
     * .output(b => b.body(userSchema).status(200))
     * .output(b => b.union([b.body(schema1).status(200), b.body(schema2).status(201)]))
     * ```
     */
    output<TNewOutput extends AnySchema>(
        builder: (
            b: OutputSchemaProxy<TOutput, TMethod, TEntitySchema, TErrors, TPlugin>,
        ) => TNewOutput,
    ): RouteBuilder<TInput, DetectDetailedOutputStructure<TPlugin, TNewOutput>, TMethod, TEntitySchema, TErrors, TPlugin>;
    output<TProxyOutput extends AnySchema | DetailedOutput>(
        builder: (
            b: OutputSchemaProxy<TOutput, TMethod, TEntitySchema, TErrors, TPlugin>,
        ) => OutputSchemaProxy<TProxyOutput, TMethod, TEntitySchema, TErrors, TPlugin>,
    ): RouteBuilder<TInput, OutputSchemaProxySchema<TPlugin, TProxyOutput>, TMethod, TEntitySchema, TErrors, TPlugin>;
    output<TNewOutput extends AnySchema>(
        schema: TNewOutput
    ): RouteBuilder<TInput, DetectDetailedOutputStructure<TPlugin, TNewOutput>, TMethod, TEntitySchema, TErrors, TPlugin>;
    output<TNewOutput extends AnySchema>(
        schemaOrBuilder: TNewOutput | ((b: OutputSchemaProxy<TOutput, TMethod, TEntitySchema, TErrors, TPlugin>) => TNewOutput | OutputSchemaProxy<AnySchema | DetailedOutput, TMethod, TEntitySchema, TErrors, TPlugin>)
    ): RouteBuilder<TInput, any, TMethod, TEntitySchema, TErrors, TPlugin> {
        // Callback mode
        if (typeof schemaOrBuilder === "function") {
            const proxy = createOutputSchemaProxy(this as unknown as RouteBuilder<AnySchema, TOutput, TMethod, TEntitySchema, TErrors, TPlugin>);
            const result = schemaOrBuilder(proxy);
            
            // Check if result is a proxy/builder (has _build method)
            if (typeof result === 'object' && '_build' in result && typeof result._build === 'function') {
                const proxyLike = result as { _build: () => AnySchema; schema?: AnySchema };
                const outputSchema = proxyLike.schema ?? proxyLike._build();
                return new RouteBuilder({
                    metadata: this._metadata,
                    input: this._input,
                    output: outputSchema,
                    method: this._method,
                    entitySchema: this._entitySchema,
                    errors: this._errors,
                    use: this._plugin,
                });
            }
            
            // Schema mode - callback returned a schema directly
            return new RouteBuilder({
                metadata: this._metadata,
                input: this._input,
                output: result as TNewOutput,
                method: this._method,
                entitySchema: this._entitySchema,
                errors: this._errors,
                use: this._plugin,
            });
        }
        
        // Direct schema mode
        return new RouteBuilder({
            metadata: this._metadata,
            input: this._input,
            output: schemaOrBuilder,
            method: this._method,
            entitySchema: this._entitySchema,
            errors: this._errors,
            use: this._plugin,
        });
    }

    /**
     * @internal Create a DetailedInputBuilder from the existing _input state.
     * Extracts existing params/query/body/headers if _input is a DetailedInput.
     * Uses the injected plugin for both construction and introspection.
     */
    private _createInputBuilder(): InputSchemaProxy<CurrentInputParams<TInput, TPlugin>, CurrentInputQuery<TInput, TPlugin>, CurrentInputBody<TInput, TPlugin>, CurrentInputHeaders<TInput, TPlugin>, TEntitySchema, TPlugin> {
        let existingParams = this._plugin.emptyObject() as CurrentInputParams<TInput, TPlugin>;
        let existingQuery = this._plugin.emptyObject() as CurrentInputQuery<TInput, TPlugin>;
        let existingBody = this._input as CurrentInputBody<TInput, TPlugin>;
        let existingHeaders = this._plugin.emptyObject() as CurrentInputHeaders<TInput, TPlugin>;

        // The DETAILED INPUT BRAND is the ONLY reliable discriminator: a plain
        // schema that happens to have a `query`/`body` field (e.g. an entity
        // with a `query` property) must NOT be split into detailed parts.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- brand probe on a generic input type
        const isDetailedEnvelope = typeof this._input === 'object' && this._input !== null && DetailedInputBrand in this._input;

        if (isDetailedEnvelope) {
            // Re-chaining a previously-built detailed envelope: extract parts via the plugin.
            existingBody = this._plugin.voidSchema() as CurrentInputBody<TInput, TPlugin>;
            const inputShape = this._plugin.getShape(this._input);
            if (inputShape) {
                // Helper to unwrap OptionalSchema/ZodOptional and drop empty shapes
                const unwrapAndExtract = (field: AnySchema | undefined): AnySchema | undefined => {
                    if (!field) return undefined;
                    if (this._plugin.isOptional(field)) {
                        const inner = this._plugin.unwrapOptional(field);
                        if (this._plugin.isEmpty(inner)) return undefined;
                        return inner;
                    }
                    return field;
                };
                
                const extractedParams = unwrapAndExtract(inputShape.params as AnySchema | undefined);
                const extractedQuery = unwrapAndExtract(inputShape.query as AnySchema | undefined);
                const extractedHeaders = unwrapAndExtract(inputShape.headers as AnySchema | undefined);
                const bodyField = inputShape.body as AnySchema | undefined;
                
                if (extractedParams) existingParams = extractedParams as CurrentInputParams<TInput, TPlugin>;
                if (extractedQuery) existingQuery = extractedQuery as CurrentInputQuery<TInput, TPlugin>;
                if (bodyField) existingBody = bodyField as CurrentInputBody<TInput, TPlugin>;
                if (extractedHeaders) existingHeaders = extractedHeaders as CurrentInputHeaders<TInput, TPlugin>;
            }
        }
        
        return new InputSchemaProxy(
            existingParams,
            existingQuery,
            existingBody,
            existingHeaders,
            this._entitySchema,
            undefined,
            this._plugin
        );
    }

    // ============================================================================
    // ENTITY AND ERRORS
    // ============================================================================

    /**
     * Set entity schema for use in input/output builders
     */
    entity<TNewEntitySchema extends AnySchema>(schema: TNewEntitySchema): RouteBuilder<TInput, TOutput, TMethod, TNewEntitySchema, TErrors, TPlugin> {
        return new RouteBuilder({
            metadata: this._metadata,
            input: this._input,
            output: this._output,
            method: this._method,
            entitySchema: schema,
            errors: this._errors,
            use: this._plugin,
        });
    }

    /**
     * Add error definitions
     * 
     * @example Rest parameters pattern
     * ```typescript
     * .errors(
     *     error().code("NOT_FOUND").data(notFoundSchema),
     *     error().code("UNAUTHORIZED").data(unauthorizedSchema)
     * )
     * ```
     * 
     * @example Callback pattern with factory
     * ```typescript
     * .errors((e) => [
     *     e().code("NOT_FOUND").data(notFoundSchema),
     *     e().code("UNAUTHORIZED").data(unauthorizedSchema)
     * ])
     * ```
     */
    errors<TNewErrors extends readonly ErrorDefinitionBuilder<string, string | undefined, AnySchema | undefined, number | undefined>[]>(
        errorsOrBuilder: TNewErrors[0] extends ErrorDefinitionBuilder<infer _A, infer _B, infer _C, infer _D>
            ? TNewErrors | ((factory: typeof error) => TNewErrors)
            : ((factory: typeof error) => TNewErrors)
    ): RouteBuilder<TInput, TOutput, TMethod, TEntitySchema, TErrors & ExtractErrorsFromBuilders<TNewErrors>, TPlugin>;
    errors<TNewErrors extends readonly ErrorDefinitionBuilder<string, string | undefined, AnySchema | undefined, number | undefined>[]>(
        ...errors: TNewErrors
    ): RouteBuilder<TInput, TOutput, TMethod, TEntitySchema, TErrors & ExtractErrorsFromBuilders<TNewErrors>, TPlugin>;
    errors<TNewErrors extends readonly ErrorDefinitionBuilder<string, string | undefined, AnySchema | undefined, number | undefined>[]>(
        ...errorsOrCallback: TNewErrors | [(factory: typeof error) => TNewErrors]
    ): RouteBuilder<TInput, TOutput, TMethod, TEntitySchema, TErrors & ExtractErrorsFromBuilders<TNewErrors>, TPlugin> {
        // Check if single argument is a callback function
        const firstArg = errorsOrCallback[0];
        const errors = typeof firstArg === "function" && errorsOrCallback.length === 1
            ? (firstArg)(error)
            : errorsOrCallback as unknown as TNewErrors;

        const errorMap: Record<string, unknown> = { ...this._errors };
        
        for (const errorBuilder of errors) {
            const def = errorBuilder._getDefinition();
            errorMap[def.code] = {
                message: def.message,
                data: def.data,
                status: def.status,
            };
        }
        
        return new RouteBuilder({
            metadata: this._metadata,
            input: this._input,
            output: this._output,
            method: this._method,
            entitySchema: this._entitySchema,
            errors: errorMap as TErrors & ExtractErrorsFromBuilders<TNewErrors>,
            use: this._plugin,
        });
    }

    // ============================================================================
    // BUILD
    // ============================================================================

    /**
     * Build the final ORPC contract.
     *
     * Standard mode (default): strips the DetailedInput/DetailedOutput brand so
     * downstream consumers don't keep enforcing detailed wrappers (today's behavior).
     *
     * Zod mode (use: ZodPluginTransformer): schemas are ALREADY real Zod — passed
     * through unchanged. The brand is a hidden property ORPC ignores; the type
     * carries it so `InferInputSchema<contract>` is the real Zod schema.
     */
    build() {
        // Detect detailed modes at runtime via the brand symbols.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- brand probe on generic input/output types
        const isDetailedInput = typeof this._input === 'object' && this._input !== null && DetailedInputBrand in this._input;
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- brand probe on generic input/output types
        const isDetailedOutput = typeof this._output === 'object' && this._output !== null && DetailedOutputBrand in this._output;

        // Zod mode: schemas are already real Zod — pass through unchanged.
        // Standard mode: strip the brand symbol at runtime (clone, then delete).
        const inputForContract: BuildInput<TPlugin, TInput> = this._plugin.producesZod()
            ? this._input
            : (isDetailedInput
                ? stripBrand(this._input as object) as BuildInput<TPlugin, TInput>
                : this._input);

        const outputForContract: BuildOutput<TPlugin, TOutput> = this._plugin.producesZod()
            ? this._output
            : (isDetailedOutput
                ? stripBrand(this._output as object) as BuildOutput<TPlugin, TOutput>
                : this._output);

        // Create the ORPC contract
        const contractWithOutput = oc.input(inputForContract).output(outputForContract);

        // Always include method from RouteBuilder state in final route metadata.
        // RouteBuilder stores method in `_method`, while `_metadata` may only contain
        // path/summary/description. Without this merge, ORPC falls back to POST.
        // Set inputStructure/outputStructure based on whether detailed builder was used
        // so the ORPC client encodes requests in the correct mode. ORPC defaults to
        // "compact" which reads path params from top-level keys (input[paramName])
        // instead of input.params[paramName] — causing validation failures.
        const finalRouteMetadata: RouteMetadata = {
            ...this._metadata,
            method: this._metadata.method ?? this._method,
            ...(isDetailedInput
                ? { inputStructure: 'detailed' as const }
                : {}),
            ...(isDetailedOutput
                ? { outputStructure: 'detailed' as const }
                : {}),
        };

        return contractWithOutput.route(finalRouteMetadata) as unknown as ContractProcedure<BuildInput<TPlugin, TInput>, BuildOutput<TPlugin, TOutput>, TErrors, RouteMetadata>;
    }

    // ============================================================================
    // STATIC FACTORY METHODS
    // ============================================================================

    /**
     * Create a health check endpoint
     * Returns status, timestamp, and optional details
     * 
     * @example
     * ```typescript
     * const healthContract = RouteBuilder.health().build();
     * // GET /health -> { status: 'healthy', timestamp: '...', details?: {...} }
     * ```
     */
    static health(options?: { path?: HTTPPath; includeDetails?: boolean }) {
        // Create simple health response schema
        const healthSchema = objectSchema({
            status: literalSchema('healthy'),
            timestamp: voidSchema(), // Replace with date schema when available
            details: optionalSchema(objectSchema({})),
        });

        return new RouteBuilder({
            method: "GET" as const,
            output: healthSchema,
            metadata: { path: options?.path ?? "/health" }
        });
    }

    /**
     * Create a readiness probe endpoint
     * Used by orchestrators (k8s) to check if service is ready
     * 
     * @example
     * ```typescript
     * const readyContract = RouteBuilder.ready().build();
     * // GET /ready -> { ready: true, checks?: {...} }
     * ```
     */
    static ready(options?: { path?: HTTPPath }) {
        const readySchema = objectSchema({
            ready: literalSchema(true),
            checks: optionalSchema(objectSchema({})),
        });

        return new RouteBuilder({
            method: "GET" as const,
            output: readySchema,
            metadata: { path: options?.path ?? "/ready" }
        });
    }

    /**
     * Create a liveness probe endpoint
     * Used by orchestrators (k8s) to check if service is alive
     * 
     * @example
     * ```typescript
     * const liveContract = RouteBuilder.live().build();
     * // GET /live -> { alive: true }
     * ```
     */
    static live(options?: { path?: HTTPPath }) {
        const liveSchema = objectSchema({
            alive: literalSchema(true),
        });

        return new RouteBuilder({
            method: "GET" as const,
            output: liveSchema,
            metadata: { path: options?.path ?? "/live" }
        });
    }
}

/**
 * Create a new route builder
 */
export function route(metadata?: RouteMetadata): RouteBuilder {
    return new RouteBuilder({ metadata });
}
