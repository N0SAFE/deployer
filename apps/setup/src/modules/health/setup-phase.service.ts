import { Injectable, Logger } from "@nestjs/common";
import { BehaviorSubject, Observable, Subject, filter, map, distinctUntilChanged } from "rxjs";

import type { SetupPhase, SetupPhaseEvent, SetupPhaseSnapshot } from "./setup-phase.types";

/**
 * Single source of truth for the setup app's lifecycle phase, published as an
 * RxJS event stream.
 *
 * WHY events rather than getters: the compose gate (`GET /setup/health`), the
 * wizard's read model (`GET /setup/state`) and the orchestration steps all need
 * this state, and they run on different code paths. With getters, every
 * consumer that wants to REACT has to poll. With a `BehaviorSubject`, a consumer
 * subscribes once and is told — and a late subscriber still gets the current
 * value immediately, so there is no "subscribe after the interesting moment"
 * race.
 *
 * The phase is only ever moved by the service that does the work; nothing here
 * guesses or infers.
 */
@Injectable()
export class SetupPhaseService {
  private readonly logger = new Logger(SetupPhaseService.name);

  private static readonly INITIAL: SetupPhaseSnapshot = {
    phase: "awaiting",
    detail: "Setup has not started yet",
    apiUp: false,
    apiReady: false,
    updatedAt: new Date(0).toISOString(),
  };

  /**
   * `BehaviorSubject`, not `Subject`: the gate may be probed before any
   * transition has occurred, and a plain Subject would make that first read
   * block forever waiting for an event that already "happened" at construction.
   */
  private readonly state$ = new BehaviorSubject<SetupPhaseSnapshot>({
    ...SetupPhaseService.INITIAL,
    updatedAt: new Date().toISOString(),
  });

  /**
   * Transitions only — for consumers that react to EDGES, not to state.
   *
   * A plain `Subject`, NOT a `BehaviorSubject`: replaying the last edge to a
   * late subscriber would re-fire edge-triggered work (e.g. "on failure, start
   * recovery" running again for a failure already handled). State replays via
   * `snapshot$`; edges are consumed once, by whoever is listening.
   */
  private readonly transitions$ = new Subject<SetupPhaseEvent>();

  /** Current phase, for synchronous reads (the Terminus indicator). */
  current(): SetupPhaseSnapshot {
    return { ...this.state$.value };
  }

  /** Current phase as a stream. Replays the current value to new subscribers. */
  get snapshot$(): Observable<SetupPhaseSnapshot> {
    return this.state$.asObservable();
  }

  /** Every transition, for consumers reacting to edges. */
  get events$(): Observable<SetupPhaseEvent> {
    return this.transitions$.asObservable();
  }

  /** Transitions INTO a specific phase. */
  onEnter(phase: SetupPhase): Observable<SetupPhaseEvent> {
    return this.events$.pipe(
      filter((event) => event.to === phase),
      distinctUntilChanged((a, b) => a.at === b.at),
    );
  }

  /** The phase as a stream of phase names (ignores detail/flag churn). */
  get phase$(): Observable<SetupPhase> {
    return this.state$.pipe(
      map((snapshot) => snapshot.phase),
      distinctUntilChanged(),
    );
  }

  /**
   * Record a progress signal.
   *
   * `failed` is sticky on purpose: a phase that later looks "driving" again
   * must not silently erase an error the operator has not seen yet. Clearing it
   * is an explicit act (a retry), never a side effect of progress.
   */
  record(
    phase: Exclude<SetupPhase, "failed">,
    detail: string,
    flags: { apiUp?: boolean; apiReady?: boolean } = {},
  ): void {
    if (this.state$.value.phase === "failed") {
      this.logger.warn(`Ignoring "${phase}" — still in the failed state until the operator retries`);
      return;
    }
    this.publish(phase, detail, flags);
  }

  /** Record a terminal failure with the reason that caused it. */
  fail(reason: string, flags: { apiUp?: boolean; apiReady?: boolean } = {}): void {
    // ERROR, not WARN: a failed setup blocks the whole platform, and the
    // operator needs to find it in the logs without grepping for WARN too.
    this.publish("failed", reason, flags, true);
  }

  /**
   * Clear a previous failure so the flow can run again.
   *
   * Re-running must be safe (the plan's requirement): the swarm init is
   * idempotent and the DB provisioner skips work already done, so resetting the
   * PHASE is all that is needed — there is no half-built state to unwind.
   */
  reset(): void {
    this.publish("awaiting", "Setup was reset and is waiting to start again", { apiReady: false });
    this.logger.log("Setup phase reset — ready to re-run");
  }

  /** Readiness as compose consumes it: only `ready` counts. */
  isReady(): boolean {
    return this.state$.value.phase === "ready";
  }

  /**
   * Publish one transition: update state, then notify.
   *
   * The transition event is emitted AFTER the state subject so a subscriber
   * that reads `current()` inside its `events$` handler sees the new value, not
   * the one it just replaced.
   */
  private publish(
    phase: SetupPhase,
    detail: string,
    flags: { apiUp?: boolean; apiReady?: boolean },
    isFailure = false,
  ): void {
    const previous = this.state$.value;
    const snapshot: SetupPhaseSnapshot = {
      phase,
      detail,
      apiUp: flags.apiUp ?? previous.apiUp,
      apiReady: flags.apiReady ?? previous.apiReady,
      updatedAt: new Date().toISOString(),
    };

    this.state$.next(snapshot);
    this.transitions$.next({ from: previous.phase, to: phase, snapshot, at: snapshot.updatedAt });

    if (isFailure) {
      this.logger.error(`Setup FAILED: ${detail}`);
    } else {
      this.logger.log(`Setup phase ${previous.phase} → ${phase}: ${detail}`);
    }
  }
}
