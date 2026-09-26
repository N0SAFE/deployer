import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import {
  Observable,
  Subject,
  Subscription,
  catchError,
  concatMap,
  filter,
  firstValueFrom,
  from,
  of,
  shareReplay,
  takeUntil,
  tap,
} from "rxjs";

import { SetupPhaseService } from "@/modules/health/setup-phase.service";
import { ClusterOrchestratorService } from "@/modules/cluster/services/cluster-orchestrator.service";
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
 *   1. The API is polled to ready BEFORE the ingress is touched. Swapping
 *      earlier points `api.<host>` at a process that is not serving.
 *   2. `dynamic-api.yml` is retargeted BEFORE anything else, so the hostname is
 *      continuously answerable — it changes BACKEND, never existence.
 *   3. `dynamic-setup.yml` is rewritten BEFORE this app exits, so
 *      `setup.<host>` degrades to the done page rather than a Traefik 404 for an
 *      operator who bookmarked the wizard.
 *   4. `ready` is published last, because it is the signal compose gates on —
 *      reporting it early would start the dashboard on a half-handed-over
 *      platform.
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

  /** Closes the cluster subscription and the pipeline on shutdown. */
  private readonly destroyed$ = new Subject<void>();
  private clusterSubscription: Subscription | null = null;

  private readonly results$: Observable<HandoverResult>;

  constructor(
    private readonly provisioner: ApiServiceProvisioner,
    private readonly readiness: ApiReadinessWatcherService,
    private readonly ingress: IngressHandoverService,
    private readonly phase: SetupPhaseService,
    private readonly cluster: ClusterOrchestratorService,
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
   * Start the handover when the cluster becomes active.
   *
   * SUBSCRIBING TO THE RESULT STREAM, not polling the phase: the cluster
   * orchestrator publishes its outcome, so reacting to it is an event handler
   * rather than a timer. That is what makes this app event-driven end to end —
   * no component in the chain asks "are we there yet?".
   *
   * `filter` on the terminal outcome, because `stream$` is a `shareReplay`
   * read-model: it replays its last value to a new subscriber, and without the
   * filter a LATE subscription would immediately re-trigger a handover for a
   * cluster attempt that already completed. `distinctUntilChanged` is not enough
   * here — the same object would be distinct from `undefined` but the value is
   * identical, so the filter keys on the fact that matters: is there an outcome.
   *
   * A failed cluster does NOT trigger the handover: there is no engine to
   * schedule onto, and the cluster's own failure is already the published reason.
   */
  onApplicationBootstrap(): void {
    this.clusterSubscription = this.cluster.stream$
      .pipe(
        // Skip the replay placeholder: `shareReplay` emits `undefined`-free but
        // a late subscriber re-receives the LAST result, which is exactly the
        // case this guard exists for.
        filter((result) => result.ok),
        takeUntil(this.destroyed$),
      )
      .subscribe((result) => {
        this.logger.log(
          `Cluster is active (${result.swarmRole}, ${String(result.nodeCount)} node(s)) — starting handover`,
        );
        this.attempt();
      });
  }

  /** Release the cluster subscription. */
  onModuleDestroy(): void {
    this.destroyed$.next();
    this.destroyed$.complete();
    this.clusterSubscription?.unsubscribe();
    this.clusterSubscription = null;
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
   * `driving` (the API is being asked to build the platform), and only the
   * ingress swap is `handover` ("the API is green; the ingress is being
   * retargeted" — `setup-phase.types.ts`). Reporting the swap as `handover` while
   * still waiting would make the wizard claim a step it has not reached.
   *
   * Never throws: a handover that cannot complete must leave the operator with a
   * reason and a retry, not a dead process. The failure is returned as data so
   * the pipeline above decides what to publish.
   */
  private async run(): Promise<HandoverResult> {
    try {
      this.phase.record("driving", "Resolving where the API is served…");

      // 1. Resolve the backend — in prod this CREATES the swarm service, so it
      //    must happen before any probe: there is nothing to poll until then.
      const backend = await this.provisioner.ensureApi();

      // 2. Point `api.<host>` at it IMMEDIATELY (invariant 2). Doing this before
      //    the API is ready is deliberate: the route then returns the API's own
      //    503, which is truthful and debuggable — whereas leaving the hostname
      //    unrouted would surface as a Traefik 404 that looks like a routing
      //    misconfiguration rather than "not provisioned yet".
      await this.ingress.pointApiAt(backend.url);

      // 3. Wait for the API to report ready (invariant 1). Still `driving`: the
      //    API is provisioning, and nothing has been handed over yet.
      this.phase.record("driving", `Waiting for the API at ${backend.url} to report ready…`);
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
   * Poll cadence.
   *
   * 2s: a provisioning run takes tens of seconds, so a slower interval would add
   * noticeable dead time at the end of onboarding, while a faster one would spam
   * a busy API for no gain.
   */
  private pollIntervalMs(): number {
    return 2_000;
  }

  /**
   * How long to wait for the API before declaring the handover failed.
   *
   * Five minutes: migrations plus admin bootstrap on a cold database legitimately
   * takes minutes, and a shorter limit would fail a working install. Longer would
   * leave an operator staring at a stuck wizard when something is genuinely
   * wrong — and the wizard offers a retry, so failing fast is recoverable.
   */
  private timeoutMs(): number {
    return 300_000;
  }
}
