import { Injectable, Logger } from "@nestjs/common";
import { ReplaySubject, skip, type Observable } from "rxjs";
import type { SetupStreamEvent, SetupStepId } from "@repo/contracts-entities";

import { EnvService } from "@/config/env/env.module";

/** Which orchestration steps this profile performs, and their state. */
export type OrchestrationStepId = Extract<
    SetupStepId,
    "initialize_swarm" | "start_api" | "await_api_boot" | "promote_ingress"
>;

type StepStatus = "pending" | "in_progress" | "completed" | "failed";

/**
 * Builds the setup app's ORCHESTRATION stream — the steps setup itself drives.
 *
 * ── WHY SETUP OWNS A STREAM AT ALL ──────────────────────────────────────────
 * The API's `/setup/stream` reports PROVISIONING (migrate, seed, admin,
 * supervisors). It cannot report the steps that come BEFORE it, because it is
 * the thing being started:
 *
 *   1. `initialize_swarm` — founding/joining the swarm   (prod only)
 *   2. `start_api`        — scheduling or awaiting the API
 *   3. `await_api_boot`   — the API's own boot output, streamed
 *
 * So setup emits those as ordinary `step_detail` / `snapshot` / `log` events —
 * the SAME shape and the SAME step vocabulary the API uses — then FORWARDS the
 * API's frames verbatim. The wizard renders one continuous timeline and never
 * learns who produced which step, which is what keeps the two producers from
 * needing to agree on anything beyond the event schema.
 *
 * ── WHY `dev` EMITS FEWER STEPS ─────────────────────────────────────────────
 * In plain compose `dev` the profile runs NO cluster at all: compose owns the
 * API and the engine is never touched. Emitting a "founding the cluster" step
 * there would misdescribe what that profile does, so it is skipped.
 */
@Injectable()
export class OrchestrationStreamService {
  private readonly logger = new Logger(OrchestrationStreamService.name);

  /** Monotonic sequence, shared by every event this service emits. */
  private seq = 0;

  /**
   * Replayed so a page reload mid-boot still shows the steps so far.
   *
   * Bounded: a page reload is the only consumer, and an unbounded buffer would
   * grow for the lifetime of a long boot.
   */
  private readonly emitted = new ReplaySubject<SetupStreamEvent>(200);

  /**
   * Per-step log buffers, so a `snapshot` can carry the complete state.
   *
   * Keyed by the FULL `SetupStepId`, not the narrower orchestration subset: once
   * the API's frames are forwarded, their steps (`run_migrations`, `finalize`, …)
   * are buffered here too, so a later snapshot stays consistent with the deltas
   * the client already received.
   */
  private readonly logs = new Map<SetupStepId, string[]>();

  /**
   * The step definitions, ONCE — replayed verbatim to every late subscriber.
   *
   * ── WHY THIS IS CACHED RATHER THAN REBUILT ──────────────────────────────────
   * The stream is served per HTTP request, and a reconnecting client makes a NEW
   * request. Rebuilding the definitions each time re-EMITTED them into the
   * replay buffer, so every reconnect appended another full set — and the client
   * rebuilt its step list from duplicates rather than from the state it already
   * had.
   */
  private announced: SetupStreamEvent[] | null = null;

  /**
   * The LATEST known state of every step, from either producer.
   *
   * ── WHY STATE IS KEPT, NOT JUST EVENTS ──────────────────────────────────────
   * A reconnecting client needs to RE-SYNC, and the cheapest correct answer is
   * one snapshot of the current state rather than the whole event history: the
   * history would re-run every step visually, while a snapshot lands in place.
   *
   * Populated from setup's own `snapshot()` calls AND from the API's forwarded
   * snapshots, so it always reflects whichever process last spoke about a step.
   */
  private readonly latestStatus = new Map<
    SetupStepId,
    { title: string; status: StepStatus | "skipped"; error?: string }
  >();

  /**
   * How many events have been emitted so far.
   *
   * ── WHY A SUBSCRIBER NEEDS THIS ────────────────────────────────────────────
   * A (re)connecting client is re-synced from `currentSnapshot()` — full status
   * AND full logs for every step. Replaying the buffer on top of that would
   * re-apply the HISTORY, including the original all-`pending` snapshot, which
   * walks every finished step back to idle on screen.
   *
   * So the live tail is `skip(this count)`: everything already folded into the
   * sync snapshot is left out, and only events emitted AFTER it are delivered.
   * Nothing is lost either — the snapshot carries the aggregate state, so a
   * client that missed events while disconnected still has the current truth.
   */
  private emittedCount = 0;

  /** Single emission point, so `emittedCount` can never drift from the buffer. */
  private push(event: SetupStreamEvent): void {
    this.emittedCount += 1;
    this.emitted.next(event);
  }

  constructor(private readonly env: EnvService) {}

  /**
   * Whether THIS profile starts a cluster.
   *
   * `SETUP_MODE=prod` means setup owns the API, which it schedules onto the
   * swarm — so the swarm is setup's job. In `dev` the API is a compose service
   * and the swarm is not involved at all.
   *
   * This reads the MODE rather than a separate cluster flag on purpose: there is
   * one decision ("who starts the API") and the swarm follows from it. A second
   * flag could disagree with the first.
   */
  orchestratesCluster(): boolean {
    return this.env.get("SETUP_MODE") === "prod";
  }

  private stamp(): { seq: number; ts: string } {
    this.seq += 1;
    return { seq: this.seq, ts: new Date().toISOString() };
  }

  /**
   * Announce the steps this run will perform.
   *
   * Emitted BEFORE the first snapshot so the wizard renders the whole pipeline
   * up front — the operator sees what is coming rather than a progress bar that
   * grows with no visible end.
   */
  stepDetails(): SetupStreamEvent[] {
    // Idempotent: a reconnect re-requests the stream, and re-announcing would
    // append a second full set of definitions to the replay buffer.
    if (this.announced !== null) return this.announced;

    const ids: OrchestrationStepId[] = [];

    if (this.orchestratesCluster()) ids.push("initialize_swarm");
    ids.push("start_api", "await_api_boot", "promote_ingress");

    this.announced = ids.map((stepId) => {
      const event: SetupStreamEvent = {
        type: "step_detail",
        stepId,
        title: TITLES[stepId],
        description: this.descriptionFor(stepId),
        ...this.stamp(),
      };
      this.push(event);
      return event;
    });

    return this.announced;
  }

  /**
   * The CURRENT state of every known step, as one snapshot.
   *
   * ── THIS IS WHAT MAKES A RECONNECT FEEL INSTANT ─────────────────────────────
   * Sent to a (re)connecting client BEFORE the live stream. It carries the state
   * each step actually has right now, so a client that already drew the earlier
   * steps sees them stay put — rather than the whole pipeline resetting to
   * `pending` and re-running visually, which is what an all-pending snapshot did.
   *
   * Returned WITHOUT emitting, because it is per-subscriber: the live stream
   * already replays past events, and emitting here would duplicate it for
   * everyone currently connected.
   *
   * Empty when nothing has been reported yet, in which case the client's step
   * list comes from the `step_detail` events alone.
   */
  currentSnapshot(): SetupStreamEvent | null {
    if (this.latestStatus.size === 0) return null;

    return {
      type: "snapshot",
      ...this.stamp(),
      steps: [...this.latestStatus.entries()].map(([id, state]) => ({
        id,
        title: state.title,
        status: state.status,
        logs: this.logs.get(id) ?? [],
        ...(state.error === undefined ? {} : { error: state.error }),
      })),
    };
  }

  /**
   * A full snapshot of the orchestration steps.
   *
   * Emitted on every status change so a consumer renders directly from the
   * latest snapshot without replaying log deltas — the same contract the API's
   * own stream uses, which is what lets the wizard treat both producers
   * identically.
   */
  snapshot(entries: Array<{ id: OrchestrationStepId; status: StepStatus; error?: string }>): SetupStreamEvent {
    const event: SetupStreamEvent = {
      type: "snapshot",
      ...this.stamp(),
      steps: entries.map((entry) => ({
        id: entry.id,
        title: TITLES[entry.id],
        status: entry.status,
        logs: this.logs.get(entry.id) ?? [],
        // Spread conditionally: `error` is optional, and writing `undefined`
        // explicitly would fail the schema's exactOptionalPropertyTypes shape.
        ...(entry.error === undefined ? {} : { error: entry.error }),
      })),
    };

    // Remembered so a later reconnect re-syncs from STATE rather than
    // replaying the history — see `currentSnapshot`.
    for (const step of event.steps) {
      this.latestStatus.set(step.id, {
        title: step.title,
        status: step.status,
        ...(step.error === undefined ? {} : { error: step.error }),
      });
    }

    this.push(event);
    return event;
  }

  /**
   * One log line on an orchestration step.
   *
   * A `log` event is a DELTA against the latest snapshot, so a step producing
   * hundreds of lines (the API's boot output) does not make every frame O(n) —
   * which is exactly why the contract carries `log` separately from `snapshot`.
   */
  log(stepId: OrchestrationStepId, line: string): SetupStreamEvent {    const buffer = this.logs.get(stepId) ?? [];
    buffer.push(line);
    // Bounded: a runaway process must not turn the stream into a memory leak,
    // and the wizard only renders the tail anyway.
    const MAX_LINES = 500;
    if (buffer.length > MAX_LINES) buffer.splice(0, buffer.length - MAX_LINES);
    this.logs.set(stepId, buffer);

    const event: SetupStreamEvent = {
      type: "log",
      stepId,
      line,
      ...this.stamp(),
    };

    this.push(event);
    return event;
  }

  /**
   * The events emitted AFTER `afterCount` — the live tail, no history.
   *
   * Paired with `currentSnapshot()` this forms one atomic re-sync: the caller
   * reads the count, then sends the snapshot, then subscribes here — so the
   * subscriber sees every event exactly once and never re-applies one it has
   * already folded into its state.
   */
  liveAfter(afterCount: number): Observable<SetupStreamEvent> {
    return this.emitted.pipe(skip(afterCount));
  }

  /** How many events have been emitted — the cutoff `liveAfter` takes. */
  emittedSoFar(): number {
    return this.emittedCount;
  }

  /**
   * Forward an event produced by ANOTHER process (the API), unchanged.
   *
   * Re-stamped with this stream's sequence so a client that orders by `seq`
   * still sees a monotonic series across both producers — the API's own
   * sequence restarts at 0, and interleaving two counters would make the client
   * read the timeline backwards.
   *
   * The PAYLOAD is untouched: these are the API's events, and rewriting them
   * would make this a second producer of provisioning state rather than a
   * transport for it.
   */
  forward(event: SetupStreamEvent): void {
    if (event.type === "log") {
      // Log lines are appended to the step's buffer so a later `snapshot`
      // (which carries the full buffer) stays consistent with the deltas the
      // client already received.
      const buffer = this.logs.get(event.stepId) ?? [];
      buffer.push(event.line);
      this.logs.set(event.stepId, buffer);
    }

    // Track the API's step states too, so a reconnect re-syncs from the SAME
    // source of truth regardless of which producer owns the step.
    if (event.type === "snapshot") {
      for (const step of event.steps) {
        this.latestStatus.set(step.id, {
          title: step.title,
          status: step.status,
          ...(step.error === undefined ? {} : { error: step.error }),
        });
      }
    }

    this.push({ ...event, ...this.stamp() });
  }

  /** Report a terminal failure on the stream. */
  fail(message: string): void {
    this.push({ type: "error", message, ...this.stamp() });
  }

  private descriptionFor(stepId: OrchestrationStepId): string {
    switch (stepId) {
      case "initialize_swarm":
        return "Founding or joining the swarm this platform runs on";
      case "start_api":
        return this.orchestratesCluster()
          ? "Scheduling the API onto the cluster"
          : "Waiting for the API container to come up";
      case "await_api_boot":
        return "Streaming the API's own output as it initialises";
      case "promote_ingress":
        return "Handing the entry port to the cluster's ingress and waiting until it answers";
    }
  }
}

const TITLES: Record<OrchestrationStepId, string> = {
  initialize_swarm: "Starting the cluster",
  start_api: "Starting the platform API",
  await_api_boot: "Waiting for the API to boot",
  promote_ingress: "Switching to the cluster ingress",
};
