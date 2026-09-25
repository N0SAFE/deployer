import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";

import { EnvService } from "@/config/env/env.module";

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
   * `SETUP_MODE=dev` → `SETUP_API_URL` (compose manages the API, so its address
   * is known and stable). `SETUP_MODE=prod` → the API is created by setup as a
   * swarm service, and its DNS name is stable within the overlay, so the same
   * value is used; a missing value there is a configuration error, not a
   * runtime condition to paper over.
   */
  baseUrl(): string {
    const url = this.env.get("SETUP_API_URL");
    if (url === undefined || url.length === 0) {
      throw new ServiceUnavailableException(
        "SETUP_API_URL is not configured — the setup app cannot reach the full API",
      );
    }
    // Normalize: a trailing slash would produce `//setup/state` (a different
    // path on most routers, and a 404 on ours).
    return url.replace(/\/+$/, "");
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
   */
  async forward(path: string, init: RequestInit): Promise<Response> {
    const url = this.urlFor(path);
    try {
      return await fetch(url, init);
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
