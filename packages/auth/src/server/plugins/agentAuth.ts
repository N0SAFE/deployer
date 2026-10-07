/**
 * Agent Auth — server plugin wrapper.
 *
 * Exposes the platform's own ORPC contract surface to AI agents as a set of
 * reviewable, grant-gated capabilities. Instead of hand-writing capabilities,
 * the plugin's OpenAPI adapter derives one capability per `operationId` from
 * the spec that `generateSpec()` already produces and `/openapi.json` serves.
 *
 * ## Why this is safe to expose
 *
 * Three properties matter, and all three are enforced by the plugin:
 *
 * 1. **Grants are explicit.** A capability does nothing until a user approves a
 *    grant for it. `defaultHostCapabilities` is restricted to read-only methods,
 *    so a newly enrolled agent can look but not touch.
 * 2. **Mutations need a hardware gesture.** `approvalStrength` maps HTTP
 *    methods to the proof required: reads accept a session, writes require
 *    WebAuthn (the Passkey plugin). An agent cannot deploy without a human
 *    touch.
 * 3. **Every action is auditable.** `onEvent` fires on agent/host lifecycle,
 *    capability requests, approvals and executions. This repo's own audit found
 *    audit emission was never wired (`docs/enhancement-overview-platform-100.md`
 *    §91), so this hook is the audit source for the agent surface rather than a
 *    parallel table.
 *
 * ## Version risk
 *
 * `@better-auth/agent-auth` is `0.6.2` while every other plugin tracks `1.7.5`,
 * and its own docs call it unstable. It is therefore isolated behind this
 * wrapper — a breaking change is one file — and pinned exactly in the catalog
 * (not `^`).
 */

import {
    agentAuth,
    type AgentAuthOptions,
} from "@better-auth/agent-auth";
import { createFromOpenAPI } from "@better-auth/agent-auth/openapi";

/**
 * The OpenAPI document shape the adapter accepts.
 *
 * `OpenAPISpec` is declared in `@better-auth/agent-auth/openapi` but not
 * re-exported, so it is derived from the adapter's own signature. That keeps
 * the type correct even if the package starts exporting it.
 */
export type AgentAuthOpenAPISpec = Parameters<typeof createFromOpenAPI>[0];

/** Read-only methods an agent may receive by default. */
const READ_ONLY_METHODS = ["GET", "HEAD"] as const;

export interface UseAgentAuthOptions {
    /** The generated OpenAPI 3.x spec (from `generateSpec()`). */
    spec: AgentAuthOpenAPISpec;
    /** Public base URL of the API that capability calls proxy to. */
    baseUrl: string;
    /**
     * Mint the credential used when the plugin proxies a capability call to the
     * API on the agent's behalf.
     *
     * Must NOT return a platform-wide token. Scope it to the resolved user.
     */
    resolveHeaders?: (input: {
        userId: string;
    }) => Promise<Record<string, string>> | Record<string, string>;
    /** Called for every agent-auth lifecycle event. Wire this to the audit log. */
    onEvent?: AgentAuthOptions["onEvent"];
    /** Web page where a user approves requested capabilities. */
    deviceAuthorizationPage?: string;
}

/**
 * Build the agent-auth plugin from the generated OpenAPI spec.
 *
 * @example
 * ```ts
 * import { generateSpec } from "@/openapi";
 * import { useAgentAuth } from "@repo/auth/server/plugins";
 *
 * betterAuth({ plugins: [ useAgentAuth({ spec: await generateSpec(), baseUrl: env.APP_URL }) ] })
 * ```
 */
export function useAgentAuth(options: UseAgentAuthOptions): ReturnType<typeof agentAuth> {
    const {
        spec,
        baseUrl,
        onEvent,
        deviceAuthorizationPage = "/device/capabilities",
    } = options;

    const { resolveHeaders } = options;

    return agentAuth({
        ...createFromOpenAPI(spec, {
            baseUrl,
            // Reads are granted on enrollment; everything else must be approved
            // per capability. Without this an agent would inherit every
            // operation in the spec.
            defaultHostCapabilities: [...READ_ONLY_METHODS],
            // The single most important safety control here: a session is
            // enough to READ, but any mutation needs WebAuthn (a real user
            // gesture), not merely an approved grant.
            approvalStrength: {
                GET: "session",
                HEAD: "session",
                POST: "webauthn",
                PUT: "webauthn",
                PATCH: "webauthn",
                DELETE: "webauthn",
            },
            ...(resolveHeaders
                ? {
                      resolveHeaders({ agentSession }) {
                          return resolveHeaders({ userId: agentSession.user.id });
                      },
                  }
                : {}),
        }),
        // Both modes: delegated (acts as a user) and autonomous (own identity).
        modes: ["delegated", "autonomous"],
        // Device authorization only — CIBA needs a backchannel the platform
        // does not have yet.
        approvalMethods: ["device_authorization"],
        deviceAuthorizationPage,
        ...(onEvent ? { onEvent } : {}),
    });
}

export type AgentAuthPlugin = ReturnType<typeof useAgentAuth>;
