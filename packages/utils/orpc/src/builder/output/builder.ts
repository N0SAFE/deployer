 
/**
 * Output builders for route-builder-v2.
 *
 * Mirrors the input-side architecture (`input/builder.ts` + `input/proxy.ts`):
 * - this file contains the full output building logic (`DetailedOutputBuilder`),
 * - `output/proxy.ts` only wires RouteBuilder context into a thin proxy wrapper.
 *
 * Output structure concerns RESPONSE semantics only:
 * - `status`
 * - `headers`
 * - `body`
 * - `streamed` output wrappers
 * - response `union` composition
 *
 * Schema construction is INJECTED through a plugin (default: Standard Schema,
 * opt-in: Zod) — the builder never calls the schema factories directly.
 */

import { eventIterator, type Schema } from "@orpc/contract";
import { DetailedOutputBrand, type DetailedOutput } from "../core/route-builder";
import type { AnySchema, HTTPMethod, ErrorMap, UnionTuple } from "../../types/types";
import type { ObjectSchema, VoidSchema, SchemaShape } from "../../types/standard-schema-helpers";
import { ProxyBuilderBase } from "../core/proxy-builder.base";
import {
    BasePluginTransformer,
    StandardPluginTransformer,
    type PluginExtractOutputBody,
    type PluginExtractOutputStatus,
    type PluginExtractOutputHeaders,
    type PluginOutputProxySchema,
} from "../plugin";
import type { OutputSchemaProxy } from "./proxy";
import { observable, type Observable } from "../../observable/contract";

/**
 * Extract body schema from output type.
 * - If detailed output shape exists, returns `body` schema.
 * - Otherwise returns the schema itself.
 */
export type ExtractOutputBody<TP extends BasePluginTransformer, T extends AnySchema> = PluginExtractOutputBody<TP, T>;

/**
 * Extract numeric status code from output type.
 * Defaults to `200` when no detailed status exists.
 */
export type ExtractOutputStatus<TP extends BasePluginTransformer, T extends AnySchema> = PluginExtractOutputStatus<TP, T>;

/**
 * Extract headers schema from output type.
 * Defaults to the plugin's empty object schema when not in detailed mode.
 */
export type ExtractOutputHeaders<TP extends BasePluginTransformer, T extends AnySchema> = PluginExtractOutputHeaders<TP, T>;

/**
 * Public schema view for output proxy/builder consumers:
 * - returns direct body schema for common case (`status=200` and no headers),
 * - otherwise returns the detailed output schema.
 */
export type OutputSchemaProxySchema<TP extends BasePluginTransformer, TData extends AnySchema | DetailedOutput> = PluginOutputProxySchema<TP, TData>;

type ObservableContractSchema<TSchema extends AnySchema> =
    TSchema extends Schema<infer TIn, infer TOut>
        ? Schema<Observable<TIn>, Observable<TOut>>
        : AnySchema;

/**
 * Runtime guard for detailed output mode.
 */
export function isDetailedMode(data: AnySchema | DetailedOutput): boolean {
    return DetailedOutputBrand in (data as object);
}

/**
 * Core output builder with immutable chaining.
 *
 * This class intentionally contains all output-building behavior so the
 * architecture matches input-side layering (`DetailedInputBuilder`).
 */
export abstract class DetailedOutputBuilder<
    TData extends AnySchema | DetailedOutput = VoidSchema,
    TMethod extends HTTPMethod = "GET",
    TEntitySchema extends AnySchema = VoidSchema,
    TErrors extends ErrorMap = Record<string, never>,
    TPlugin extends BasePluginTransformer = StandardPluginTransformer,
> extends ProxyBuilderBase<OutputSchemaProxySchema<TPlugin, TData>> {
    /** Internal accumulated output schema state. */
    readonly $data: TData;
    /** @internal Schema transformer plugin — drives ALL schema construction. */
    protected readonly _plugin: TPlugin;

    constructor(data: TData, plugin?: TPlugin) {
        super();
        this.$data = data;
        this._plugin = plugin ?? (new StandardPluginTransformer() as unknown as TPlugin);
    }

    /**
     * Factory hook implemented by proxy layer.
     * Must return a new immutable proxy instance with updated data.
     */
    protected abstract _create<TNewData extends AnySchema | DetailedOutput>(data: TNewData): OutputSchemaProxy<TNewData, TMethod, TEntitySchema, TErrors, TPlugin>;

    /**
     * Entity schema hook delegated to proxy layer (RouteBuilder context).
     */
    protected abstract _getEntitySchema(): TEntitySchema;

    /** Access entity schema from route context. */
    get entitySchema(): TEntitySchema {
        return this._getEntitySchema();
    }

    /**
     * Resolved output schema view.
     *
     * - Non-detailed mode => raw schema
     * - Detailed mode with 200/no-headers => direct body schema
     * - Otherwise => full detailed schema
     */
    get schema(): OutputSchemaProxySchema<TPlugin, TData> {
        const detailed = isDetailedMode(this.$data);
        if (!detailed) {
            return this.$data as unknown as OutputSchemaProxySchema<TPlugin, TData>;
        }

        const status = this._extractStatus();
        const headers = this._extractHeaders();
        const headerShape = this._plugin.getShape(headers as AnySchema);
        const hasHeaders = headerShape !== null && Object.keys(headerShape).length > 0;

        if (status === 200 && !hasHeaders) {
            return this._extractBody() as unknown as OutputSchemaProxySchema<TPlugin, TData>;
        }

        return this.$data as unknown as OutputSchemaProxySchema<TPlugin, TData>;
    }

    /** Extract body from detailed schema (guarded). */
    protected _extractBody(): ExtractOutputBody<TPlugin, TData> {
        if (!isDetailedMode(this.$data)) {
            throw new Error("DetailedOutputBuilder._extractBody: not in detailed mode.");
        }
        const shape = this._plugin.getShape(this.$data);
        const body = shape?.body as ExtractOutputBody<TPlugin, TData> | undefined;
        // Zod mode omits empty parts — absent body falls back to the plugin void sentinel.
        if (body === undefined) {
            return this._plugin.voidSchema() as unknown as ExtractOutputBody<TPlugin, TData>;
        }
        return body;
    }

    /** Extract status from detailed schema (guarded). */
    protected _extractStatus(): ExtractOutputStatus<TPlugin, TData> {
        if (!isDetailedMode(this.$data)) {
            throw new Error("DetailedOutputBuilder._extractStatus: not in detailed mode.");
        }
        const shape = this._plugin.getShape(this.$data);
        const statusSchema = shape?.status;
        const value = statusSchema !== undefined ? this._plugin.getLiteralValue(statusSchema) : null;
        return (value ?? 200) as ExtractOutputStatus<TPlugin, TData>;
    }

    /** Extract headers from detailed schema (guarded). */
    protected _extractHeaders(): ExtractOutputHeaders<TPlugin, TData> {
        if (!isDetailedMode(this.$data)) {
            throw new Error("DetailedOutputBuilder._extractHeaders: not in detailed mode.");
        }
        const shape = this._plugin.getShape(this.$data);
        const headers = shape?.headers as ExtractOutputHeaders<TPlugin, TData> | undefined;
        // Zod mode omits empty parts — absent headers fall back to the plugin empty object.
        if (headers === undefined) {
            return this._plugin.emptyObject() as unknown as ExtractOutputHeaders<TPlugin, TData>;
        }
        return headers as unknown as ExtractOutputHeaders<TPlugin, TData>;
    }

    /** Default status for non-detailed mode. */
    protected _defaultStatus(): ExtractOutputStatus<TPlugin, TData> {
        return 200 as ExtractOutputStatus<TPlugin, TData>;
    }

    /** Default headers for non-detailed mode. */
    protected _defaultHeaders(): ExtractOutputHeaders<TPlugin, TData> {
        return this._plugin.emptyObject() as unknown as ExtractOutputHeaders<TPlugin, TData>;
    }

    /** Default body for non-detailed mode. */
    protected _defaultBody(): ExtractOutputBody<TPlugin, TData> {
        return this.$data as unknown as ExtractOutputBody<TPlugin, TData>;
    }

    /** Build branded detailed output schema object through the injected plugin. */
    protected _buildDetailedSchema<TStatus extends number, THeaders extends AnySchema, TBody extends AnySchema>(
        status: TStatus,
        headers: THeaders,
        body: TBody,
    ): DetailedOutput<TStatus, THeaders, TBody, TPlugin> {
        // "Empty headers" = no shape fields (Standard getShape returns null for
        // non-our schemas, mirroring today's getSchemaShape-key check).
        const headersShape = this._plugin.getShape(headers);
        const headersEmpty = headersShape === null || Object.keys(headersShape).length === 0;

        const shape: SchemaShape = {
            status: this._plugin.literalSchema(status),
            body,
        };
        if (!(this._plugin.omitEmptyParts() && headersEmpty)) {
            shape.headers = headersEmpty ? this._plugin.optional(headers) : headers;
        }

        const schema = this._plugin.object(shape);
        Object.defineProperty(schema, DetailedOutputBrand, { value: true });
        return schema as unknown as DetailedOutput<TStatus, THeaders, TBody, TPlugin>;
    }

    /**
     * Body accessor with callable + streamed sub-call.
     */
    get body() {
        type BodyCallable = {
            <TNewBody extends AnySchema>(schema: TNewBody): OutputSchemaProxy<DetailedOutput<ExtractOutputStatus<TPlugin, TData>, ExtractOutputHeaders<TPlugin, TData>, TNewBody, TPlugin>, TMethod, TEntitySchema, TErrors, TPlugin>;
            <TNewBody extends AnySchema>(
                builder: (current: ExtractOutputBody<TPlugin, TData>) => TNewBody,
            ): OutputSchemaProxy<DetailedOutput<ExtractOutputStatus<TPlugin, TData>, ExtractOutputHeaders<TPlugin, TData>, TNewBody, TPlugin>, TMethod, TEntitySchema, TErrors, TPlugin>;
            streamed: {
                <TNewBody extends AnySchema>(schema: TNewBody): OutputSchemaProxy<DetailedOutput<ExtractOutputStatus<TPlugin, TData>, ExtractOutputHeaders<TPlugin, TData>, AnySchema, TPlugin>, TMethod, TEntitySchema, TErrors, TPlugin>;
                <TNewBody extends AnySchema>(
                    builder: (current: ExtractOutputBody<TPlugin, TData>) => TNewBody,
                ): OutputSchemaProxy<DetailedOutput<ExtractOutputStatus<TPlugin, TData>, ExtractOutputHeaders<TPlugin, TData>, AnySchema, TPlugin>, TMethod, TEntitySchema, TErrors, TPlugin>;
            };
        };

        const callable = (<TNewBody extends AnySchema>(
            schemaOrBuilder: TNewBody | ((current: ExtractOutputBody<TPlugin, TData>) => TNewBody),
        ): OutputSchemaProxy<DetailedOutput<ExtractOutputStatus<TPlugin, TData>, ExtractOutputHeaders<TPlugin, TData>, TNewBody, TPlugin>, TMethod, TEntitySchema, TErrors, TPlugin> => {
            const detailed = isDetailedMode(this.$data);
            const currentBody = detailed ? this._extractBody() : this._defaultBody();
            const newBody = typeof schemaOrBuilder === "function" ? (schemaOrBuilder)(currentBody) : schemaOrBuilder;
            const status = detailed ? this._extractStatus() : this._defaultStatus();
            const headers = detailed ? this._extractHeaders() : this._defaultHeaders();
            const built = this._buildDetailedSchema(status, headers, newBody);
            return this._create(built);
        }) as BodyCallable;

        callable.streamed = <TNewBody extends AnySchema>(schemaOrBuilder: TNewBody | ((current: ExtractOutputBody<TPlugin, TData>) => TNewBody)) => {
            const detailed = isDetailedMode(this.$data);
            const currentBody = detailed ? this._extractBody() : this._defaultBody();
            const baseSchema = typeof schemaOrBuilder === "function" ? (schemaOrBuilder)(currentBody) : schemaOrBuilder;
            const streamedBody = eventIterator(baseSchema) as AnySchema;
            const status = detailed ? this._extractStatus() : this._defaultStatus();
            const headers = detailed ? this._extractHeaders() : this._defaultHeaders();
            const built = this._buildDetailedSchema(status, headers, streamedBody);
            return this._create(built);
        };

        return callable;
    }

    /**
     * Set response status (optionally replacing body in one call).
     */
    status<TNewStatus extends number>(
        statusCode: TNewStatus,
    ): OutputSchemaProxy<DetailedOutput<TNewStatus, ExtractOutputHeaders<TPlugin, TData>, ExtractOutputBody<TPlugin, TData>, TPlugin>, TMethod, TEntitySchema, TErrors, TPlugin>;
    status<TNewStatus extends number, TNewBody extends AnySchema>(
        statusCode: TNewStatus,
        bodySchema: TNewBody,
    ): OutputSchemaProxy<DetailedOutput<TNewStatus, ExtractOutputHeaders<TPlugin, TData>, TNewBody, TPlugin>, TMethod, TEntitySchema, TErrors, TPlugin>;
    status<TNewStatus extends number, TNewBody extends AnySchema = never>(
        statusCode: TNewStatus,
        bodySchema?: TNewBody,
    ): OutputSchemaProxy<DetailedOutput<TNewStatus, ExtractOutputHeaders<TPlugin, TData>, ExtractOutputBody<TPlugin, TData> | TNewBody, TPlugin>, TMethod, TEntitySchema, TErrors, TPlugin> {
        const detailed = isDetailedMode(this.$data);
        const body = bodySchema ?? (detailed ? this._extractBody() : this._defaultBody());
        const headers = detailed ? this._extractHeaders() : this._defaultHeaders();
        const built = this._buildDetailedSchema(statusCode, headers, body);
        return this._create(built);
    }

    /**
     * Set response headers using schema, shape, or transform callback.
     */
    headers<TNewHeaders extends AnySchema>(schema: TNewHeaders): OutputSchemaProxy<DetailedOutput<ExtractOutputStatus<TPlugin, TData>, TNewHeaders, ExtractOutputBody<TPlugin, TData>, TPlugin>, TMethod, TEntitySchema, TErrors, TPlugin>;
    headers<TNewShape extends SchemaShape>(
        shape: TNewShape,
    ): OutputSchemaProxy<DetailedOutput<ExtractOutputStatus<TPlugin, TData>, ObjectSchema<TNewShape>, ExtractOutputBody<TPlugin, TData>, TPlugin>, TMethod, TEntitySchema, TErrors, TPlugin>;
    headers<TNewHeaders extends AnySchema>(
        builder: (current: ExtractOutputHeaders<TPlugin, TData>) => TNewHeaders,
    ): OutputSchemaProxy<DetailedOutput<ExtractOutputStatus<TPlugin, TData>, TNewHeaders, ExtractOutputBody<TPlugin, TData>, TPlugin>, TMethod, TEntitySchema, TErrors, TPlugin>;
    headers<TNewHeaders extends AnySchema>(
        schemaOrBuilder: TNewHeaders | ((current: ExtractOutputHeaders<TPlugin, TData>) => TNewHeaders),
    ): OutputSchemaProxy<DetailedOutput<ExtractOutputStatus<TPlugin, TData>, TNewHeaders, ExtractOutputBody<TPlugin, TData>, TPlugin>, TMethod, TEntitySchema, TErrors, TPlugin> {
        const detailed = isDetailedMode(this.$data);
        const currentHeaders = detailed ? this._extractHeaders() : this._defaultHeaders();
        const newHeaders =
            typeof schemaOrBuilder === "function"
                ? (schemaOrBuilder)(currentHeaders)
                : typeof schemaOrBuilder === "object" && !("~standard" in schemaOrBuilder)
                  ? (this._plugin.object(schemaOrBuilder) as unknown as TNewHeaders)
                  : schemaOrBuilder;

        const status = detailed ? this._extractStatus() : this._defaultStatus();
        const body = detailed ? this._extractBody() : this._defaultBody();
        const built = this._buildDetailedSchema(status, newHeaders, body);
        return this._create(built);
    }

    /**
     * Wrap body as streamed `EventIterator` output.
     */
    streamed<TNewBody extends AnySchema>(schema: TNewBody): OutputSchemaProxy<DetailedOutput<ExtractOutputStatus<TPlugin, TData>, ExtractOutputHeaders<TPlugin, TData>, AnySchema, TPlugin>, TMethod, TEntitySchema, TErrors, TPlugin>;
    streamed<TNewBody extends AnySchema>(
        builder: (current: ExtractOutputBody<TPlugin, TData>) => TNewBody,
    ): OutputSchemaProxy<DetailedOutput<ExtractOutputStatus<TPlugin, TData>, ExtractOutputHeaders<TPlugin, TData>, AnySchema, TPlugin>, TMethod, TEntitySchema, TErrors, TPlugin>;
    streamed<TNewBody extends AnySchema>(
        schemaOrBuilder: TNewBody | ((current: ExtractOutputBody<TPlugin, TData>) => TNewBody),
    ): OutputSchemaProxy<DetailedOutput<ExtractOutputStatus<TPlugin, TData>, ExtractOutputHeaders<TPlugin, TData>, AnySchema, TPlugin>, TMethod, TEntitySchema, TErrors, TPlugin> {
        const detailed = isDetailedMode(this.$data);
        const currentBody = detailed ? this._extractBody() : this._defaultBody();
        const baseSchema = typeof schemaOrBuilder === "function" ? (schemaOrBuilder)(currentBody) : schemaOrBuilder;
        const streamedBody = eventIterator(baseSchema) as AnySchema;
        const status = detailed ? this._extractStatus() : this._defaultStatus();
        const headers = detailed ? this._extractHeaders() : this._defaultHeaders();
        const built = this._buildDetailedSchema(status, headers, streamedBody);
        return this._create(built);
    }

    /**
     * Wrap body as Observable contract output.
     */
    observable<TNewBody extends AnySchema>(
        schema: TNewBody,
    ): OutputSchemaProxy<DetailedOutput<ExtractOutputStatus<TPlugin, TData>, ExtractOutputHeaders<TPlugin, TData>, ObservableContractSchema<TNewBody>, TPlugin>, TMethod, TEntitySchema, TErrors, TPlugin>;
    observable<TNewBody extends AnySchema>(
        builder: (current: ExtractOutputBody<TPlugin, TData>) => TNewBody,
    ): OutputSchemaProxy<DetailedOutput<ExtractOutputStatus<TPlugin, TData>, ExtractOutputHeaders<TPlugin, TData>, ObservableContractSchema<TNewBody>, TPlugin>, TMethod, TEntitySchema, TErrors, TPlugin>;
    observable<TNewBody extends AnySchema>(
        schemaOrBuilder: TNewBody | ((current: ExtractOutputBody<TPlugin, TData>) => TNewBody),
    ): OutputSchemaProxy<DetailedOutput<ExtractOutputStatus<TPlugin, TData>, ExtractOutputHeaders<TPlugin, TData>, ObservableContractSchema<TNewBody>, TPlugin>, TMethod, TEntitySchema, TErrors, TPlugin> {
        const detailed = isDetailedMode(this.$data);
        const currentBody = detailed ? this._extractBody() : this._defaultBody();
        const baseSchema = typeof schemaOrBuilder === "function" ? (schemaOrBuilder)(currentBody) : schemaOrBuilder;
        const observableBody = observable(baseSchema as Schema<unknown, unknown>) as ObservableContractSchema<TNewBody>;
        const status = detailed ? this._extractStatus() : this._defaultStatus();
        const headers = detailed ? this._extractHeaders() : this._defaultHeaders();
        const built = this._buildDetailedSchema(status, headers, observableBody);
        return this._create(built);
    }

    /**
     * OpenAPI-friendly no-op, kept for fluent symmetry.
     */
    description(_description: string): this {
        void _description;
        return this;
    }

    /**
     * Apply custom body transformation.
     */
    custom<TNewBody extends AnySchema>(
        modifier: (body: ExtractOutputBody<TPlugin, TData>) => TNewBody,
    ): OutputSchemaProxy<DetailedOutput<ExtractOutputStatus<TPlugin, TData>, ExtractOutputHeaders<TPlugin, TData>, TNewBody, TPlugin>, TMethod, TEntitySchema, TErrors, TPlugin> {
        const detailed = isDetailedMode(this.$data);
        const currentBody = detailed ? this._extractBody() : this._defaultBody();
        const newBody = modifier(currentBody);
        const status = detailed ? this._extractStatus() : this._defaultStatus();
        const headers = detailed ? this._extractHeaders() : this._defaultHeaders();
        const built = this._buildDetailedSchema(status, headers, newBody);
        return this._create(built);
    }

    /**
     * Build response union from a list of raw schemas and/or output builders.
     */
    union<
        TItems extends readonly [
            AnySchema | OutputSchemaProxy<AnySchema | DetailedOutput, TMethod, TEntitySchema, TErrors, TPlugin>,
            ...(AnySchema | OutputSchemaProxy<AnySchema | DetailedOutput, TMethod, TEntitySchema, TErrors, TPlugin>)[],
        ],
    >(items: TItems): OutputSchemaProxy<AnySchema, TMethod, TEntitySchema, TErrors, TPlugin>;
    union(
        items: readonly [
            AnySchema | OutputSchemaProxy<AnySchema | DetailedOutput, TMethod, TEntitySchema, TErrors, TPlugin>,
            ...(AnySchema | OutputSchemaProxy<AnySchema | DetailedOutput, TMethod, TEntitySchema, TErrors, TPlugin>)[],
        ],
    ): OutputSchemaProxy<AnySchema, TMethod, TEntitySchema, TErrors, TPlugin> {
        const schemas = items.map((item) => {
            const maybeBuilder = item as { _build?: () => AnySchema };
            if (typeof maybeBuilder._build === "function") {
                return maybeBuilder._build();
            }
            return item;
        }) as AnySchema[];

        if (schemas.length < 2) {
            const single = schemas[0] ?? this._plugin.voidSchema();
            return this._create(single);
        }

        const unified = this._plugin.union(schemas as unknown as UnionTuple);
        return this._create(unified);
    }

    /** @internal Final schema emission for route builder wiring. */
    _build(): TData {
        return this.$data;
    }
}
