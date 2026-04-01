import z from "zod/v4";

export const setupStateSchema = z.enum([
    "not_started",
    "awaiting_db_config",
    "awaiting_initial_admin",
    "initial_admin_created",
    "completed",
]);
export type SetupState = z.infer<typeof setupStateSchema>;

export const setupStepIdSchema = z.enum([
    "configure_database",
    "check_prerequisites",
    "choose_bootstrap_strategy",
    "connect_remote_instance",
    "verify_remote_handshake",
    "create_initial_user",
    "create_initial_organization",
    "assign_owner_membership",
    "finalize",
]);
export type SetupStepId = z.infer<typeof setupStepIdSchema>;

export const setupBootstrapStrategySchema = z.enum(["local_instance", "remote_instance"]);
export type SetupBootstrapStrategy = z.infer<typeof setupBootstrapStrategySchema>;

export const setupStepStatusSchema = z.enum(["pending", "in_progress", "completed", "blocked", "skipped"]);
export type SetupStepStatus = z.infer<typeof setupStepStatusSchema>;

export const setupStepSchema = z.object({
    id: setupStepIdSchema,
    title: z.string().min(1),
    status: setupStepStatusSchema,
    description: z.string().min(1).optional(),
});
export type SetupStep = z.infer<typeof setupStepSchema>;

export const setupStateSnapshotSchema = z.object({
    state: setupStateSchema,
    needsSetup: z.boolean(),
    hasUsers: z.boolean(),
    hasOrganizations: z.boolean(),
    bootstrapStrategy: setupBootstrapStrategySchema.nullable(),
    availableStrategies: z.array(setupBootstrapStrategySchema),
    currentStep: setupStepIdSchema.nullable(),
    progressPercent: z.number().int().min(0).max(100),
    steps: z.array(setupStepSchema),
    completedAt: z.string().datetime().nullable(),
});
export type SetupStateSnapshot = z.infer<typeof setupStateSnapshotSchema>;

export const setupStateTransitionSchema = z.object({
    from: setupStateSchema,
    to: setupStateSchema,
    event: z.string().min(1),
    guard: z.string().min(1).optional(),
});
export type SetupStateTransition = z.infer<typeof setupStateTransitionSchema>;

export const setupStateMachineSchema = z.object({
    initialState: setupStateSchema,
    terminalStates: z.array(setupStateSchema),
    states: z.array(setupStateSchema),
    transitions: z.array(setupStateTransitionSchema),
});
export type SetupStateMachine = z.infer<typeof setupStateMachineSchema>;

export const setupInitializeInputSchema = z.object({
    strategy: setupBootstrapStrategySchema.default("local_instance"),
    name: z.string().min(1),
    email: z.email(),
    password: z.string().min(8),
    organizationName: z.string().min(1).optional(),
    remoteServerUrl: z.url().optional(),
});
export type SetupInitializeInput = z.infer<typeof setupInitializeInputSchema>;

export const setupInitializeResultSchema = z.object({
    state: setupStateSnapshotSchema,
    user: z.object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
        role: z.string(),
    }),
    organization: z.object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
    }),
});
export type SetupInitializeResult = z.infer<typeof setupInitializeResultSchema>;

// ----------------------------------------------------------------------------
// Database configuration step
// ----------------------------------------------------------------------------

export const setupConfigureDatabaseInputSchema = z.object({
    databaseUrl: z.string().min(1, "Database URL is required"),
    /** If true, only test the connection without saving — useful for validation UI */
    testOnly: z.boolean().optional().default(false),
    /** Node identity override. If omitted a UUID is auto-generated and stored. */
    nodeId: z.uuid().optional(),
});
export type SetupConfigureDatabaseInput = z.infer<typeof setupConfigureDatabaseInputSchema>;

export const setupConfigureDatabaseResultSchema = z.object({
    state: setupStateSnapshotSchema,
    connected: z.boolean(),
    /** True when the target DB has no users yet (fresh install) */
    isNewDatabase: z.boolean(),
    /** The node ID that was saved (or already existed in the config) */
    nodeId: z.uuid(),
});
export type SetupConfigureDatabaseResult = z.infer<typeof setupConfigureDatabaseResultSchema>;

// ----------------------------------------------------------------------------
// Node status (config-file level, no DB required)
// ----------------------------------------------------------------------------

export const nodeConfigStatusSchema = z.object({
    /** Whether a node config file exists with a valid databaseUrl */
    isConfigured: z.boolean(),
    nodeId: z.uuid().nullable(),
    configuredAt: z.string().datetime().nullable(),
});
export type NodeConfigStatus = z.infer<typeof nodeConfigStatusSchema>;