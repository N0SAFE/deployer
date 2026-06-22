import { oc } from "@orpc/contract";
import { z } from "zod";
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
} from "@repo/contracts-entities";
import { standard } from "@repo/orpc-utils";

// ─── Standard ops builders ────────────────────────────────────────────────────
// Each endpoint uses the result schema as the "entity" for the standard builder.
// The .create() / .list() method sets the correct HTTP verb, then we override
// input/output with the procedure-specific schemas.

const setupStateOps    = standard.zod(setupStateSnapshotSchema, "setupState");
const setupNodeStatusOps = standard.zod(nodeConfigStatusSchema, "setupNodeStatus");
const setupProbeDbOps  = standard.zod(setupProbeDbResultSchema, "setupProbeDb");
const setupProbeMeshOps = standard.zod(setupProbeMeshResultSchema, "setupProbeMesh");
const setupRemoteAuthOps = standard.zod(setupRemoteAuthResultSchema, "setupRemoteAuth");
const setupInitializeOps = standard.zod(setupInitializeLocalResultSchema, "setupInitialize");

export const setupContract = oc.tag("Setup").prefix("/setup").router({
    // ─── State ──────────────────────────────────────────────────────────────

    /** Current wizard state — called on mount */
    getState: setupStateOps
        .list()
        .path("/state")
        .input((b) => b.body(z.object({}).optional()))
        .output((b) => b.body(setupStateSnapshotSchema))
        .build(),

    /** Persisted node config — is this node already configured? */
    getNodeStatus: setupNodeStatusOps
        .list()
        .path("/node-status")
        .input((b) => b.body(z.object({}).optional()))
        .output((b) => b.body(nodeConfigStatusSchema))
        .build(),

    // ─── Pre-flight probes ───────────────────────────────────────────────────

    /** Test a PostgreSQL URL before submitting (local flow, Step 2) */
    probeDatabase: setupProbeDbOps
        .create()
        .path("/probe/database")
        .input((b) => b.body(setupProbeDbInputSchema))
        .output((b) => b.body(setupProbeDbResultSchema))
        .build(),

    /** Test a mesh URL before submitting (remote flow, Step 2) */
    probeMesh: setupProbeMeshOps
        .create()
        .path("/probe/mesh")
        .input((b) => b.body(setupProbeMeshInputSchema))
        .output((b) => b.body(setupProbeMeshResultSchema))
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
        .output((b) => b.observable(setupStreamEventSchema))
        .build(),
});