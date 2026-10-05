import { Injectable, Logger } from "@nestjs/common";
import { ReplaySubject, type Observable } from "rxjs";
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
    const ids: OrchestrationStepId[] = [];

    if (this.orchestratesCluster()) ids.push("initialize_swarm");
    ids.push("start_api", "await_api_boot", "promote_ingress");

    return ids.map((stepId) => {
      const event: SetupStreamEvent = {
        type: "step_detail",
        stepId,
        title: TITLES[stepId],
        description: this.descriptionFor(stepId),
        ...this.stamp(),
      };
      this.emitted.next(event);
      return event;
    });
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

    this.emitted.next(event);
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

    this.emitted.next(event);
    return event;
  }

  /** The events emitted so far, for a late subscriber (page reload). */
  replay(): Observable<SetupStreamEvent> {
    return this.emitted.asObservable();
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

    this.emitted.next({ ...event, ...this.stamp() });
  }

  /** Report a terminal failure on the stream. */
  fail(message: string): void {
    this.emitted.next({ type: "error", message, ...this.stamp() });
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
