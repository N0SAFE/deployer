/**
 * Runtime Runner Options Schema — SSOT lives in @deployer/contracts-entities
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
} from "@deployer/contracts-entities";
