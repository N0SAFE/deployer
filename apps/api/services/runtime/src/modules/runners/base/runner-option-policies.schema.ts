/**
 * Runner Option Policies — SSOT lives in @repo/contracts-entities
 * (entities/deployment/runtime-runner-options.schema.ts), a discriminated
 * union on `runner`. This file re-exports the per-runner member schemas so
 * the runner services keep their precise per-runner validation.
 */
import {
    dockerRuntimeRunnerOptionsSchema,
    dockerfileRuntimeRunnerOptionsSchema,
    dockerComposeRuntimeRunnerOptionsSchema,
    nixpacksRuntimeRunnerOptionsSchema,
    buildpackRuntimeRunnerOptionsSchema,
    railpackRuntimeRunnerOptionsSchema,
    runtimeRunnerOptionsSchema,
    type RuntimeRunnerOptions,
} from "@repo/contracts-entities";

export {
    dockerRuntimeRunnerOptionsSchema,
    dockerfileRuntimeRunnerOptionsSchema,
    dockerComposeRuntimeRunnerOptionsSchema,
    nixpacksRuntimeRunnerOptionsSchema,
    buildpackRuntimeRunnerOptionsSchema,
    railpackRuntimeRunnerOptionsSchema,
    runtimeRunnerOptionsSchema,
    type RuntimeRunnerOptions,
};

export type DockerfileRunnerOptions = RuntimeRunnerOptions;
export type DockerComposeRunnerOptions = RuntimeRunnerOptions;
export type NixpacksRunnerOptions = RuntimeRunnerOptions;
export type BuildpackRunnerOptions = RuntimeRunnerOptions;
export type RailpackRunnerOptions = RuntimeRunnerOptions;

// Backward-friendly aliases used by the runner services' per-runner validation.
export const dockerRunnerOptionsSchema = dockerRuntimeRunnerOptionsSchema;
export const dockerfileRunnerOptionsSchema = dockerfileRuntimeRunnerOptionsSchema;
export const dockerComposeRunnerOptionsSchema = dockerComposeRuntimeRunnerOptionsSchema;
export const nixpacksRunnerOptionsSchema = nixpacksRuntimeRunnerOptionsSchema;
export const buildpackRunnerOptionsSchema = buildpackRuntimeRunnerOptionsSchema;
export const railpackRunnerOptionsSchema = railpackRuntimeRunnerOptionsSchema;
