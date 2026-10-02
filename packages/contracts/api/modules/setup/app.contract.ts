import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
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

/**
 * The SETUP APP's contract — the wizard surface as the setup process serves it.
 *
 * ── WHY THIS IS A SEPARATE CONTRACT FROM `setupContract` ────────────────────
 * `setupContract` describes what the FULL API exposes under `/setup`. This one
 * describes what the SETUP APP exposes, and the two are deliberately not the
 * same list:
 *
 *   | procedure          | setup app                       | full API        |
 *   |--------------------|---------------------------------|-----------------|
 *   | getState           | answered locally (node_config)  | from DB + auth  |
 *   | getNodeStatus      | answered locally                | from DB         |
 *   | probeDatabase      | forwarded to the API            | executes        |
 *   | probeMesh          | forwarded to the API            | executes        |
 *   | remoteAuth         | forwarded to the API            | executes        |
 *   | triggerInitialize  | FORWARDED **and opens the gate**| executes        |
 *   | getInitializeStream| setup's own orchestration stream| provisioning SSE|
 *
 * The setup app cannot simply re-expose `setupContract`: the API does not exist
 * when the wizard first loads (`getState` would always race a process that has
 * not started), and the stream it serves describes work the SETUP app performs
 * (start the swarm, start the API) that the API cannot report on because it is
 * the thing being started.
 *
 * So this contract REFLECTS the same entity schemas — one definition of the
 * wizard's data — while describing a different set of operations. Duplicating
 * the schemas would be the bug; describing a different surface is the point.
 *
 * ── WHY NOT A WILDCARD PROXY ────────────────────────────────────────────────
 * The previous version forwarded `setup/*path` by string matching. That is
 * untyped (a path the contract gained would silently 404), it hid the gate
 * (opening it was a side effect inside a string comparison), and it broke
 * outright on Express 5, where a wildcard param is an ARRAY — so
 * `API_PATHS.includes(["trigger"])` was always false and every proxied call
 * returned "Unknown setup path". Naming each procedure makes every one of those
 * impossible by construction.
 */
const setupAppOps = standard.zod(setupStateSnapshotSchema, "setupAppState");
const setupAppNodeStatusOps = standard.zod(nodeConfigStatusSchema, "setupAppNodeStatus");
const setupAppProbeDbOps = standard.zod(setupProbeDbResultSchema, "setupAppProbeDb");
const setupAppProbeMeshOps = standard.zod(setupProbeMeshResultSchema, "setupAppProbeMesh");
const setupAppRemoteAuthOps = standard.zod(setupRemoteAuthResultSchema, "setupAppRemoteAuth");
const setupAppHintsOps = standard.zod(listHintsResultSchema, "setupAppHints");

/**
 * The trigger and its stream share one builder, exactly as the API's own
 * `setupContract` does.
 *
 * `standard.zod` derives entity operations from an OBJECT schema, but the trigger
 * takes a discriminated UNION (`{strategy: "local"} | {strategy: "remote"}`).
 * Wrapping the union directly throws `requires an object schema for 'cloneEntity'`
 * at import time, because there are no entity fields to clone.
 *
 * So the builder is anchored on the local RESULT schema — an object, as the
 * builder requires — and the union is supplied as the `.input(...)` override. That
 * is the same arrangement `setupContract.triggerInitialize` uses, which keeps one
 * shape for this pair across both apps.
 */
const setupAppInitializeOps = standard.zod(setupInitializeLocalResultSchema, "setupAppInitialize");

/**
 * The setup app's error set — the same shape the wizard already handles.
 *
 * `SERVICE_UNAVAILABLE` is the one that matters here and has no equivalent in
 * `setupContract`: it is what the wizard receives when it asks for something
 * that needs the API and the API is not up yet. That is a NORMAL transient state
 * during onboarding (the API starts behind the gate), not a fault, and the
 * wizard renders it as progress rather than as a failure — which it can only do
 * because the code is distinct from `INTERNAL_SERVER_ERROR`.
 */
function setupAppErrorContracts(e: (code?: string) => ErrorDefinitionBuilder) {
    return [
        ...standardDomainErrorContracts(e),
        e()
            .code("SERVICE_UNAVAILABLE")
            .message("The platform API is not reachable yet")
            .status(503)
            .data(standardDomainErrorPayloadSchema),
        e()
            .code("BAD_GATEWAY")
            .message("Upstream platform API request failed")
            .status(502)
            .data(standardDomainErrorPayloadSchema),
        e()
            .code("GATEWAY_TIMEOUT")
            .message("Upstream platform API timed out")
            .status(504)
            .data(standardDomainErrorPayloadSchema),
        e()
            .code("INTERNAL_SERVER_ERROR")
            .message("Setup failed")
            .status(500)
            .data(standardDomainErrorPayloadSchema),
    ] as const;
}

export const setupAppContract = oc
    .meta(openapi({ tags: ["SetupApp"], prefix: "/setup" }))
    .router({
        // ─── State (answered LOCALLY — the API does not exist yet) ───────────

        /** Current wizard state. Read from the shared `node_config` row. */
        getState: setupAppOps
            .list()
            .path("/state")
            .input((b) => b.body(z.object({}).optional()))
            .output((b) => b.body(setupStateSnapshotSchema))
            .errors((e) => setupAppErrorContracts(e))
            .build(),

        /** Persisted node config — is this node already configured? */
        getNodeStatus: setupAppNodeStatusOps
            .list()
            .path("/node-status")
            .input((b) => b.body(z.object({}).optional()))
            .output((b) => b.body(nodeConfigStatusSchema))
            .errors((e) => setupAppErrorContracts(e))
            .build(),

        // ─── Pre-flight probes (forwarded — they need the API) ───────────────

        /** Test a PostgreSQL URL before submitting (local flow, Step 2). */
        probeDatabase: setupAppProbeDbOps
            .create()
            .path("/probe/database")
            .input((b) => b.body(setupProbeDbInputSchema))
            .output((b) => b.body(setupProbeDbResultSchema))
            .errors((e) => setupAppErrorContracts(e))
            .build(),

        /** Test a mesh URL before submitting (remote flow, Step 2). */
        probeMesh: setupAppProbeMeshOps
            .create()
            .path("/probe/mesh")
            .input((b) => b.body(setupProbeMeshInputSchema))
            .output((b) => b.body(setupProbeMeshResultSchema))
            .errors((e) => setupAppErrorContracts(e))
            .build(),

        /** Authenticate against a remote mesh node. */
        remoteAuth: setupAppRemoteAuthOps
            .create()
            .path("/remote/auth")
            .input((b) => b.body(setupRemoteAuthInputSchema))
            .output((b) => b.body(setupRemoteAuthResultSchema))
            .errors((e) => setupAppErrorContracts(e))
            .build(),

        // ─── Trigger (opens the gate, then forwards) ─────────────────────────

        /**
         * Start provisioning.
         *
         * `POST /setup/trigger` is the operator saying "these are my choices,
         * go", so this is the call that OPENS THE GATE — the API may not start
         * until it arrives. It then forwards the choices, because provisioning
         * itself needs the Drizzle schema, migrations and auth that only the API
         * has.
         */
        triggerInitialize: setupAppInitializeOps
            .create()
            .path("/trigger")
            .input((b) => b.body(setupInitializeInputSchema))
            .output((b) => b.body(z.object({ accepted: z.boolean(), delivered: z.boolean() })))
            .errors((e) => setupAppErrorContracts(e))
            .build(),

        // ─── The orchestration stream (setup's OWN, not a pipe) ──────────────

        /**
         * The setup progress stream.
         *
         * ── THIS IS THE SETUP APP'S STREAM, NOT THE API'S ────────────────────
         * It reports the work the SETUP app performs and drives:
         *
         *   1. start the swarm            (supervised / prod only)
         *   2. start the API              (swarm task, or wait for compose)
         *   3. stream the API's own logs  while it boots
         *   4. hand the trigger to the API
         *   5. forward the API's provisioning stream verbatim
         *
         * The API cannot report steps 1–3: it IS what is being started. So the
         * setup app emits them as ordinary `step_detail` / `snapshot` / `log`
         * events — the same shape the API uses — and the wizard renders one
         * continuous progress view with no knowledge of who produced which step.
         *
         * Once the API is up its frames are forwarded VERBATIM (plan §10.1): the
         * setup app is a pipe for the API's own provisioning, never a second
         * producer of it.
         */
        getInitializeStream: setupAppInitializeOps
            .list()
            .path("/stream")
            .input((b) => b.body(z.object({}).optional()))
            .output((b) => b.observable(setupStreamEventSchema))
            .errors((e) => setupAppErrorContracts(e))
            .build(),

        // ─── Post-setup hints (forwarded) ───────────────────────────────────

        /** List pending post-setup hint IDs — shown after setup completes. */
        listPostSetupHints: setupAppHintsOps
            .list()
            .path("/post-setup/hints")
            .input((b) => b.body(z.object({}).optional()))
            .output((b) => b.body(listHintsResultSchema))
            .errors((e) => setupAppErrorContracts(e))
            .build(),

        /** Dismiss a post-setup hint. */
        dismissPostSetupHint: setupAppHintsOps
            .create()
            .path("/post-setup/hints/dismiss")
            .input((b) => b.body(dismissHintInputSchema))
            .output((b) => b.body(z.object({ ok: z.boolean() })))
            .errors((e) => setupAppErrorContracts(e))
            .build(),
    });

export type SetupAppContract = typeof setupAppContract;
