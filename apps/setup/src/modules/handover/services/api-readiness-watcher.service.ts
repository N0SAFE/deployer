import { Injectable, Logger } from "@nestjs/common";
import { Observable, timer, from, of, catchError, map, switchMap, takeWhile, take, last } from "rxjs";

import { WizardUpstreamService } from "@/modules/wizard/wizard-upstream.service";
import type { ApiProbeResult } from "../handover.types";

/**
 * Watches the full API until it reports ready, as an RxJS stream.
 *
 * ── THIS IS THE GATE, AND THE GATE IS THE WHOLE POINT ───────────────────────
 * The ingress swap is only safe once the API is serving. Doing it earlier drops
 * the operator onto a hostname with nothing behind it — which is precisely the
 * failure plan §9.3 exists to prevent. So nothing in this app reaches the
 * ingress until this stream has emitted a ready result.
 *
 * ── WHY POLL THE API RATHER THAN SUBSCRIBE TO IT ────────────────────────────
 * The readiness it needs is a statement about a DIFFERENT process, and HTTP is
 * the only channel between them: the API's readiness is assembled from its
 * global Postgres pool, its swarm state and its supervisor snapshots — none of
 * which this app can observe locally (it has no Postgres pool and does not
 * supervise the platform's services). A local subscription would be a second,
 * drifting opinion about someone else's health.
 *
 * The API publishes its readiness as an HTTP status code (`/health/ready`
 * returns 503 until every indicator is up), so the STATUS is the entire
 * contract — no body parsing, and no way for this side to disagree about what
 * "ready" means.
 *
 * ── WHY `switchMap` + `timer` AND NOT `setInterval` ─────────────────────────
 * `switchMap` CANCELS an in-flight probe when the next tick fires, so a slow or
 * hung request cannot stack overlapping probes — the failure mode of
 * `setInterval` with an async body, where a degraded API accumulates unbounded
 * concurrent connections exactly when it can least afford them.
 */
@Injectable()
export class ApiReadinessWatcherService {
  private readonly logger = new Logger(ApiReadinessWatcherService.name);

  constructor(private readonly upstream: WizardUpstreamService) {}

  /**
   * Poll `/health/ready` until it answers 200.
   *
   * Emits exactly ONE `ready` result then completes, so a subscriber that
   * chains the handover off this stream can never fire the swap twice. Failure
   * is returned as DATA (`ready: false`) rather than thrown: "not ready yet" is
   * the normal state for most of onboarding, and an error channel would make
   * the pipeline above treat expected progress as a fault.
   */
  waitUntilReady(pollIntervalMs: number, timeoutMs: number): Observable<ApiProbeResult> {
    const startedAt = Date.now();
    let attempts = 0;

    return timer(0, pollIntervalMs).pipe(
      // `timer` with a period never completes on its own, so the deadline is
      // enforced here: without it a never-ready API would poll forever and the
      // operator would see an endless "provisioning" phase with no failure.
      takeWhile(() => Date.now() - startedAt < timeoutMs),
      switchMap(() => from(this.probe()).pipe(catchError(() => of<ApiProbeResult>({ ready: false, reason: "probe failed" })))),
      map((result) => {
        attempts += 1;
        if (!result.ready && attempts % 20 === 0) {
          // Periodic progress, not per-tick: at a 2s interval a per-tick log
          // would be 30 lines a minute of the same sentence.
          this.logger.log(`Still waiting for the API to report ready (${String(attempts)} attempts)`);
        }
        return result;
      }),
      // Stop at the FIRST ready. `takeWhile` then `last` would throw when the
      // timeout fires without ever seeing ready; `take(1)` on a filtered stream
      // is what makes "wait for ready" mean exactly that.
      takeWhile((result) => !result.ready, true),
      last(),
    );
  }

  /**
   * One readiness probe.
   *
   * `/health/ready` is unauthenticated BY DESIGN (the setup app has no session
   * and no user database exists yet), so no credentials are attached. The body
   * is deliberately not parsed: the status code is the contract, and reading the
   * body would create a second interpretation of the API's health that could
   * disagree with the code.
   */
  async probe(): Promise<ApiProbeResult> {
    const response = await this.upstream.forward("/health/ready", { method: "GET" });

    if (response.status === 200) {
      return { ready: true, reason: "the API reports ready" };
    }

    // A non-200 is progress, not an error: 503 is what the API answers while it
    // provisions, which is the expected state for most of onboarding.
    return { ready: false, reason: `the API reports ${String(response.status)}` };
  }
}
