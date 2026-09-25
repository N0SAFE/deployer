 
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Type utilities for inferring properties from ORPC builders and contracts.
 * These helpers provide type-safe access to ORPC's internal type system.
 * 
 * NOTE: This file requires `any` types to match ORPC's type constraints.
 * ORPC's ContractBuilder/ContractProcedure types use `any` as generic bounds
 * to accept any Zod schema type. Using `unknown` breaks ORPC's type system.
 */

import {
  type ProcedureContract,
  type ContractBuilder,
  type ProcedureContractBuilderWithInput,
  type ProcedureContractBuilderWithOutput,
  type ProcedureContractBuilderWithInputOutput,
  type AnyProcedureContract,
} from "@orpc/contract";
import type { OpenAPIMeta } from "@orpc/openapi";

/**
 * Union type of all possible ORPC contract builder types.
 * Includes base builder and all specialized builders (with input, output, or both).
 *
 * oRPC v2 renamed `ContractProcedure` to `ProcedureContract` and shrank
 * `ContractBuilder` to a single generic (`<TErrorMap>`).
 */
export type AnyContractBuilder =
  | ContractBuilder<any>
  | ProcedureContractBuilderWithInput<any, any>
  | ProcedureContractBuilderWithOutput<any, any>
  | ProcedureContractBuilderWithInputOutput<any, any, any>;

/**
 * Union type representing any ORPC procedure or builder.
 * Can be used to accept both finalized procedures and builders in progress.
 */
export type AnyContractProcedureOrBuilder =
  | AnyProcedureContract
  | AnyContractBuilder;

/**
 * Type guard to check if a value is an ORPC procedure contract.
 * A procedure contract has the `~orpc` property with defined options.
 *
 * In v2 the `~orpc` payload holds `inputSchemas`/`outputSchemas` (arrays) rather
 * than v1's singular `inputSchema`/`outputSchema`.
 *
 * NOTE: v1's `isContractProcedure` export is gone, and v2's
 * `getProcedureContractOrThrow(router, path)` is a router-path LOOKUP (it needs
 * both arguments and throws on a miss), not a shape check — so this predicate
 * inspects the `~orpc` descriptor directly.
 */
export function isContractProcedure(
  value: unknown
): value is ProcedureContract<any, any, any> {
  return (
    typeof value === "object" &&
    value !== null &&
    "~orpc" in value &&
    typeof value["~orpc"] === "object" &&
    value["~orpc"] !== null
  );
}

/**
 * Type guard to check if a value is an ORPC procedure contract builder.
 * Builders have the `~orpc` property and builder methods like `input`, `output`, etc.
 */
export function isContractBuilder(value: unknown): value is AnyContractBuilder {
  return (
    isContractProcedure(value) &&
    typeof value === "object" &&
    ("input" in value || "output" in value || "meta" in value)
  );
}

/**
 * Type guard to check if a value is a router contract builder.
 * Router builders have the `~orpc` property with `errorMap` and the `router` method.
 *
 * oRPC v2 dropped the exported `ContractRouterBuilder` type, so the shape is
 * described structurally here.
 */
export function isContractRouterBuilder(
  value: unknown
): value is { "~orpc": { errorMap: unknown }; router: (...args: never[]) => unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "~orpc" in value &&
    typeof value["~orpc"] === "object" &&
    value["~orpc"] !== null &&
    "errorMap" in value["~orpc"] &&
    "router" in value
  );
}

/**
 * Extract the meta type from an ORPC procedure or builder.
 *
 * v2 dropped the meta generic from `ProcedureContract` (routing moved into
 * `meta`), so the meta is read structurally rather than via inference.
 */
export type InferMeta<T extends AnyContractProcedureOrBuilder> =
  T extends { "~orpc": { meta: infer TMeta } } ? TMeta : never;

/**
 * Extract the input schema type from an ORPC procedure or builder.
 *
 * v2 carries the schema types on the `__TInputSchema` phantom field.
 */
export type InferInputSchema<T extends AnyContractProcedureOrBuilder> =
  T extends { "~orpc": { __TInputSchema?: { type: infer TInputSchema } } }
    ? TInputSchema
    : never;

/**
 * Extract the output schema type from an ORPC procedure or builder.
 */
export type InferOutputSchema<T extends AnyContractProcedureOrBuilder> =
  T extends { "~orpc": { __TOutputSchema?: { type: infer TOutputSchema } } }
    ? TOutputSchema
    : never;

/**
 * Extract the error map type from an ORPC procedure or builder.
 */
export type InferErrorMap<T extends AnyContractProcedureOrBuilder> =
  T extends ProcedureContract<any, any, infer TErrorMap> ? TErrorMap : never;

/**
 * Helper to get the meta property from an ORPC procedure at runtime.
 * Returns the meta object if the value is a valid procedure, undefined otherwise.
 * @template T - The procedure or builder type to infer meta from
 */
export function getProcedureMeta<T extends AnyContractProcedureOrBuilder>(
  procedure: T
): InferMeta<T> | undefined {
  if (!isContractProcedure(procedure)) {
    return undefined;
  }
  return procedure["~orpc"].meta as InferMeta<T>;
}

/**
 * Helper to get the OpenAPI routing metadata from an ORPC procedure.
 *
 * v2 removed the `~orpc.route` field entirely: routing now lives in the
 * `~openapi` meta produced by `.meta(openapi({...}))`. This reads that meta so
 * call sites that used `getProcedureRoute()` keep working unchanged.
 */
export function getProcedureRoute<T extends AnyContractProcedureOrBuilder>(
  procedure: T
): OpenAPIMeta | undefined {
  if (!isContractProcedure(procedure)) {
    return undefined;
  }
  const meta = procedure["~orpc"].meta as Record<string, unknown> | undefined;
  return meta?.["~openapi"] as OpenAPIMeta | undefined;
}

/**
 * Helper to get the error map from an ORPC procedure at runtime.
 * Returns the error map if the value is a valid procedure, undefined otherwise.
 * @template T - The procedure or builder type to infer error map from
 */
export function getProcedureErrorMap<T extends AnyContractProcedureOrBuilder>(
  procedure: T
): InferErrorMap<T> | undefined {
  if (!isContractProcedure(procedure)) {
    return undefined;
  }
  return procedure["~orpc"].errorMap as InferErrorMap<T>;
}

/**
 * Helper to get the input schema from an ORPC procedure at runtime.
 *
 * v2 stores schemas as arrays (`inputSchemas`). The builder applies exactly one
 * input schema, so the first entry is the procedure's input schema; stacking
 * `.input()` calls would compose them, which this repo does not do.
 */
export function getProcedureInputSchema<T extends AnyContractProcedureOrBuilder>(
  procedure: T
): InferInputSchema<T> | undefined {
  if (!isContractProcedure(procedure)) {
    return undefined;
  }
  const schemas = procedure["~orpc"].inputSchemas;
  return schemas?.[0] as InferInputSchema<T> | undefined;
}

/**
 * Helper to get the output schema from an ORPC procedure at runtime.
 * Returns the output schema if the value is a valid procedure, undefined otherwise.
 * @template T - The procedure or builder type to infer output schema from
 */
export function getProcedureOutputSchema<T extends AnyContractProcedureOrBuilder>(
  procedure: T
): InferOutputSchema<T> | undefined {
  if (!isContractProcedure(procedure)) {
    return undefined;
  }
  const schemas = procedure["~orpc"].outputSchemas;
  return schemas?.[0] as InferOutputSchema<T> | undefined;
}

/**
 * Apply meta to a builder with proper typing.
 *
 * oRPC v2 removed the meta generic from the builder types: `.meta()` now takes
 * `MetaPlugin` objects (not raw meta), and the plugin's `init` hook is what
 * writes into the contract's `~orpc.meta`. The builder type is therefore
 * unchanged by `.meta()`, so this helper is a typed pass-through.
 *
 * `resolveMetaPlugins` runs `init` for every *incoming* plugin against the
 * already-merged meta, so spreading accumulates across successive calls.
 *
 * @template TBuilder - The builder type
 * @template TMeta - The meta object type
 * @param builder - The ORPC builder to add meta to
 * @param meta - The meta object to apply
 * @returns A new builder with the meta applied
 *
 * @example
 * const procedure = withMeta(
 *   oc.input(z.object({ id: z.string() })),
 *   { httpMethod: "GET", path: "/users/:id" }
 * );
 */
export function withMeta<
  TBuilder extends AnyContractBuilder,
  TMeta extends Record<string, any>
>(builder: TBuilder, meta: TMeta): TBuilder {
  return builder.meta({
    name: "with-meta",
    init: (current) => ({ ...current, ...meta }),
  }) as TBuilder;
}
