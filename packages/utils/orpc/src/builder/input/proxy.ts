 
import type { AnySchema } from "../../types/types";
import type { VoidSchema } from "../../types/standard-schema-helpers";
import type { BasePluginTransformer } from "../plugin";
import { StandardPluginTransformer } from "../plugin";
import { DetailedInputBuilder } from "./builder";
import type { DetailedInputBuilderSchema } from "./builder";

export type InputSchemaProxySchema<
    TPlugin extends BasePluginTransformer,
    TParams extends AnySchema,
    TQuery extends AnySchema,
    TBody extends AnySchema,
    THeaders extends AnySchema,
> = DetailedInputBuilderSchema<TPlugin, TParams, TQuery, TBody, THeaders>;

export class InputSchemaProxy<
    TParams extends AnySchema = VoidSchema,
    TQuery extends AnySchema = VoidSchema,
    TBody extends AnySchema = VoidSchema,
    THeaders extends AnySchema = VoidSchema,
    TEntitySchema extends AnySchema = VoidSchema,
    TPlugin extends BasePluginTransformer = StandardPluginTransformer,
> extends DetailedInputBuilder<TParams, TQuery, TBody, THeaders, TEntitySchema, TPlugin> {
    override get schema(): InputSchemaProxySchema<TPlugin, TParams, TQuery, TBody, THeaders> {
        return super.schema;
    }
}
