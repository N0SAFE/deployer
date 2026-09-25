import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { Observable, Subject, catchError, concatMap, from, of, shareReplay, tap, timer } from "rxjs";

import type { ClusterBootstrapResult, ClusterEntryMode } from "../cluster.types";
import { SwarmBootstrapService } from "./swarm-bootstrap.service";
import { SetupPhaseService } from "@/modules/health/setup-phase.service";
import { EnvService } from "@/config/env/env.module";

/**
 * Drives the cluster phase as an RxJS pipeline.
 *
 * WHY A PIPELINE AND NOT A SEQUENCE OF AWAITS
 * The wizard must show what is happening WHILE it happens, and the compose gate
 * must observe the phase change without polling. An imperative script would
 * have to either block until every step finished (no progress) or hand-roll an
 * emitter with a Set of listeners. RxJS gives both, and — decisively — gives
 * RE-RUNNABILITY: the operator retries a failed setup by pushing one value, and
 * the same pipeline re-runs with `concatMap` guaranteeing the previous attempt
 * has fully settled.
 *
 * WHY `concatMap` AND NOT `mergeMap`
 * Two concurrent bootstraps would race on the engine (one founding a cluster
 * while the other joins). `concatMap` serialises them, so a retry pushed during
 * an in-flight attempt is QUEUED rather than interleaved.
 *
 * WHY `shareReplay`
 * `GET /setup/state` and the wizard both want the outcome. Without replay they
 * would each re-run the pipeline, and a subscriber arriving after completion
 * would see nothing. Replay turns the pipeline into a hot read-model with one
 * execution.
 *
 * NOTHING HERE IS POLLED. Progress reaches every consumer by subscription, and
 * the phase transitions are pushed into `SetupPhaseService`, which the health
 * endpoint reads synchronously.
 */
@Injectable()
export class ClusterOrchestratorService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ClusterOrchestratorService.name);

  /**
   * Retry trigger. A plain `Subject` (not `BehaviorSubject`): an intent to
   * bootstrap is an EDGE, and replaying it to a late subscriber would start a
   * duplicate attempt. The `results$` stream is what carries state.
   */
  private readonly attempts$ = new Subject<ClusterEntryMode>();

  private readonly results$: Observable<ClusterBootstrapResult>;

  constructor(
    private readonly bootstrap: SwarmBootstrapService,
    private readonly phase: SetupPhaseService,
    private readonly env: EnvService,
  ) {
    this.results$ = this.attempts$.pipe(
      // Announce BEFORE the work: the wizard needs a phase the moment the
      // attempt starts, not only once the engine answers.
      tap(() => {
        this.phase.record("clustering", "Founding or joining the cluster…");
      }),
      concatMap((mode) =>
        from(this.bootstrap.bootstrap(mode)).pipe(
          catchError((error: unknown) => {
            // The service converts expected failures to data, so reaching here
            // means an unexpected fault. Convert it to the SAME shape so
            // consumers have exactly one result contract to handle.
            const reason = error instanceof Error ? error.message : String(error);
            this.logger.error(`Cluster attempt faulted outside the service: ${reason}`);
            return of<ClusterBootstrapResult>({ ok: false, reason });
          }),
        ),
      ),
      tap((result) => {
        if (result.ok) {
          this.phase.record(
            "driving",
            `Cluster active (${result.swarmRole}, ${String(result.nodeCount)} node(s))`,
          );
        } else {
          // `fail` is sticky by design: the operator must see it until a retry.
          this.phase.fail(`Cluster bootstrap failed: ${result.reason}`);
        }
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    // A cold pipeline with no subscriber never runs. Subscribing HERE is what
    // makes `attempts$` hot, so a caller can push and forget.
    this.results$.subscribe({
      error: (error: unknown) => {
        // `catchError` above makes this unreachable today. Logging it means a
        // future refactor that breaks that invariant is VISIBLE rather than
        // silently wedging the pipeline.
        this.logger.error(`Cluster pipeline terminated: ${String(error)}`);
      },
    });
  }

  /**
   * Kick off the cluster phase on boot.
   *
   * `timer(0)` rather than a direct call: it puts the first attempt on the SAME
   * pipeline as every retry, so there is one execution path and the phase
   * transition is always recorded. A direct call would bypass both.
   *
   * The entry mode is derived from THIS app's environment rather than
   * hardcoded: a node handed a join token must join, and inventing a cluster
   * first would leave Raft state that only a `leave --force` can undo.
   */
  onApplicationBootstrap(): void {
    timer(0).subscribe(() => {
      this.start(this.entryModeFromEnv());
    });
  }

  /** Start (or retry) the cluster phase. Safe while another attempt is running. */
  start(mode: ClusterEntryMode): void {
    this.attempts$.next(mode);
  }

  /** Push a retry using the configured entry mode. */
  retry(): void {
    this.start(this.entryModeFromEnv());
  }

  /** The result stream, for consumers that want to REACT rather than poll. */
  get stream$(): Observable<ClusterBootstrapResult> {
    return this.results$;
  }

  /**
   * How this node enters a cluster, from the app's own environment.
   *
   * A join token means the operator is enrolling this node into an existing
   * fleet; anything else means it founds one. Reading this HERE (not in the
   * package) is the §8.7 split: which variable carries the decision is this
   * app's convention.
   */
  private entryModeFromEnv(): ClusterEntryMode {
    const joinToken = this.env.get("SWARM_JOIN_TOKEN");
    if (joinToken !== undefined && joinToken.length > 0) {
      return {
        kind: "join",
        joinToken,
        remoteAddrs: this.env.get("SWARM_JOIN_ADDRS")?.split(",") ?? [],
      };
    }
    return { kind: "found" };
  }
}
