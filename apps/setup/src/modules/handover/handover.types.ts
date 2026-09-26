/**
 * Contracts for the handover phase.
 *
 * Kept in their own file so the phase's vocabulary is readable in one place —
 * what a probe reports, and what the whole handover reports — rather than spread
 * across the services that produce them.
 */

/**
 * One readiness probe against the full API.
 *
 * `ready: false` is DATA, not an error: the API answering 503 while it
 * provisions is the expected state for most of onboarding. A discriminated
 * result (rather than a boolean plus an optional reason) means the reason is
 * always available on the failure branch instead of being a second lookup.
 */
export type ApiProbeResult = { ready: true; reason: string } | { ready: false; reason: string };

/**
 * How the handover finished.
 *
 * The `failed` branch carries no partial state on purpose: the plan requires
 * that a failed handover leaves the platform RETRYABLE (setup does not exit, the
 * stream stays open, the wizard offers a retry), so the only thing a consumer
 * needs is the reason to show. Anything already accomplished — the cluster, the
 * provisioned database — is idempotent and is re-converged by the next attempt.
 */
export type HandoverResult = { ok: true; apiBackend: string } | { ok: false; reason: string };

/**
 * Where the API answers once the handover is complete.
 *
 * Two shapes because the two modes genuinely differ, and collapsing them would
 * hide that from the caller:
 *
 *   `container` — dev: compose owns the API, so its DNS name is stable and
 *                 already reachable from the setup container. Nothing is
 *                 created; the backend is simply the address.
 *   `swarm`     — prod: setup CREATES the API as a swarm service, so the
 *                 backend is the service's task DNS name and the service must
 *                 be scheduled before it resolves.
 */
export type ApiBackend =
  | { kind: "container"; url: string; detail: string }
  | { kind: "swarm"; url: string; serviceName: string; detail: string };

/**
 * Default port for the API's backend URL, read from `SETUP_API_PORT`.
 *
 * NOT a constant, because the correct value genuinely differs by environment —
 * dev compose publishes 3005 and prod publishes 3001 — so a hardcoded number
 * would be right in one mode and silently wrong in the other, producing a
 * backend URL that Traefik cannot reach. `3005` is only the dev default, which
 * matches the API's own `app.config.ts` fallback.
 */
export const DEFAULT_API_INTERNAL_PORT = 3005;
