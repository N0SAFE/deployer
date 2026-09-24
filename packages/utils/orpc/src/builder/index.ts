// V2 Builder exports (primary)
export { RouteBuilder, route } from "@repo/orpc-utils/builder/core/route-builder";
export { DetailedInputBuilder, createDetailedInputBuilder } from "@repo/orpc-utils/builder/input/builder";
export { InputSchemaProxy, type InputSchemaProxySchema } from "@repo/orpc-utils/builder/input/proxy";
export { DetailedOutputBuilder } from "@repo/orpc-utils/builder/output/builder";
export { OutputSchemaProxy, type OutputSchemaProxySchema } from "@repo/orpc-utils/builder/output/proxy";
export { ErrorDefinitionBuilder, error } from "@repo/orpc-utils/builder/core/error-builder";
export { createPathParamBuilder, type PathParam, type PathParamBuilder, type PathParamBuilderWithExisting } from "@repo/orpc-utils/builder/core/params-builder";
// Schema transformer plugin system
// RouteBuilder({ use: new ZodPluginTransformer(), ... }) → real Zod contracts from the start.
export * from "@repo/orpc-utils/builder/plugin/index";
export * from "@repo/orpc-utils/types/types";
export * from "@repo/orpc-utils/types/standard-schema-helpers";
export * from "@repo/orpc-utils/types/route-method-meta";
