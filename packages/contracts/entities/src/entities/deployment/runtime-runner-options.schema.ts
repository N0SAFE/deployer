/**
 * Runtime Runner Options Schema — SSOT for per-runner execution options.
 *
 * DISCRIMINATED UNION on `runner`: every runner kind has its exact member
 * type — you can no longer set `dockerfile` AND `railpack` on the same
 * object. Shared "execution-level" fields (containerName, networkMode,
 * convergence, health-gate, startupCommand) exist on EVERY member so
 * cross-runner consumers can read them without narrowing; runner-specific
 * nested options exist ONLY on their own member.
 *
 * Shared by the providers module (checkout contexts), the deployment queue
 * processor and the deployment execution workflow.
 */
import z from "zod/v4";
import { runnerNetworkModeSchema } from "@repo/contracts-common";

// ─── Execution-level fields shared by every runner kind ────────────────────

const executionLevelOptionsShape = {
    containerName: z.string().min(1).optional(),
    networkMode: runnerNetworkModeSchema.optional(),
    cpuShares: z.number().positive().optional(),
    memoryLimitBytes: z.number().positive().optional(),
    healthCheckUrl: z.string().min(1).optional(),
    healthCheckMaxRetries: z.number().int().positive().optional(),
    healthCheckRetryIntervalMs: z.number().int().positive().optional(),
    traefikSyncMaxAttempts: z.number().int().positive().optional(),
    convergenceRetryBaseDelayMs: z.number().int().positive().optional(),
    startupCommand: z.string().min(1).optional(),
} as const;

// ─── Runner-specific nested options (one per runner kind) ──────────────────

const dockerfileAdvancedSchema = z
    .object({
        containerName: z.string().min(1).optional(),
    })
    .strict();

const dockerComposeAdvancedSchema = z
    .object({
        containerName: z.string().min(1).optional(),
        networkMode: runnerNetworkModeSchema.optional(),
        profiles: z.array(z.string().min(1)).min(1).optional(),
    })
    .strict();

const nixpacksAdvancedSchema = z
    .object({
        cpuShares: z.number().positive().optional(),
    })
    .strict();

const buildpackAdvancedSchema = z
    .object({
        memoryLimitBytes: z.number().positive().optional(),
        builder: z.string().min(1).optional(),
    })
    .strict();

const railpackAdvancedSchema = z
    .object({
        healthCheckUrl: z.string().min(1).optional(),
        startupCommand: z.string().min(1).optional(),
    })
    .strict();

// ─── Union members — one per runner kind (plain objects, NO .extend()) ─────

export const dockerRuntimeRunnerOptionsSchema = z
    .object({
        runner: z.literal("docker"),
        ...executionLevelOptionsShape,
    })
    .strict();

export const dockerfileRuntimeRunnerOptionsSchema = z
    .object({
        runner: z.literal("dockerfile"),
        ...executionLevelOptionsShape,
        dockerfile: dockerfileAdvancedSchema.optional(),
    })
    .strict();

export const dockerComposeRuntimeRunnerOptionsSchema = z
    .object({
        runner: z.literal("docker_compose"),
        ...executionLevelOptionsShape,
        dockerCompose: dockerComposeAdvancedSchema.optional(),
    })
    .strict();

export const nixpacksRuntimeRunnerOptionsSchema = z
    .object({
        runner: z.literal("nixpacks"),
        ...executionLevelOptionsShape,
        nixpacks: nixpacksAdvancedSchema.optional(),
    })
    .strict();

export const buildpackRuntimeRunnerOptionsSchema = z
    .object({
        runner: z.literal("buildpack"),
        ...executionLevelOptionsShape,
        buildpack: buildpackAdvancedSchema.optional(),
    })
    .strict();

export const railpackRuntimeRunnerOptionsSchema = z
    .object({
        runner: z.literal("railpack"),
        ...executionLevelOptionsShape,
        railpack: railpackAdvancedSchema.optional(),
    })
    .strict();

// ─── The discriminated union — SSOT dispatch type ──────────────────────────

export const runtimeRunnerOptionsSchema = z.discriminatedUnion("runner", [
    dockerRuntimeRunnerOptionsSchema,
    dockerfileRuntimeRunnerOptionsSchema,
    dockerComposeRuntimeRunnerOptionsSchema,
    nixpacksRuntimeRunnerOptionsSchema,
    buildpackRuntimeRunnerOptionsSchema,
    railpackRuntimeRunnerOptionsSchema,
]);

export type RuntimeRunnerOptions = z.infer<typeof runtimeRunnerOptionsSchema>;

export const RUNTIME_RUNNER_KINDS = [
    "docker",
    "dockerfile",
    "docker_compose",
    "nixpacks",
    "buildpack",
    "railpack",
] as const;
export type RuntimeRunnerKind = (typeof RUNTIME_RUNNER_KINDS)[number];

/**
 * Resolve a loose runner-kind string into a valid kind, defaulting to
 * "docker" (the base runner) when the value is empty or unknown.
 */
export function resolveRuntimeRunnerKind(
    value: string | null | undefined,
): RuntimeRunnerKind {
    const normalized = (value ?? "").trim().toLowerCase() as RuntimeRunnerKind;
    return (RUNTIME_RUNNER_KINDS as readonly string[]).includes(normalized)
        ? normalized
        : "docker";
}
