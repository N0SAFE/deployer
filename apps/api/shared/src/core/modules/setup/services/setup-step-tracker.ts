import type {
    SetupStepId,
    SetupStreamEvent,
    SetupStreamSnapshotEvent,
    SetupStreamStepState,
} from "@repo/contracts-entities";

/**
 * Pure state holder for the steps of a single setup run.
 *
 * The setup stream is now driven by:
 *  - **State**: an instance of this class. It owns the canonical
 *    `{ stepId → SetupStreamStepState }` map (status, logs, timing,
 *    error) for the current run.
 *  - **Emission**: the inherited {@link BaseEventService.emit} from the
 *    core event service. After every state transition, the orchestration
 *    layer calls `setupEventService.emit("progress", {}, snapshotEvent)`
 *    to push the new snapshot to subscribers (with the same buffering /
 *    persistence / Subject semantics that every other domain event has).
 *
 * Why split it this way?
 * ----------------------
 * The previous `SetupStepEmitter` bundled state and emission into a
 * single class with a hand-rolled `subscribe()` / `Subject` API. It
 * reinvented what `BaseEventService` already does, but with no
 * buffering, no persistence, and no replay-on-late-subscribe.
 *
 * This class is the *minimum* surface needed by the local/remote flows:
 * start a step, append log lines, complete or fail it, then read the
 * current snapshot. The actual SSE stream is `setupEventService`'s
 * `progress` channel.
 */
export class SetupStepTracker {
    private readonly steps = new Map<SetupStepId, SetupStreamStepState>();
    private readonly stepStartTimes = new Map<SetupStepId, number>();
    private seq = 0;

    /**
     * Push a step into the running state.
     *
     * Idempotent: calling `start()` twice on the same step is a no-op
     * for the start time but updates the title / description if they
     * were missing on the first call.
     */
    start(stepId: SetupStepId, title: string, description?: string): void {
        const existing = this.steps.get(stepId);
        if (existing) {
            existing.title = title;
            if (description) existing.description = description;
            return;
        }
        const now = new Date();
        this.steps.set(stepId, {
            id: stepId,
            title,
            description,
            status: "in_progress",
            logs: [],
            startedAt: now.toISOString(),
        });
        this.stepStartTimes.set(stepId, now.getTime());
    }

    /**
     * Append a log line to a step. Silently drops the line if the step
     * wasn't started — the API pipeline is expected to call `start()`
     * first.
     */
    log(stepId: SetupStepId, line: string): void {
        const step = this.steps.get(stepId);
        if (!step) return;
        step.logs.push(line);
    }

    /**
     * Mark a step as completed with its measured duration.
     */
    complete(stepId: SetupStepId): void {
        const step = this.steps.get(stepId);
        if (!step) return;
        const startTime = this.stepStartTimes.get(stepId);
        step.status = "completed";
        step.durationMs = typeof startTime === "number" ? Date.now() - startTime : 0;
        step.completedAt = new Date().toISOString();
    }

    /**
     * Mark a step as failed, attach the error message, and stamp the
     * duration.
     */
    fail(stepId: SetupStepId, error: string): void {
        const step = this.steps.get(stepId);
        if (!step) return;
        const startTime = this.stepStartTimes.get(stepId);
        step.status = "failed";
        step.error = error;
        step.durationMs = typeof startTime === "number" ? Date.now() - startTime : 0;
        step.completedAt = new Date().toISOString();
    }

    /**
     * Build a fresh `snapshot` event from the current state. The caller
     * is responsible for pushing it through the event service:
     *
     * ```ts
     * tracker.start("provision_database", "Set up the database");
     * setupEventService.emit("progress", {}, tracker.snapshot());
     * ```
     */
    snapshot(): SetupStreamSnapshotEvent {
        this.seq += 1;
        return {
            type: "snapshot",
            seq: this.seq,
            ts: new Date().toISOString(),
            steps: Array.from(this.steps.values()).map((s) => ({ ...s, logs: [...s.logs] })),
        };
    }

    /**
     * Build a `log` event for one new line. The caller pushes it:
     *
     * ```ts
     * tracker.log("provision_database", "container ready");
     * setupEventService.emit("progress", {}, tracker.logEvent("provision_database", "container ready"));
     * ```
     *
     * Provided as a convenience so the seq counter and ts stay
     * consistent.
     */
    logEvent(stepId: SetupStepId, line: string): SetupStreamEvent | null {
        const step = this.steps.get(stepId);
        if (!step) return null;
        this.seq += 1;
        return {
            type: "log",
            stepId,
            line,
            seq: this.seq,
            ts: new Date().toISOString(),
        };
    }

    /**
     * Emit a server-driven step definition. The UI uses this to create
     * a placeholder task before any snapshot/log events arrive, so the
     * full pipeline is visible immediately without hardcoded templates.
     */
    stepDetailEvent(
        stepId: string,
        title: string,
        description: string,
    ): SetupStreamEvent {
        this.seq += 1;
        return {
            type: "step_detail",
            stepId,
            title,
            description,
            seq: this.seq,
            ts: new Date().toISOString(),
        };
    }

    /**
     * Build the terminal `completed` event for the run.
     */
    finishEvent(result: {
        nodeId: string;
        strategy: "local" | "remote";
        databaseUrl: string;
    }): SetupStreamEvent {
        return {
            type: "completed",
            result: {
                ...result,
                completedAt: new Date().toISOString(),
            },
        };
    }

    /**
     * Build the terminal `error` event for the run.
     */
    abortEvent(message: string): SetupStreamEvent {
        return { type: "error", message };
    }
}
