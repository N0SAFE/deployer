import { Injectable, Logger } from "@nestjs/common";
import {
  Observable,
  Subject,
  catchError,
  concatMap,
  from,
  of,
  shareReplay,
  tap,
} from "rxjs";

import type { ClusterBootstrapResult, ClusterEntryMode } from "../cluster.types";
import { SwarmBootstrapService } from "./swarm-bootstrap.service";
import { SetupPhaseService } from "@/modules/health/setup-phase.service";

/**
 * Drives the cluster phase as an RxJS pipeline.
 *
 * WHY A PIPELINE AND NOT `await bootstrap(); await next()`
 * The wizard must be able to show what is happening WHILE it happens, and the
 * compose gate must observe the phase change without polling. An imperative
 * script would have to either block until every step finished (no progress) or
 * hand-roll an event emitter with a `Set` of listeners. RxJS gives both for
 * free, and — more importantly — gives RE-RUNNABILITY: the operator can retry a
 * failed setup by pushing onto one `Subject`, and the same pipeline re-runs with
 * `concatMap` guaranteeing the previous attempt is fully settled first.
 *
 * WHY `concatMap` AND NOT `mergeMap`
 * Two concurrent bootstraps would race on the Docker engine (one founding a
 * cluster while the other joins). `concatMap` serialises them, so a retry
 * clicked during an in-flight attempt is QUEUED, not interleaved.
 *
 * WHY `shareReplay` ON THE FAILURE STREAM
 * `GET /setup/state` and the wizard both read the last result. Without replay
 * they would each re-run the pipeline (or miss the outcome entirely if they
 * subscribed after it completed). Replay makes the stream a hot read-model with
 * one execution.
 */
@Injectable()
export class ClusterOrchestratorService {
  private readonly logger = new Logger(ClusterOrchestratorService.name);

  /**
   * Retry trigger. A `Subject` (not a `BehaviorSubject`): an intent to
   * bootstrap is an EDGE, and replaying it to a late subscriber would start a
   * duplicate attempt. The RESULT stream below is what carries state.
   */
  private readonly attempts$ = new Subject<ClusterEntryMode>();

  private readonly results$: Observable<ClusterBootstrapResult>;

  constructor(
    private readonly bootstrap: SwarmBootstrapService,
    private readonly phase: SetupPhaseService,
  ) {
    this.results$ = this.attempts$.pipe(
      // Announce BEFORE the work: the wizard needs a phase the moment the
      // attempt starts, not after the engine answers.
      tap(() => {
        this.phase.record("clustering", "Founding or joining the cluster…");
      }),
      // `concatMap` serialises: see the class note.
      concatMap((mode) =>
        from(this.bootstrap.bootstrap(mode)).pipe(
          catchError((error: unknown) => {
            // The service already converts throwable failures to data, so
            // reaching here means an unexpected fault (e.g. a DI failure).
            // Convert it to the same shape so consumers have ONE contract.
            const reason = error instanceof Error ? error.message : String(error);
            this.logger.error(`Cluster attempt faulted outside the service: ${reason}`);
            return of<ClusterBootstrapResult>({ ok: false, reason });
          }),
        ),
      ),
      tap((result) => {
        if (result.ok) {
          // ── THE GATE OPENS HERE ────────────────────────────────────────────
          // `launching` means "the platform may start the API", and the swarm
          // must exist BEFORE it does: the API's own supervisors schedule their
          // services onto this cluster, and a swarm GLOBAL service cannot be
          // created on an engine that is not a swarm.
          //
          // Reporting `collecting` here (as this did when the cluster converged
          // at BOOT) would now be wrong: by the time this runs the wizard has
          // already finished collecting, and the operator is watching a
          // progress screen, not a form.
          this.phase.record(
            "launching",
            `Cluster active (${result.swarmRole}, ${String(result.nodeCount)} node(s)) — the platform API may start`,
          );
        } else {
          // Sticky failure: the operator must see it until they retry.
          this.phase.fail(`Cluster bootstrap failed: ${result.reason}`);
        }
      }),
      // One execution, replayed to every subscriber (state + wizard).
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    // A pipeline with no subscriber never runs. This subscription is what makes
    // `attempts$` hot, so the HTTP handler can push and forget.
    this.results$.subscribe({
      error: (error: unknown) => {
        // `catchError` above should make this unreachable; logging it here
        // means a future refactor that breaks that invariant is visible
        // instead of silently wedging the pipeline.
        this.logger.error(`Cluster pipeline terminated: ${String(error)}`);
      },
    });
  }

  /**
   * The cluster phase is STARTED BY THE WIZARD, not by app boot.
   *
   * ── WHY THIS IS NOT `onApplicationBootstrap` ANY MORE ───────────────────────
   * The engine must be untouched until the operator has said how this node joins
   * the cluster. Founding one is not reversible without destroying Raft state,
   * so a node that is about to JOIN a fleet must not have already invented a
   * cluster of its own — and auto-founding at boot is exactly how that happened.
   *
   * The wizard is the only thing that knows the answer, so it is the only thing
   * that may start this. `SetupGateService.open()` calls `start(mode)` with the
   * operator's choice, which is also what keeps the ordering in ONE place:
   *
   *   1. swarm (HERE — the engine must exist before anything can be scheduled)
   *   2. the API, scheduled onto that swarm
   *   3. the ingress, which the API converges as a swarm service
   *
   * The ordering matters mechanically, not cosmetically: a swarm GLOBAL service
   * cannot be created on an engine that is not a swarm, so doing any of the later
   * steps first fails.
   *
   * ── THE RESTART PATH ────────────────────────────────────────────────────────
   * `SetupGateService.onApplicationBootstrap()` opens the gate immediately when
   * `node_config.setupState` is already `setup_done`, and it calls `start()`
   * itself — so a restart still converges without a wizard. The difference is
   * that the decision comes from the PERSISTED row, not from a default.
   */

  /**
   * Start (or retry) the cluster phase.
   *
   * Safe to call while one is running: `concatMap` queues it, so a retry clicked
   * during an in-flight attempt cannot race the engine.
   */
  start(mode: ClusterEntryMode): void {
    this.attempts$.next(mode);
  }

  /** The result stream, for consumers that want to REACT rather than poll. */
  get stream$(): Observable<ClusterBootstrapResult> {
    return this.results$;
  }
}
