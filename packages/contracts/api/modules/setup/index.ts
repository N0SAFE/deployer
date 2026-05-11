import { oc } from "@orpc/contract";
import { z } from "zod/v4";
import {
    setupStateSnapshotSchema,
    setupInitializeInputSchema,
    setupStreamEventSchema,
    setupProbeDbInputSchema,
    setupProbeDbResultSchema,
    setupProbeMeshInputSchema,
    setupProbeMeshResultSchema,
    setupRemoteAuthInputSchema,
    setupRemoteAuthResultSchema,
    nodeConfigStatusSchema,
} from "@repo/contracts-entities";
import { RouteBuilder } from "@repo/orpc-utils";

// All setup endpoints are public — no session exists yet during setup
const pub = oc;

export const setupContract = {
    // ─── State ──────────────────────────────────────────────────────────────

    /** Current wizard state — called on mount */
    getState: pub
        .input(z.void())
        .output(setupStateSnapshotSchema),

    /** Persisted node config — is this node already configured? */
    getNodeStatus: pub
        .input(z.void())
        .output(nodeConfigStatusSchema),

    // ─── Pre-flight probes ───────────────────────────────────────────────────

    /** Test a PostgreSQL URL before submitting (local flow, Step 2) */
    probeDatabase: pub
        .input(setupProbeDbInputSchema)
        .output(setupProbeDbResultSchema),

    /** Test a mesh URL before submitting (remote flow, Step 2) */
    probeMesh: pub
        .input(setupProbeMeshInputSchema)
        .output(setupProbeMeshResultSchema),

    // ─── Remote auth ─────────────────────────────────────────────────────────

    /**
     * Authenticate against a remote mesh node.
     * Returns an authToken (= join grant token) forwarded to `initialize`.
     */
    remoteAuth: pub
        .input(setupRemoteAuthInputSchema)
        .output(setupRemoteAuthResultSchema),

    // ─── Main submit — SSE stream ────────────────────────────────────────────

    /**
     * Submit the wizard form.
     * Returns an AsyncIterable of SetupStreamEvent so the UI can display
     * live progress cards for each step (provision → migrate → seed → register…).
     *
     * The stream ends with a `{ type: "completed", result }` event on success
     * or `{ type: "error", message }` on fatal failure.
     */
    initialize: new RouteBuilder()
        .input(setupInitializeInputSchema)
        .output(b => b.observable(setupStreamEventSchema))
        .build()
};