import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";

import { EnvService } from "@/config/env/env.module";
import { resolveApiBaseUrl } from "@/config/api-address";

/**
 * Deadline for one forward to the platform API.
 *
 * Long enough for a cold route + a provisioning call, short enough that the
 * operator sees a retryable error instead of a spinner that never resolves when
 * the ingress swap strands a socket. The stream is exempt — see `forward`.
 */
const UPSTREAM_TIMEOUT_MS = 30_000;

/**
 * Resolves where the full API answers, and forwards requests to it.
 *
 * WHY THE SETUP APP PROXIES INSTEAD OF SERVING THE WIZARD ITSELF
 * The wizard contract (`/setup/*`) is implemented ONCE, in the API, because
 * provisioning needs the Drizzle schema, migrations and the auth stack — the
 * API is the only process that has them. During onboarding the API is not the
 * ingress target yet (`api.<host>` still points nowhere), so the setup app
 * forwards the client's calls to it.
 *
 * That keeps a single implementation of the wizard contract and means the
 * CLIENT needs no change: it calls `/setup/*` on whichever host is serving it.
 */
@Injectable()
export class WizardUpstreamService {
  private readonly logger = new Logger(WizardUpstreamService.name);

  constructor(private readonly env: EnvService) {}

  /**
   * Base URL of the full API.
   *
   * ── WHY THIS DEPENDS ON THE MODE ─────────────────────────────────────────
   * `dev`   compose runs the API at a fixed name, so `SETUP_API_URL` is both the
   *         address AND the way to reach it.
   * `prod`  setup CREATES the API as a swarm service. `SETUP_API_URL` is then
   *         only the PORT and path it answers on — its hostname is the SERVICE
   *         name, which is what resolves on the overlay.
   *
   * Using `SETUP_API_URL` verbatim in prod meant every forward went to the
   * compose-only name:
   *
   *   Upstream http://bff:3005/setup/trigger unreachable:
   *   getaddrinfo ENOTFOUND bff
   *
   * Nothing runs `bff` in that profile (compose starts no API there), so the
   * trigger was never delivered, the API never provisioned, and the handover
   * stalled in `provisioning` until it timed out.
   */
  baseUrl(): string {
    const resolved = resolveApiBaseUrl({
      SETUP_MODE: this.env.get("SETUP_MODE"),
      SETUP_API_URL: this.env.get("SETUP_API_URL"),
      DEPLOYER_PREFIX: this.env.get("DEPLOYER_PREFIX"),
    });
    if (resolved === null) {
      throw new ServiceUnavailableException(
        "SETUP_API_URL is not configured — the setup app cannot reach the full API",
      );
    }
    return resolved;
  }

  /** Absolute URL for an API path. */
  urlFor(path: string): string {
    return this.baseUrl() + (path.startsWith("/") ? path : "/" + path);
  }

  /**
   * Forward a non-streaming request and return the upstream Response.
   *
   * The caller decides what to do with it (status, headers, body) rather than
   * this service re-encoding: the wizard contract already defines the payload,
   * so re-serializing would be a second place to get it wrong.
   *
   * ── WHY A DEADLINE, AND WHY IT IS SKIPPED FOR THE STREAM ──────────────────
   * `fetch` has no timeout. During the ingress swap the upstream address changes
   * owner, and a request that was in flight is neither answered nor closed — so
   * the forward never settles, the wizard's request hangs, and the browser shows a
   * spinner for a promise that can no longer resolve. The deadline turns that into
   * a 503, which the wizard already renders as "the API is not reachable yet" and
   * retries.
   *
   * `/setup/stream` is EXEMPT: it is meant to stay open for the whole
   * provisioning run, so a deadline there would abort every healthy run. Its
   * liveness is the heartbeat plus the client's own inactivity timeout.
   */
  async forward(path: string, init: RequestInit): Promise<Response> {
    const url = this.urlFor(path);
    const streaming = path === "/setup/stream" || new Headers(init.headers).get("accept")?.includes("text/event-stream") === true;
    try {
      if (streaming) return await fetch(url, init);
      return await fetch(url, {
        ...init,
        signal:
          init.signal !== undefined && init.signal !== null
            ? AbortSignal.any([init.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)])
            : AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      // A connection failure is reported as 503, not 500: the API simply is not
      // up yet, which during onboarding is a NORMAL state the wizard renders —
      // not a server fault.
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Upstream ${url} unreachable: ${reason}`);
      throw new ServiceUnavailableException(`The platform API is not reachable yet (${url})`);
    }
  }
}
