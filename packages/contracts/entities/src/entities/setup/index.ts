import z from "zod/v4";
import { swarmFoundingSelectionSchema, swarmJoinSelectionSchema } from "@repo/contracts-entities/entities/swarm/swarm-config.schema";

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
    "reachability_check",
    "configure_account",
    "remote_auth",
    "version_check",
    // Founds the cluster BEFORE provisioning: the locally-managed global
    // Postgres is a swarm service, so the engine must already be a cluster.
    "initialize_swarm",
    // ── The two steps the SETUP APP drives, not the API ─────────────────────
    // The API's stream cannot report these: it is the process being started.
    // Setup emits them on the SAME stream and in the same event shape, so the
    // wizard renders one continuous timeline. See
    // `SetupOrchestrationStreamService` in apps/setup.
    "start_api",
    "await_api_boot",
    // Hands the entry port to the SWARM ingress and waits until that incarnation
    // is the one answering. It is a step of its own because the operator must not
    // be told setup is finished while the ingress they are about to browse through
    // is still being replaced — the window shows up as a red "failed to fetch" on
    // the last screen, and as a 502 on any immediate reload.
    "promote_ingress",
    "provision_database",
    "ensure_empty",
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
    hasUsers: z.boolean(),
    bootstrapStrategy: setupBootstrapStrategySchema.nullable(),
    availableStrategies: z.array(setupBootstrapStrategySchema),
    currentStep: setupStepIdSchema.nullable(),
    progressPercent: z.number().int().min(0).max(100),
    steps: z.array(setupStepSchema),
    completedAt: z.date().nullable(),
});
export type SetupStateSnapshot = z.infer<typeof setupStateSnapshotSchema>;

// ─── Initialize input ─────────────────────────────────────────────────────────

/**
 * Deployment shape the operator picks during onboarding.
 *
 * ── WHY THIS IS A WIZARD CHOICE AND NOT AN ENV VAR ──────────────────────────
 * It decides whether the platform runs its OWN dashboard (the managed web app,
 * a swarm service the API spawns and supervises) or serves the API alone and
 * leaves the frontend to whoever is deploying. That is a deployment-level
 * decision the person running onboarding is the only one who can make, and it
 * was previously reachable only by editing `MANAGED_WEB_APP_ENABLED` and
 * restarting — i.e. decided before the operator ever saw the wizard.
 *
 * `api-only` is a legitimate target (headless/API-first installs), not a
 * degraded mode, so neither value is a default-by-omission: the wizard asks.
 *
 * Persisted to `app_config` (`managed_web_app.enabled`), which WINS over the
 * env seed on every later read — so this choice is durable and changeable from
 * the platform console afterwards.
 */
export const setupManagedWebSelectionSchema = z.enum(["managed", "api-only"]);
export type SetupManagedWebSelection = z.infer<typeof setupManagedWebSelectionSchema>;

/** True when the platform should spawn and supervise its own dashboard. */
export function managedWebEnabledFromSelection(selection: SetupManagedWebSelection): boolean {
    return selection === "managed";
}

export const setupInitializeLocalInputSchema = z.object({
    strategy: z.literal("local"),
    name: z.string().min(1),
    email: z.email(),
    password: z.string().min(8),
    existingDatabaseUrl: z.string().optional(),
    serverUrl: z.url(),
    /**
     * Swarm participation chosen when FOUNDING this cluster. Because this node
     * creates the swarm, `mode` is only `create` or `disabled` (see
     * `swarmFoundingSelectionSchema` — `create` + `worker` is rejected as
     * impossible). Persisted to `node_config.swarmConfig`, which is what the
     * engine converges from — there is no env fallback.
     */
    swarm: swarmFoundingSelectionSchema.optional(),
    /**
     * Whether the platform runs its own dashboard. Optional so a caller that
     * predates the choice (and every existing test) stays valid; absent means
     * "leave the deployment-managed default alone".
     */
    managedWeb: setupManagedWebSelectionSchema.optional(),
});
export type SetupInitializeLocalInput = z.infer<typeof setupInitializeLocalInputSchema>;

export const setupInitializeRemoteInputSchema = z.object({
    strategy: z.literal("remote"),
    meshUrl: z.url(),
    authToken: z.string().min(1),
    serverUrl: z.url(),
    /**
     * Swarm role this JOINING node takes in the existing cluster. `mode` is
     * implied by joining (always "join"); the node never founds its own swarm.
     */
    swarm: swarmJoinSelectionSchema.optional(),
    /**
     * Whether THIS node runs a dashboard. A remote node joins an existing
     * cluster, so the answer is usually `api-only` — the frontend already runs
     * on the founding node — but it is a real choice, not an assumption.
     */
    managedWeb: setupManagedWebSelectionSchema.optional(),
});
export type SetupInitializeRemoteInput = z.infer<typeof setupInitializeRemoteInputSchema>;

export const setupInitializeInputSchema = z.discriminatedUnion("strategy", [
    setupInitializeLocalInputSchema,
    setupInitializeRemoteInputSchema,
]);
export type SetupInitializeInput = z.infer<typeof setupInitializeInputSchema>;

// ─── SSE stream events ────────────────────────────────────────────────────────

export const setupProgressEventTypeSchema = z.enum([
    "step_detail",
    "snapshot",
    "log",
    "completed",
    "error",
]);
export type SetupProgressEventType = z.infer<typeof setupProgressEventTypeSchema>;

/**
 * One step's full state as carried on a `snapshot` event. The `logs`
 * array is the complete log buffer for that step at the time the
 * snapshot was emitted — the web renders a step directly from this
 * object without any client-side correlation.
 */
export const setupStreamStepStateSchema = z.object({
    id:          setupStepIdSchema,
    title:       z.string(),
    description: z.string().optional(),
    status:      setupStepStatusSchema,
    logs:        z.array(z.string()).default([]),
    durationMs:  z.number().optional(),
    error:       z.string().optional(),
    startedAt:   z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
});
export type SetupStreamStepState = z.infer<typeof setupStreamStepStateSchema>;

/**
 * One new log line for one step. Consumers append it to the matching
 * step in the latest `snapshot` event. The `seq` field is monotonic
 * within a single initialization run, which allows consumers to
 * detect dropped / reordered events and stitch snapshots together.
 */
export const setupStreamLogEventSchema = z.object({
    type:    z.literal("log"),
    stepId:  setupStepIdSchema,
    line:    z.string(),
    seq:     z.number().int().nonnegative(),
    ts:      z.string().datetime(),
});
export type SetupStreamLogEvent = z.infer<typeof setupStreamLogEventSchema>;

/**
 * Server-driven step definition. Emitted before the first snapshot
 * to tell the UI what steps exist for this flow. The UI creates a
 * placeholder task from each `step_detail` event so the user can see
 * the full pipeline immediately, without hardcoding step templates
 * on the frontend.
 *
 * Each config strategy (local, remote, …) defines its own list of
 * steps in a dedicated flow file on the backend. Adding a new config
 * means creating a new flow file — no frontend changes needed.
 */
export const setupStreamStepDetailEventSchema = z.object({
    type:        z.literal("step_detail"),
    stepId:      z.string(),
    title:       z.string(),
    description: z.string(),
    seq:         z.number().int().nonnegative(),
    ts:          z.string().datetime(),
});
export type SetupStreamStepDetailEvent = z.infer<typeof setupStreamStepDetailEventSchema>;

/**
 * Full snapshot of every step's state at one point in time. Emitted
 * at the start of the stream and after every step transition
 * (start / complete / fail). The first snapshot on a new
 * subscription is the source of truth; subsequent `log` events are
 * deltas against it.
 */
export const setupStreamSnapshotEventSchema = z.object({
    type:  z.literal("snapshot"),
    seq:   z.number().int().nonnegative(),
    ts:    z.string().datetime(),
    steps: z.array(setupStreamStepStateSchema),
});
export type SetupStreamSnapshotEvent = z.infer<typeof setupStreamSnapshotEventSchema>;

/**
 * Each event yielded over the SSE stream.
 *
 * - `step_detail` : server tells the UI about a step (id, title,
 *                   description). The UI creates a task placeholder.
 * - `snapshot`    : full state of every step (logs included). Render
 *                   directly from this.
 * - `log`         : one new log line for one step. Append to the latest
 *                   snapshot. `seq` allows strict ordering.
 * - `completed`   : the whole setup finished successfully.
 * - `error`       : fatal error, stream closes after this.
 *
 * Why this design?
 * ----------------
 * The old per-step event model (separate `step_start` / `step_log` /
 * `step_complete` / `step_failed` events) forced the consumer to
 * maintain its own state machine and correlate logs to the in-flight
 * `step_start`. It also couldn't recover after a dropped event.
 *
 * The new model puts the canonical state in a single `snapshot` per
 * transition. Logs are bound to their step at the source (the API
 * pipeline that owns the step), and incremental `log` events carry a
 * monotonic `seq` for re-ordering / dedup. Any consumer can be brought
 * up to date by reading the latest `snapshot`.
 */
export const setupStreamEventSchema = z.discriminatedUnion("type", [
    setupStreamStepDetailEventSchema,
    setupStreamSnapshotEventSchema,
    setupStreamLogEventSchema,
    z.object({
        type:   z.literal("completed"),
        result: z.object({
            nodeId:       z.uuid(),
            strategy:     setupBootstrapStrategySchema,
            databaseUrl:  z.string(),
            completedAt:  z.string().datetime(),
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
    /**
     * The public URL the peer advertises to other nodes (derived from
     * the peer's APP_URL). Surfaces in the wizard's reachability detail
     * so the user can confirm the right node answered.
     */
    advertisedHost: z.string().optional(),
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
    /**
     * Round-trip latency in milliseconds observed during the
     * credential probe. Optional — only set when the controller
     * surfaced it (used by the UI for live "valid · 87ms" feedback).
     */
    latencyMs: z.number().optional(),
});
export type SetupRemoteAuthResult = z.infer<typeof setupRemoteAuthResultSchema>;

// ─── Post-setup hints ─────────────────────────────────────────────────────────

export const setupHintIdSchema = z.enum(["scanning", "notifications", "domain", "fleet"]);
export type SetupHintId = z.infer<typeof setupHintIdSchema>;

export const dismissHintInputSchema = z.object({
    hintId: setupHintIdSchema,
});
export type DismissHintInput = z.infer<typeof dismissHintInputSchema>;

export const listHintsResultSchema = z.object({
    hintIds: z.array(setupHintIdSchema),
});
export type ListHintsResult = z.infer<typeof listHintsResultSchema>;

// ─── Where the operator goes after setup ──────────────────────────────────────

/**
 * The destination for the wizard's final "continue to dashboard" click.
 *
 * ── WHY THIS IS A TYPED ANSWER AND NOT A URL THE CLIENT DERIVES ─────────────
 * The wizard used to compute this from `window.location` — it could only guess
 * deployment shape from its own hostname. That is wrong the moment the shape is
 * a CHOICE: when the operator picked "API only" there is no dashboard to send
 * them to, and inventing `web.<host>` would land them on a 404. Only the API
 * knows whether a dashboard exists, because it owns the flag.
 *
 * `kind` is explicit so the button can be worded truthfully ("Open the
 * dashboard" vs "Finish") without the client probing anything, and so a future
 * destination (a hostname-not-yet-DNS-resolvable setup, an external URL) does
 * not need the client to re-derive meaning from the string.
 */
export const setupPostSetupDestinationKindSchema = z.enum([
    /** The platform's own dashboard — the managed web app is enabled and reachable. */
    "dashboard",
    /**
     * The API's own console page (`/manage/web-app`), which offers to enable a
     * dashboard. This is the honest destination when none is running: the API
     * serves it itself, so it cannot 404 the way a web hostname would.
     */
    "api-console",
]);
export type SetupPostSetupDestinationKind = z.infer<typeof setupPostSetupDestinationKindSchema>;

export const setupPostSetupDestinationSchema = z.object({
    kind: setupPostSetupDestinationKindSchema,
    /**
     * Absolute URL to navigate to. Absolute rather than a path because the
     * destination can be a DIFFERENT ORIGIN from the wizard (which runs on
     * `setup.<host>` while the dashboard lives on `web.<host>`), and the client
     * should not have to reconstruct the origin it was told about.
     */
    url: z.url(),
    /** Whether the managed web app is enabled — what `kind` was derived from. */
    managedWebEnabled: z.boolean(),
});
export type SetupPostSetupDestination = z.infer<typeof setupPostSetupDestinationSchema>;

// ─── Node config status ───────────────────────────────────────────────────────

export const nodeConfigStatusSchema = z.object({
    isConfigured:       z.boolean(),
    nodeId:             z.uuid().nullable(),
    strategy:           setupBootstrapStrategySchema.nullable(),
    meshUrlsSnapshot:   z.array(z.string()),
    configuredAt:       z.date().nullable(),
});
export type NodeConfigStatus = z.infer<typeof nodeConfigStatusSchema>;