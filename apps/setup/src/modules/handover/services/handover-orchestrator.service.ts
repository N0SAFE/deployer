import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import {
  Observable,
  Subject,
  Subscription,
  catchError,
  concatMap,
  firstValueFrom,
  from,
  of,
  shareReplay,
  takeUntil,
  tap,
} from "rxjs";

import { SetupPhaseService } from "@/modules/health/setup-phase.service";
import { SetupGateService } from "@/modules/wizard/setup-gate.service";
import type { HandoverResult } from "../handover.types";
import { ApiServiceProvisioner } from "./api-service-provisioner.service";
import { ApiReadinessWatcherService } from "./api-readiness-watcher.service";
import { IngressHandoverService } from "./ingress-handover.service";

/**
 * Drives the handover: wait for the API, retarget the ingress, publish `ready`.
 *
 * ── WHY THIS IS A PIPELINE, NOT A SEQUENCE OF AWAITS ────────────────────────
 * The same reasons as `ClusterOrchestratorService`, and one more that is
 * specific to this phase: the handover has to be RE-RUNNABLE. The plan requires
 * that a failure leaves the platform retryable — setup does not exit, the stream
 * stays open, the operator retries. With a pipeline, retrying is one `next()` on
 * a `Subject` and `concatMap` guarantees the previous attempt is fully settled
 * first; with an imperative script, a retry button would need a mutex, because
 * two overlapping handovers would race on the same two ingress files.
 *
 * ── THE ORDERING INVARIANTS (plan §9.3) ─────────────────────────────────────
 * These are not cosmetic; each one prevents a specific outage:
 *
 *   1. The gate is open (the operator's choices are persisted), so the API may
 *      start — `ensureApi()` is what starts it in prod.
 *   2. The operator's choices are DELIVERED to the API (`POST /setup/trigger`),
 *      which is what makes it provision. Polling before this would wait for work
 *      nobody had asked for.
 *   3. The API is polled to ready BEFORE the ingress is touched. Swapping
 *      earlier points `api.<host>` at a process that is not serving.
 *   4. `dynamic-api.yml` is retargeted BEFORE anything else, so the hostname is
 *      continuously answerable — it changes BACKEND, never existence.
 *   5. `dynamic-setup.yml` is rewritten BEFORE this app exits, so
 *      `setup.<host>` degrades to the done page rather than a Traefik 404 for an
 *      operator who bookmarked the wizard.
 *   6. `ready` is published last, because it is the signal this app is about to
 *      stop — reporting it early would claim a platform that is not converged.
 *
 * ── WHAT HAPPENS WHEN IT FAILS ──────────────────────────────────────────────
 * Nothing is torn down. The phase goes `failed` with the reason, the wizard
 * shows it, and the operator retries. Every step is idempotent (the service
 * provisioner reuses an existing service, the file writes are atomic
 * overwrites), so a retry converges instead of colliding.
 */
@Injectable()
export class HandoverOrchestratorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(HandoverOrchestratorService.name);

  /**
   * Retry trigger. A plain `Subject` for the same reason as the cluster's: a
   * handover START is an edge, and replaying it to a late subscriber would fire
   * a second handover. The RESULT stream below carries the state.
   */
  private readonly attempts$ = new Subject<void>();

  /** Closes the gate subscription and the pipeline on shutdown. */
  private readonly destroyed$ = new Subject<void>();
  private gateSubscription: Subscription | null = null;

  /**
   * Transport used to deliver the setup trigger.
   *
   * A FIELD rather than a direct `fetch` call so a spec can drive the retry and
   * rejection paths without a live API. The default is the global `fetch`, which
   * is what runs in production — this is a seam, not a strategy: no second
   * implementation exists, and nothing chooses between them.
   */
  triggerTransport: typeof fetch = fetch;

  private readonly results$: Observable<HandoverResult>;

  constructor(
    private readonly provisioner: ApiServiceProvisioner,
    private readonly readiness: ApiReadinessWatcherService,
    private readonly ingress: IngressHandoverService,
    private readonly phase: SetupPhaseService,
    private readonly gate: SetupGateService,
  ) {
    this.results$ = this.attempts$.pipe(
      // Serialised: see the class note. A retry clicked mid-handover QUEUES.
      concatMap(() =>
        from(this.run()).pipe(
          catchError((error: unknown) => {
            // `run()` already converts throwable failures to data; reaching here
            // means an unexpected fault, so it is converted to the same shape to
            // keep ONE contract for consumers.
            const reason = error instanceof Error ? error.message : String(error);
            this.logger.error(`Handover faulted outside the service: ${reason}`);
            return of<HandoverResult>({ ok: false, reason });
          }),
        ),
      ),
      tap((result) => {
        if (result.ok) {
          // LAST, and only here: this is what lets compose start api/web.
          this.phase.record("ready", `Handed over to ${result.apiBackend}`, { apiReady: true });
        } else {
          this.phase.fail(`Handover failed: ${result.reason}`);
        }
      }),
      // Tied to this service's lifetime so a shutdown cannot leave the replay
      // buffer holding a reference to a destroyed container.
      takeUntil(this.destroyed$),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    // A pipeline with no subscriber never runs; this is what makes `attempts$`
    // hot so the caller can push and forget.
    this.results$.subscribe({
      error: (error: unknown) => {
        this.logger.error(`Handover pipeline terminated: ${String(error)}`);
      },
    });
  }

  /**
   * Start the handover when the GATE OPENS.
   *
   * ── WHY THE GATE AND NOT THE CLUSTER ──────────────────────────────────────
   * This used to subscribe to `cluster.stream$` — "the cluster is active, so
   * start the API". That was correct under the previous design, where the API
   * already existed and only had to be polled.
   *
   * The gate changes what must happen first. In prod, `ensureApi()` CREATES the
   * API's swarm service, so triggering it on cluster success would schedule the
   * API *before* the operator supplied a database — the API would boot with no
   * `databaseUrl`, report not-ready, and sit there consuming a task slot while
   * the wizard was still open.
   *
   * Subscribing to the gate instead makes the handover mean what it says: the
   * details are in `node_config`, so the API may be started and watched. In dev
   * the ordering is enforced by compose (`api-dev` gates on this app's health),
   * so `ensureApi()` just resolves the address compose will fill in.
   *
   * `filter`/`distinctUntilChanged` are not needed here: `onEnter` already
   * filters on the target phase and de-duplicates by timestamp, and the gate is
   * published at most once per `launching` transition.
   */
  onApplicationBootstrap(): void {
    this.gateSubscription = this.phase
      .onEnter("launching")
      .pipe(takeUntil(this.destroyed$))
      .subscribe(() => {
        this.logger.log("Gate is open — starting the handover pipeline");
        this.attempt();
      });
  }

  /** Release the gate subscription. */
  onModuleDestroy(): void {
    this.destroyed$.next();
    this.destroyed$.complete();
    this.gateSubscription?.unsubscribe();
    this.gateSubscription = null;
  }

  /** Start (or retry) the handover. Safe while one is running (it queues). */
  attempt(): void {
    this.attempts$.next();
  }

  /** The result stream, for consumers that want to REACT rather than poll. */
  get stream$(): Observable<HandoverResult> {
    return this.results$;
  }

  /**
   * The handover itself, in the order the invariants require.
   *
   * THE PHASE VOCABULARY IS LOAD-BEARING, so each step reports the phase that
   * matches what it is actually doing: waiting for the API to provision is
   * `provisioning` (the API is building the platform), and only the ingress
   * swap is `handover` ("the API is green; the ingress is being retargeted" —
   * `setup-phase.types.ts`). Reporting the swap as `handover` while still
   * waiting would make the wizard claim a step it has not reached.
   *
   * Never throws: a handover that cannot complete must leave the operator with a
   * reason and a retry, not a dead process. The failure is returned as data so
   * the pipeline above decides what to publish.
   */
  private async run(): Promise<HandoverResult> {
    try {
      this.phase.record("provisioning", "Resolving where the API is served…");

      // 1. Resolve the backend — in prod this CREATES the swarm service, so it
      //    must happen before any probe: there is nothing to poll until then.
      //    Reached only once the gate is open, i.e. after the operator's choices
      //    are in `node_config`, which is what the API reads on boot.
      const backend = await this.provisioner.ensureApi();

      // 2. Point `api.<host>` at it IMMEDIATELY (invariant 2). Doing this before
      //    the API is ready is deliberate: the route then returns the API's own
      //    503, which is truthful and debuggable — whereas leaving the hostname
      //    unrouted would surface as a Traefik 404 that looks like a routing
      //    misconfiguration rather than "not provisioned yet".
      await this.ingress.pointApiAt(backend.url);

      // 3. Deliver the operator's choices, then WAIT for the API to report ready.
      //
      //    ORDER MATTERS AND IS EASY TO GET WRONG: the trigger is what tells the
      //    API to provision, so polling for readiness BEFORE delivering it waits
      //    for work nobody has asked for. The API boots, finds a `databaseUrl`
      //    in `node_config`, connects, and only provisions the schema when
      //    `POST /setup/trigger` arrives.
      //
      //    Still `provisioning`: the API is building the platform, and nothing
      //    has been handed over yet.
      this.phase.record("provisioning", "Handing setup over to the platform API…");
      await this.deliverTrigger(backend.url);

      this.phase.record("provisioning", `Waiting for the API at ${backend.url} to report ready…`);
      const probe = await firstValueFrom(
        this.readiness.waitUntilReady(this.pollIntervalMs(), this.timeoutMs()),
      );

      if (!probe.ready) {
        return {
          ok: false,
          reason: `the API did not report ready within ${String(this.timeoutMs() / 1000)}s (${probe.reason})`,
        };
      }

      // 4. NOW the swap — and only now, which is what `handover` asserts.
      this.phase.record("handover", "The API is ready — retargeting the setup hostname…", {
        apiUp: true,
        apiReady: true,
      });

      // 5. `setup.<host>` now serves the API's done page (invariant 3).
      await this.ingress.pointSetupAtDonePage(backend.url);

      return { ok: true, apiBackend: backend.url };
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Handover failed: ${reason}`);
      return { ok: false, reason };
    }
  }

  /**
   * Deliver the operator's choices to the API, retrying until it answers.
   *
   * ── WHY THIS RETRIES RATHER THAN POSTING ONCE ───────────────────────────────
   * The trigger is sent the moment the gate opens, and the API is only then being
   * started (in prod: scheduled as a swarm task). So the first attempts land on a
   * process that does not exist yet, and a single POST would fail the whole
   * handover for the ordinary reason that a container takes seconds to boot.
   *
   * The retry is bounded by the same timeout the readiness poll uses, so a
   * genuinely broken API still fails the onboarding instead of retrying forever.
   *
   * ── WHY A 4xx IS NOT RETRIED ─────────────────────────────────────────────
   * A non-2xx from a *reachable* API means the request itself was rejected —
   * retrying an identical payload cannot change that, and it would hide a real
   * contract error behind a timeout. Connection failures and 5xx are transient
   * startup conditions and are retried.
   */
  private async deliverTrigger(backendUrl: string): Promise<void> {
    const payload = this.gate.triggerPayload();

    if (payload === null) {
      // A restart: `node_config` already holds the completed row, and migrate/seed
      // are idempotent, so the API provisions the delta on its own boot. There is
      // nothing to deliver — and nothing to invent, since the credentials were
      // never persisted (they are the operator's, not ours).
      this.logger.log("No trigger to deliver (setup already complete on this node)");
      return;
    }

    const deadline = Date.now() + this.timeoutMs();
    let lastReason = "the API never answered";

    for (;;) {
      try {
        const response = await this.triggerTransport(`${backendUrl}/setup/trigger`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          this.logger.log("Setup trigger delivered — the API is provisioning");
          return;
        }

        // Reachable but refusing: see the note above.
        if (response.status >= 400 && response.status < 500) {
          const body = await response.text().catch(() => "");
          throw new Error(
            `the API rejected the setup trigger (HTTP ${String(response.status)}): ${body.slice(0, 200)}`,
          );
        }

        lastReason = `the API answered ${String(response.status)}`;
      } catch (error: unknown) {
        // A non-2xx that we threw ourselves propagates: it is a contract error,
        // not a startup condition.
        if (error instanceof Error && error.message.startsWith("the API rejected")) {
          throw error;
        }
        lastReason = error instanceof Error ? error.message : String(error);
      }

      if (Date.now() >= deadline) {
        throw new Error(`could not deliver the setup trigger — ${lastReason}`);
      }

      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs()));
    }
  }

  /**
   * Poll cadence.
   *
   * 2s: a provisioning run takes tens of seconds, so a slower interval would add
   * noticeable dead time at the end of onboarding, while a faster one would spam
   * a busy API for no gain.
   *
   * A `protected` METHOD rather than a constant so a spec can compress the wait
   * when it is exercising the retry logic — the interval is policy, and policy
   * that cannot be observed without waiting real seconds tends not to be tested.
   */
  pollIntervalMs(): number {
    return 2_000;
  }

  /**
   * How long to wait for the API before declaring the handover failed.
   *
   * Five minutes: migrations plus admin bootstrap on a cold database legitimately
   * takes minutes, and a shorter limit would fail a working install. Longer would
   * leave an operator staring at a stuck wizard when something is genuinely
   * wrong — and the wizard offers a retry, so failing fast is recoverable.
   *
   * Also bounds the TRIGGER retry loop, so a misconfigured API cannot spin
   * forever inside `deliverTrigger`.
   */
  timeoutMs(): number {
    return 300_000;
  }
}
