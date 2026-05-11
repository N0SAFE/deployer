import z from "zod/v4";

// ─── States ───────────────────────────────────────────────────────────────────

export const setupStateSchema = z.enum([
    "not_started",
    "awaiting_strategy",
    "awaiting_credentials",
    "awaiting_remote_auth",
    "provisioning",
    "completed",
]);
export type SetupState = z.infer<typeof setupStateSchema>;

// ─── Steps ────────────────────────────────────────────────────────────────────

export const setupStepIdSchema = z.enum([
    "choose_strategy",
    "configure_account",
    "remote_auth",
    "provision_database",
    "run_migrations",
    "seed_initial_data",
    "mesh_handshake",
    "register_node",
    "finalize",
]);
export type SetupStepId = z.infer<typeof setupStepIdSchema>;

export const setupBootstrapStrategySchema = z.enum(["local", "remote"]);
export type SetupBootstrapStrategy = z.infer<typeof setupBootstrapStrategySchema>;

export const setupStepStatusSchema = z.enum([
    "pending",
    "in_progress",
    "completed",
    "failed",
    "skipped",
]);
export type SetupStepStatus = z.infer<typeof setupStepStatusSchema>;

export const setupStepSchema = z.object({
    id: setupStepIdSchema,
    title: z.string().min(1),
    status: setupStepStatusSchema,
    description: z.string().optional(),
    logs: z.array(z.string()).optional(),
    durationMs: z.number().optional(),
});
export type SetupStep = z.infer<typeof setupStepSchema>;

export const setupStateSnapshotSchema = z.object({
    state: setupStateSchema,
    needsSetup: z.boolean(),
    strategy: setupBootstrapStrategySchema.nullable(),
    currentStep: setupStepIdSchema.nullable(),
    progressPercent: z.number().int().min(0).max(100),
    steps: z.array(setupStepSchema),
    completedAt: z.date().nullable(),
});
export type SetupStateSnapshot = z.infer<typeof setupStateSnapshotSchema>;

// ─── Initialize input ─────────────────────────────────────────────────────────

export const setupInitializeLocalInputSchema = z.object({
    strategy: z.literal("local"),
    name: z.string().min(1),
    email: z.email(),
    password: z.string().min(8),
    organizationName: z.string().min(1),
    existingDatabaseUrl: z.string().optional(),
});
export type SetupInitializeLocalInput = z.infer<typeof setupInitializeLocalInputSchema>;

export const setupInitializeRemoteInputSchema = z.object({
    strategy: z.literal("remote"),
    meshUrl: z.url(),
    authToken: z.string().min(1),
});
export type SetupInitializeRemoteInput = z.infer<typeof setupInitializeRemoteInputSchema>;

export const setupInitializeInputSchema = z.discriminatedUnion("strategy", [
    setupInitializeLocalInputSchema,
    setupInitializeRemoteInputSchema,
]);
export type SetupInitializeInput = z.infer<typeof setupInitializeInputSchema>;

// ─── SSE stream events ────────────────────────────────────────────────────────

export const setupProgressEventTypeSchema = z.enum([
    "step_start",
    "step_pending",
    "step_complete",
    "step_failed",
    "completed",
    "error",
]);
export type SetupProgressEventType = z.infer<typeof setupProgressEventTypeSchema>;

/**
 * Each event yielded over the SSE stream.
 *
 * - step_start    : a step just began
 * - step_pending      : a log line within a running step
 * - step_complete : a step finished successfully
 * - step_failed   : a step failed (may be followed by error)
 * - completed     : the whole setup finished — payload contains the final result
 * - error         : fatal error, stream closes after this
 */
export const setupStreamEventSchema = z.discriminatedUnion("type", [
    z.object({
        type:    z.literal("step_start"),
        stepId:  setupStepIdSchema,
        title:   z.string(),
    }),
    z.object({
        type:    z.literal("step_pending"),
        stepId:  setupStepIdSchema,
        log:     z.string(),
    }),
    z.object({
        type:      z.literal("step_complete"),
        stepId:    setupStepIdSchema,
        durationMs: z.number(),
    }),
    z.object({
        type:      z.literal("step_failed"),
        stepId:    setupStepIdSchema,
        error:     z.string(),
        durationMs: z.number(),
    }),
    z.object({
        type:   z.literal("completed"),
        result: z.object({
            nodeId:       z.uuid(),
            strategy:     setupBootstrapStrategySchema,
            databaseUrl:  z.string(),
            completedAt:  z.date(),
        }),
    }),
    z.object({
        type:    z.literal("error"),
        message: z.string(),
    }),
]);
export type SetupStreamEvent = z.infer<typeof setupStreamEventSchema>;

// ─── Initialize result (final value after stream) ─────────────────────────────

export const setupInitializeLocalResultSchema = z.object({
    strategy:     z.literal("local"),
    nodeId:       z.uuid(),
    databaseUrl:  z.string(),
    user:         z.object({ id: z.string(), name: z.string(), email: z.string() }),
    organization: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
});
export type SetupInitializeLocalResult = z.infer<typeof setupInitializeLocalResultSchema>;

export const setupInitializeRemoteResultSchema = z.object({
    strategy:    z.literal("remote"),
    nodeId:      z.uuid(),
    meshUrl:     z.string(),
    databaseUrl: z.string(),
});
export type SetupInitializeRemoteResult = z.infer<typeof setupInitializeRemoteResultSchema>;

export const setupInitializeResultSchema = z.discriminatedUnion("strategy", [
    setupInitializeLocalResultSchema,
    setupInitializeRemoteResultSchema,
]);
export type SetupInitializeResult = z.infer<typeof setupInitializeResultSchema>;

// ─── Probe schemas ────────────────────────────────────────────────────────────

export const setupProbeDbInputSchema = z.object({
    databaseUrl: z.string().min(1),
});
export type SetupProbeDbInput = z.infer<typeof setupProbeDbInputSchema>;

export const setupProbeDbResultSchema = z.object({
    reachable:  z.boolean(),
    latencyMs:  z.number().optional(),
    error:      z.string().optional(),
});
export type SetupProbeDbResult = z.infer<typeof setupProbeDbResultSchema>;

export const setupProbeMeshInputSchema = z.object({
    meshUrl: z.url(),
});
export type SetupProbeMeshInput = z.infer<typeof setupProbeMeshInputSchema>;

export const setupProbeMeshResultSchema = z.object({
    reachable:  z.boolean(),
    nodeId:     z.string().optional(),
    version:    z.string().optional(),
    latencyMs:  z.number().optional(),
    error:      z.string().optional(),
});
export type SetupProbeMeshResult = z.infer<typeof setupProbeMeshResultSchema>;

// ─── Remote mock auth ─────────────────────────────────────────────────────────

export const setupRemoteAuthInputSchema = z.object({
    meshUrl:  z.url(),
    username: z.string().min(1),
    password: z.string().min(1),
});
export type SetupRemoteAuthInput = z.infer<typeof setupRemoteAuthInputSchema>;

export const setupRemoteAuthResultSchema = z.object({
    authToken: z.string(),
    userId:    z.string(),
    email:     z.string(),
    meshUrl:   z.string(),
});
export type SetupRemoteAuthResult = z.infer<typeof setupRemoteAuthResultSchema>;

// ─── Node config status ───────────────────────────────────────────────────────

export const nodeConfigStatusSchema = z.object({
    isConfigured:       z.boolean(),
    nodeId:             z.uuid().nullable(),
    strategy:           setupBootstrapStrategySchema.nullable(),
    meshUrlsSnapshot:   z.array(z.string()),
    configuredAt:       z.date().nullable(),
});
export type NodeConfigStatus = z.infer<typeof nodeConfigStatusSchema>;

