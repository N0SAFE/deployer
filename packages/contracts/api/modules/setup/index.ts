import { oc } from "@orpc/contract";
import z from "zod/v4";
import {
    setupStateSnapshotSchema,
    setupInitializeInputSchema,
    setupInitializeLocalResultSchema,
    setupStreamEventSchema,
    setupProbeDbInputSchema,
    setupProbeDbResultSchema,
    setupProbeMeshInputSchema,
    setupProbeMeshResultSchema,
    setupRemoteAuthInputSchema,
    setupRemoteAuthResultSchema,
    nodeConfigStatusSchema,
    listHintsResultSchema,
    dismissHintInputSchema,
} from "@repo/contracts-entities";
import {
    standard,
    standardDomainErrorContracts,
    standardDomainErrorPayloadSchema,
    type ErrorDefinitionBuilder,
} from "@repo/orpc-utils";

const setupStateOps    = standard.zod(setupStateSnapshotSchema, "setupState");
const setupNodeStatusOps = standard.zod(nodeConfigStatusSchema, "setupNodeStatus");
const setupProbeDbOps  = standard.zod(setupProbeDbResultSchema, "setupProbeDb");
const setupProbeMeshOps = standard.zod(setupProbeMeshResultSchema, "setupProbeMesh");
const setupRemoteAuthOps = standard.zod(setupRemoteAuthResultSchema, "setupRemoteAuth");
const setupInitializeOps = standard.zod(setupInitializeLocalResultSchema, "setupInitialize");
const setupListHintsOps = standard.zod(listHintsResultSchema, "setupListHints");

/**
 * Canonical setup-domain error set.
 *
 * Spreads the standard product-domain errors, then adds the gateway errors
 * the wizard controller throws when the remote mesh node misbehaves. The
 * data schema is `standardDomainErrorPayloadSchema` so every thrown error
 * arrives as a DEFINED (typed) error on the client — see
 * `standardErrorOptions` for the matching throw-side payload builder.
 */
function setupDomainErrorContracts(e: (code?: string) => ErrorDefinitionBuilder) {
    return [
        ...standardDomainErrorContracts(e),
        e()
            .code("BAD_GATEWAY")
            .message("Upstream mesh node request failed")
            .status(502)
            .data(standardDomainErrorPayloadSchema),
        e()
            .code("GATEWAY_TIMEOUT")
            .message("Upstream mesh node timed out")
            .status(504)
            .data(standardDomainErrorPayloadSchema),
        e()
            .code("INTERNAL_SERVER_ERROR")
            .message("Setup failed")
            .status(500)
            .data(standardDomainErrorPayloadSchema),
    ] as const;
}

export const setupContract = oc.tag("Setup").prefix("/setup").router({
    // ─── State ──────────────────────────────────────────────────────────────

    /** Current wizard state — called on mount */
    getState: setupStateOps
        .list()
        .path("/state")
        .input((b) => b.body(z.object({}).optional()))
        .output((b) => b.body(setupStateSnapshotSchema))
        .errors((e) => setupDomainErrorContracts(e))
        .build(),

    /** Persisted node config — is this node already configured? */
    getNodeStatus: setupNodeStatusOps
        .list()
        .path("/node-status")
        .input((b) => b.body(z.object({}).optional()))
        .output((b) => b.body(nodeConfigStatusSchema))
        .errors((e) => setupDomainErrorContracts(e))
        .build(),

    // ─── Pre-flight probes ───────────────────────────────────────────────────

    /** Test a PostgreSQL URL before submitting (local flow, Step 2) */
    probeDatabase: setupProbeDbOps
        .create()
        .path("/probe/database")
        .input((b) => b.body(setupProbeDbInputSchema))
        .output((b) => b.body(setupProbeDbResultSchema))
        .errors((e) => setupDomainErrorContracts(e))
        .build(),

    /** Test a mesh URL before submitting (remote flow, Step 2) */
    probeMesh: setupProbeMeshOps
        .create()
        .path("/probe/mesh")
        .input((b) => b.body(setupProbeMeshInputSchema))
        .output((b) => b.body(setupProbeMeshResultSchema))
        .errors((e) => setupDomainErrorContracts(e))
        .build(),

    // ─── Remote auth ─────────────────────────────────────────────────────────

    /**
     * Authenticate against a remote mesh node.
     * Returns an authToken (= join grant token) forwarded to `initialize`.
     */
    remoteAuth: setupRemoteAuthOps
        .create()
        .path("/remote/auth")
        .input((b) => b.body(setupRemoteAuthInputSchema))
        .output((b) => b.body(setupRemoteAuthResultSchema))
        .errors((e) => setupDomainErrorContracts(e))
        .build(),

    // ─── Trigger initialization (returns immediately) ────────────────────────

    /**
     * Start the initialization process in the background.
     * Returns immediately with `{ accepted: true }`.
     * Live progress can be consumed via `getInitializeStream`.
     */
    triggerInitialize: setupInitializeOps
        .create()
        .path("/trigger")
        .input((b) => b.body(setupInitializeInputSchema))
        .output((b) => b.body(z.object({ accepted: z.boolean() })))
        .errors((e) => setupDomainErrorContracts(e))
        .build(),

    // ─── Stream initialization events (SSE) ─────────────────────────────────

    /**
     * Subscribe to the initialization event stream.
     * Returns an AsyncIterable of SetupStreamEvent (SSE).
     *
     * Call this after `triggerInitialize` to receive live progress.
     * Replays past events for late subscribers (page reload / reconnection).
     */
    getInitializeStream: setupInitializeOps
        .list()
        .path("/stream")
        .input((b) => b.body(z.object({}).optional()))
        .output((b) => b.observable(setupStreamEventSchema))
        .errors((e) => setupDomainErrorContracts(e))
        .build(),

    // ─── Post-setup hints ─────────────────────────────────────────────────

    /** List pending post-setup hint IDs — shown to user after setup completes */
    listPostSetupHints: setupListHintsOps
        .list()
        .path("/post-setup/hints")
        .input((b) => b.body(z.object({}).optional()))
        .output((b) => b.body(listHintsResultSchema))
        .errors((e) => setupDomainErrorContracts(e))
        .build(),

    /** Dismiss a post-setup hint — marks it as completed in node_config */
    dismissPostSetupHint: setupListHintsOps
        .create()
        .path("/post-setup/hints/dismiss")
        .input((b) => b.body(dismissHintInputSchema))
        .output((b) => b.body(z.object({ ok: z.boolean() })))
        .errors((e) => setupDomainErrorContracts(e))
        .build(),
});