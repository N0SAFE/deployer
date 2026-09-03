/**
 * Runtime Runner Options Schema — SSOT lives in @repo/contracts-entities
 * (entities/deployment/runtime-runner-options.schema.ts) as a discriminated
 * union on `runner`. This file re-exports it for local consumers.
 */
export {
    dockerRuntimeRunnerOptionsSchema,
    dockerfileRuntimeRunnerOptionsSchema,
    dockerComposeRuntimeRunnerOptionsSchema,
    nixpacksRuntimeRunnerOptionsSchema,
    buildpackRuntimeRunnerOptionsSchema,
    railpackRuntimeRunnerOptionsSchema,
    runtimeRunnerOptionsSchema,
    resolveRuntimeRunnerKind,
    RUNTIME_RUNNER_KINDS,
    type RuntimeRunnerKind,
    type RuntimeRunnerOptions,
} from "@repo/contracts-entities";
