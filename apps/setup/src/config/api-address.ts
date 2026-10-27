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
 *   Error  The platform API is not reachable yet (bff:3005/api/auth)
 *   Error  The platform API is not reachable yet (/setup/trigger)
 *
 * ── WHY THE MODE CHANGES THE ANSWER ─────────────────────────────────────────
 * `dev`   compose runs the API at a fixed name, so `SETUP_API_URL` is both the
 *         address AND the way to reach it.
 * `prod`  setup CREATES the API as a swarm service. `SETUP_API_URL` is then only
 *         the PORT and path it answers on — its hostname is the SERVICE name,
 *         which is what resolves on the overlay. Nothing runs `bff` in that
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

  // ── PROD: THE CONFIGURED HOST IS THE ADDRESS ────────────────────────────
  // It used to be REPLACED by the hardcoded service name, which is only correct
  // for one public app name. `SETUP_API_URL` already names the
  // service the deployment schedules (`http://svc-bff:3005`), and that is exactly the name
  // the handover points the ingress at — so keeping it is what makes "where setup
  // dials" and "where the ingress routes" the SAME value instead of two guesses.
  //
  // Only the port is normalised, because it genuinely differs between profiles
  // and a URL without one would otherwise forward to port 80.
  try {
    const parsed = new URL(normalized);
    // No fallback host: `new URL` REJECTS a hostless absolute URL (`http://:3005`
    // and `http://` both throw "Invalid URL"), so reaching this line means a host
    // exists.
    //
    // No port appended when there is none either: `URL` reports "" for a DEFAULT
    // port, and interpolating it would produce `http://svc-bff:` — a malformed
    // authority `fetch` rejects. Omitting it lets the protocol's default apply,
    // which is what the absence of a port means.
    const { hostname, port, protocol } = parsed;
    return port.length > 0 ? `${protocol}//${hostname}:${port}` : `${protocol}//${hostname}`;
  } catch {
    // Malformed: treat as unconfigured rather than inventing a host.
    return null;
  }
}
