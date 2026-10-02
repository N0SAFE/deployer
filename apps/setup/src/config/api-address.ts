/**
 * Where the full API answers, resolved for the mode this setup app runs in.
 *
 * ── WHY THIS IS A MODULE AND NOT A METHOD ────────────────────────────────────
 * Two callers need the SAME answer, and they run at different times:
 *
 *   1. `createSetupAuthProxy(...)` — built in `app.config.ts`, BEFORE Nest
 *      bootstraps, so it cannot inject a provider.
 *   2. `WizardUpstreamService.baseUrl()` — a Nest provider, used for every
 *      `/setup/*` forward.
 *
 * Keeping the rule in one place is the point: when only the wizard resolved it,
 * the auth proxy used the RAW `SETUP_API_URL` and the mismatch surfaced as two
 * different failures on the same screen — the sign-in step 503'd against the
 * compose-only name while `/setup/trigger` failed for a different reason:
 *
 *   Error  The platform API is not reachable yet (api-dev:3005/api/auth)
 *   Error  The platform API is not reachable yet (/setup/trigger)
 *
 * ── WHY THE MODE CHANGES THE ANSWER ─────────────────────────────────────────
 * `dev`   compose runs the API at a fixed name, so `SETUP_API_URL` is both the
 *         address AND the way to reach it.
 * `prod`  setup CREATES the API as a swarm service. `SETUP_API_URL` is then only
 *         the PORT and path it answers on — its hostname is the SERVICE name,
 *         which is what resolves on the overlay. Nothing runs `api-dev` in that
 *         profile (compose starts no API there), so using it verbatim meant every
 *         forward went to a name that does not exist.
 */

/** Values this resolver reads — satisfied by `EnvService` and by the parsed env. */
export interface ApiAddressEnv {
  SETUP_MODE: string;
  SETUP_API_URL?: string | undefined;
  DEPLOYER_PREFIX: string;
}

/**
 * The API's swarm service name on the overlay.
 *
 * Mirrors `ApiServiceProvisioner.serviceName()` — the process that CREATES the
 * service and the process that DIALS it must agree, so both derive it the same
 * way (base name, per-prefix `-<prefix>` appended).
 */
export function apiServiceName(prefix: string): string {
  return prefix === "" ? "deployer-api" : `deployer-api-${prefix}`;
}

/**
 * Absolute base URL of the full API, without a trailing slash.
 *
 * Returns `null` when no address is configured at all — a malformed or missing
 * value must not silently become a DIFFERENT host, so callers decide whether
 * that is fatal (the wizard forward) or merely means "no proxy" (boot).
 */
export function resolveApiBaseUrl(env: ApiAddressEnv): string | null {
  const configured = env.SETUP_API_URL;
  if (configured === undefined || configured.length === 0) return null;

  // Normalize: a trailing slash would produce `//setup/state` (a different path
  // on most routers, and a 404 on ours).
  const normalized = configured.replace(/\/+$/, "");

  if (env.SETUP_MODE !== "prod") return normalized;

  // PROD: THE SERVICE NAME IS THE ADDRESS. Keep the configured PORT (it
  // genuinely differs between profiles) and replace only the host with the
  // swarm service name — the same name the handover points the ingress at, so
  // the two cannot disagree about where the API is.
  try {
    const parsed = new URL(normalized);
    return `${parsed.protocol}//${apiServiceName(env.DEPLOYER_PREFIX)}:${parsed.port}`;
  } catch {
    // Malformed: treat as unconfigured rather than inventing a host.
    return null;
  }
}
