import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import {
  Observable,
  Subject,
  catchError,
  concatMap,
  filter,
  from,
  map,
  of,
  shareReplay,
  tap,
  timer,
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
export class ClusterOrchestratorService implements OnApplicationBootstrap {
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
          this.phase.record(
            "collecting",
            `Cluster active (${result.swarmRole}, ${String(result.nodeCount)} node(s)) — collecting setup details`,
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
   * Automatic startup, once the app is ready.
   *
   * `timer(0)` rather than a bare call: it puts the first attempt on the same
   * pipeline as every retry, so there is exactly one execution path. A direct
   * `this.start(...)` call would bypass the operator-visible phase transition.
   */
  onApplicationBootstrap(): void {
    timer(0).subscribe(() => {
      this.start({ kind: "found" });
    });
  }

  /** Start (or retry) the cluster phase. Safe to call while one is running. */
  start(mode: ClusterEntryMode): void {
    this.attempts$.next(mode);
  }

  /** The result stream, for consumers that want to REACT rather than poll. */
  get stream$(): Observable<ClusterBootstrapResult> {
    return this.results$;
  }
}
