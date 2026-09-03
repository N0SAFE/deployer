/**
 * Schema transformer plugin system.
 *
 * Inject how the RouteBuilder CONSTRUCTS and INTROSPECTS schemas:
 *
 * ```typescript
 * // Default — today's Standard Schema behavior (zero migration):
 * const c = new RouteBuilder({ method: "POST", path: "/x" })
 *   .input((b) => b.body(z.object({ ... })))
 *   .build();
 *
 * // Opt-in — everything is REAL Zod from the start:
 * const c = new RouteBuilder({ use: new ZodPluginTransformer(), method: "POST", path: "/x" })
 *   .input((b) => b.body(z.object({ ... })).headers(z.object({ ... }).optional()))
 *   .build();
 * // InferInputSchema<typeof c> is a z.ZodObject — z.infer works.
 * ```
 *
 * Each plugin namespaces its TYPE-LEVEL schema ops under `$Infer` (see
 * `base.ts`'s `PluginInfer`), so the core resolves schema types via
 * `PluginOp<TP, "Field", T>` — no branching on the plugin's identity.
 * Adding a new validation library = new plugin class + `$Infer` interface.
 */

export { BasePluginTransformer, type PluginInfer, type InferOf, type IsPluginZod } from "./base";
export { StandardPluginTransformer, type StandardPluginInfer } from "./standard";
export { ZodPluginTransformer, type ZodPluginInfer, type ZodShapeField } from "./zod";
export type {
    PluginEmptyObject,
    PluginVoid,
    PluginOptional,
    PluginField,
    PluginObjectSchema,
    IsPluginEmptyPart,
    PluginIsEmptyObjectSchemaType,
    PluginBuiltDetailedInput,
    PluginDetailedOutput,
    PluginDetectDetailedOutput,
    PluginBrandedInputParts,
    PluginBuildInput,
    PluginBuildOutput,
    PluginParamsShapeOf,
    PluginExtractOutputBody,
    PluginExtractOutputStatus,
    PluginExtractOutputHeaders,
    PluginOutputProxySchema,
    IsPluginZod as IsPluginZodType,
} from "./types";
