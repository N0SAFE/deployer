/**
 * Output proxy layer.
 *
 * Keeps RouteBuilder-specific wiring minimal while the heavy output-building
 * behavior lives in `./builder.ts`.
 */

 
import type { AnySchema, HTTPMethod, ErrorMap } from "../../types/types";
import type { VoidSchema } from "../../types/standard-schema-helpers";
import { StandardPluginTransformer } from "../plugin";
import type { BasePluginTransformer } from "../plugin";
import type { RouteBuilder, DetailedOutput } from "../core/route-builder";
import { DetailedOutputBuilder } from "./builder";

export {
    type ExtractOutputBody,
    type ExtractOutputStatus,
    type ExtractOutputHeaders,
    type OutputSchemaProxySchema,
    isDetailedMode,
    DetailedOutputBuilder,
} from "./builder";

/**
 * Route-aware output schema proxy.
 *
 * This class only provides:
 * - access to RouteBuilder context (`entitySchema`),
 * - immutable proxy creation hook (`_create`).
 *
 * All output mutation/union logic is inherited from `DetailedOutputBuilder`.
 */
export class OutputSchemaProxy<
    TData extends AnySchema | DetailedOutput = VoidSchema,
    TMethod extends HTTPMethod = "GET",
    TEntitySchema extends AnySchema = VoidSchema,
    TErrors extends ErrorMap = Record<string, never>,
    TPlugin extends BasePluginTransformer = StandardPluginTransformer,
> extends DetailedOutputBuilder<TData, TMethod, TEntitySchema, TErrors, TPlugin> {
    readonly _routeBuilder: RouteBuilder<AnySchema, AnySchema, TMethod, TEntitySchema, TErrors, TPlugin>;

    constructor(routeBuilder: RouteBuilder<AnySchema, AnySchema, TMethod, TEntitySchema, TErrors, TPlugin>, data: TData) {
        super(data, routeBuilder.getPlugin());
        this._routeBuilder = routeBuilder;
    }

    /** Create next immutable proxy instance with updated output state. */
    protected _create<TNewData extends AnySchema | DetailedOutput>(data: TNewData): OutputSchemaProxy<TNewData, TMethod, TEntitySchema, TErrors, TPlugin> {
        return new OutputSchemaProxy(this._routeBuilder, data);
    }

    /** Expose entity schema from route context. */
    protected _getEntitySchema(): TEntitySchema {
        return this._routeBuilder.getEntitySchema();
    }
}

/**
 * Create an output proxy from a RouteBuilder instance.
 */
export function createOutputSchemaProxy<
    TOutput extends AnySchema | DetailedOutput,
    TMethod extends HTTPMethod,
    TEntitySchema extends AnySchema,
    TErrors extends ErrorMap,
    TPlugin extends BasePluginTransformer,
>(
    routeBuilder: RouteBuilder<AnySchema, TOutput, TMethod, TEntitySchema, TErrors, TPlugin>,
): OutputSchemaProxy<TOutput, TMethod, TEntitySchema, TErrors, TPlugin> {
    const rb = routeBuilder as unknown as RouteBuilder<AnySchema, AnySchema, TMethod, TEntitySchema, TErrors, TPlugin>;
    const data = routeBuilder.getOutputSchema();
    return new OutputSchemaProxy<TOutput, TMethod, TEntitySchema, TErrors, TPlugin>(rb, data);
}
