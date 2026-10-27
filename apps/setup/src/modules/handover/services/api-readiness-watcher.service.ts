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
   * ── TWO PROBES, BECAUSE THERE ARE TWO QUESTIONS ─────────────────────────────
   * On the MICROSERVICES tier "is the API ready?" is not one question:
   *
   *   1. is the BFF itself up?              → the BFF's own `/health/ready`
   *   2. is the whole tier behind it green? → the BFF's `/health/platform/ready`
   *
   * `/health/ready` on the BFF answers only the FIRST. It is bound by the shared
   * server's preflight, which knows about that process's OWN dependencies (its
   * database, its Redis) — it cannot see `svc-project`, `svc-fleet`, or anything
   * else the BFF merely calls. So a tier where every backend is still starting
   * reports 200 here, and the handover would swap the ingress onto a BFF that has
   * nothing behind it: the operator lands on a console whose every request 502s
   * while setup has already declared success and exited.
   *
   * `/health/platform/ready` is the BFF's own roll-up — it fans out to every
   * service's `/health/ready` and returns 503 until ALL of them are green. That is
   * the real "the tier is up" signal, and it is why this method asks the second
   * question when the BFF offers to answer it.
   *
   * ── WHY THE FIRST PROBE IS KEPT ────────────────────────────────────────────
   * A MONOLITH (and the dev compose profile) has no `/health/platform/ready`, so it
   * must keep working. The BFF probe is therefore tried first, and the roll-up is
   * consulted only once the BFF is up. A 404 from the roll-up means "this
   * deployment has no tier to wait for", not "not ready" — treating it as the
   * latter would hang onboarding forever against a monolith.
   *
   * Both are unauthenticated BY DESIGN (the setup app has no session and no user
   * database exists yet), so no credentials are attached. Bodies are deliberately
   * not parsed except in the failure REASON: the status code is the contract, and
   * reconstructing the verdict from a body would be a second interpretation of the
   * API's health that could disagree with the code.
   */
  async probe(): Promise<ApiProbeResult> {
    const response = await this.upstream.forward("/health/ready", { method: "GET" });

    if (response.status !== 200) {
      // A non-200 is progress, not an error: 503 is what the API answers while it
      // provisions, which is the expected state for most of onboarding.
      return { ready: false, reason: `the API reports ${String(response.status)}` };
    }

    // The BFF is up. On a tier there is a second question.
    const tier = await this.upstream.forward("/health/platform/ready", { method: "GET" });

    if (tier.status === 404) {
      // No roll-up endpoint: a monolith, or an older API. Its own readiness is the
      // whole answer, exactly as before.
      return { ready: true, reason: "the API reports ready" };
    }

    if (tier.status === 200) {
      return { ready: true, reason: "the API reports ready and every service in the tier is green" };
    }

    // 401 means the endpoint is guarded in this build. Falling through to ready
    // would silently disable the gate, so it is reported as a failure the operator
    // can act on rather than swallowed.
    if (tier.status === 401 || tier.status === 403) {
      return {
        ready: false,
        reason: `the tier readiness endpoint is not public (HTTP ${String(tier.status)}) — it needs @AllowAnonymous()`,
      };
    }

    return {
      ready: false,
      reason: `the API is up but the tier is not: ${await this.describeTier(tier)}`,
    };
  }

  /**
   * Which services are still down, for the progress log.
   *
   * Reading the body ONLY on failure is deliberate: the happy path needs no
   * parsing, and a malformed body must not turn a legitimate "not ready yet" into a
   * thrown error that the pipeline treats as a fault.
   */
  private async describeTier(response: { json: () => Promise<unknown> }): Promise<string> {
    try {
      const body = await response.json();
      const platform = (body as { platform?: { services?: { name: string; healthy: boolean; reason?: string }[] } })
        .platform;
      const down = (platform?.services ?? []).filter((service) => !service.healthy);
      if (down.length === 0) return "the roll-up reported a failure with no per-service detail";
      const names = down.map((service) => `${service.name} (${service.reason ?? "not ready"})`);
      return `${String(down.length)} service(s) not ready — ${names.join(", ")}`;
    } catch {
      return "the roll-up reported a failure and its body could not be read";
    }
  }
}
