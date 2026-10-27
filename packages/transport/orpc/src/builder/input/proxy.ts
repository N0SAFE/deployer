 
import type { AnySchema } from "@deployer/orpc-utils/types/types";
import type { VoidSchema } from "@deployer/orpc-utils/types/standard-schema-helpers";
import type { BasePluginTransformer } from "@deployer/orpc-utils/builder/plugin/index";
import { StandardPluginTransformer } from "@deployer/orpc-utils/builder/plugin/index";
import { DetailedInputBuilder } from "@deployer/orpc-utils/builder/input/builder";
import type { DetailedInputBuilderSchema } from "@deployer/orpc-utils/builder/input/builder";

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
