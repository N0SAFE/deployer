import { Injectable, Logger } from "@nestjs/common";
import { Observable, from, interval, map, merge, takeUntil, Subject, share, concat, type Subscription } from "rxjs";
import type { SetupStreamEvent } from "@repo/contracts-entities";

import { WizardUpstreamService } from "./wizard-upstream.service";
import {
  OrchestrationStreamService,
  type OrchestrationStepId,
} from "@/modules/progress/services/orchestration-stream.service";
import { SetupPhaseService } from "@/modules/health/setup-phase.service";

/**
 * The setup progress stream: setup's own orchestration, then the API's.
 *
 * ── TWO ROLES, AND WHY THE FIRST IS NEW ─────────────────────────────────────
 * The original rule (plan §10.1) was "setup is a PIPE, never a second producer"
 * — correct while setup had nothing of its own to report. It now does: setup
 * starts the cluster, starts the API, and streams the API's boot output, and the
 * API cannot report on any of that because it is the process being started.
 *
 * So setup is a PRODUCER for its own three steps and a PIPE for everything
 * after. Both sides emit the SAME `SetupStreamEvent` schema, so the wizard
 * renders one timeline and never learns which process produced which step.
 *
 * ── WHY RxJS ────────────────────────────────────────────────────────────────
 * The stream is a long-lived subscription that must:
 *   - tear the upstream connection down when the client disconnects (no leaked
 *     sockets against the API),
 *   - survive reconnection by replaying via `Last-Event-ID`,
 *   - retry the upstream connection until the API answers (it starts BEHIND the
 *     gate, so it legitimately does not exist when the wizard subscribes),
 *   - feed the phase state machine so `/setup/state` reflects "provisioning".
 * Those are stream-composition problems, and expressing them as an Observable
 * keeps teardown in one place (`takeUntil`) rather than spread across try/finally
 * blocks in a request handler.
 */
@Injectable()
export class WizardStreamService {
  private readonly logger = new Logger(WizardStreamService.name);

  /**
   * Live upstream subscriptions, so a shutdown can cancel them.
   *
   * An abandoned reader keeps a socket open against the API for the lifetime of
   * this process — and setup is a long-lived container, so that would accumulate.
   */
  private readonly upstreamSubscriptions = new Set<Subscription>();

  constructor(
    private readonly upstream: WizardUpstreamService,
    private readonly phase: SetupPhaseService,
  ) {}

  /**
   * The upstream event stream as an Observable of raw SSE frames.
   *
   * `lastEventId` is forwarded so the API's own replay works for a late
   * subscriber: the client reconnects with the id it last saw, and the upstream
   * resends everything after it. Without this a reload mid-provision would show
   * an empty progress view even though the work is running.
   */
  stream(lastEventId?: string): Observable<string> {
    return from(this.openUpstream(lastEventId)).pipe(
      // One upstream connection shared by every subscriber of THIS call, so two
      // browser tabs do not double the load on the API.
      share(),
      map((frame) => frame),
    );
  }

  /**
   * Open the upstream SSE connection and yield decoded frames.
   *
   * Frames are split on the SSE blank-line delimiter and yielded as-is: parsing
   * `event:`/`data:` fields here would mean re-encoding them for the client, and
   * any field this app did not know about would be silently dropped.
   */
  private async *openUpstream(lastEventId?: string): AsyncGenerator<string> {
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (lastEventId !== undefined && lastEventId.length > 0) {
      headers["Last-Event-ID"] = lastEventId;
    }

    const response = await this.upstream.forward("/setup/stream", {
      method: "GET",
      headers,
    });

    if (!response.ok || response.body === null) {
      // Surfaced as a stream error rather than thrown: the caller has already
      // committed to an SSE response by this point, so there is no HTTP status
      // left to change. The wizard renders the error from the stream.
      this.phase.fail(
        `The platform API refused the event stream (HTTP ${String(response.status)})`,
      );
      return;
    }

    this.logger.log("Upstream setup stream connected");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a BLANK line. Splitting on a single
        // newline would cut multi-line `data:` payloads in half and produce
        // invalid frames on the client.
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (frame.trim().length > 0) yield frame + "\n\n";
          boundary = buffer.indexOf("\n\n");
        }
      }
      // Flush a trailing frame that arrived without its terminating blank line.
      if (buffer.trim().length > 0) yield buffer + "\n\n";
    } finally {
      // ALWAYS release the upstream connection: an abandoned reader keeps a
      // socket open against the API for the lifetime of the process.
      await reader.cancel().catch(() => undefined);
      this.logger.log("Upstream setup stream closed");
    }
  }

  /**
   * Pipe the upstream stream into an HTTP response, ending when the client goes
   * away.
   *
   * `clientGone` is how the caller signals a disconnect; wiring it through
   * `takeUntil` means the upstream reader is cancelled by the SAME subscription
   * that writes to the client, so there is exactly one teardown path.
   */
  async pipeTo(
    res: { write(chunk: string): void; end(): void },
    clientGone: Subject<void>,
    lastEventId?: string,
  ): Promise<void> {
    this.phase.record("provisioning", "Receiving provisioning progress from the platform API");

    return await new Promise<void>((resolve, reject) => {
      this.stream(lastEventId)
        .pipe(takeUntil(clientGone))
        .subscribe({
          next: (frame) => {
            res.write(frame);
          },
          error: (error: unknown) => {
            const reason = error instanceof Error ? error.message : String(error);
            this.logger.error(`Setup stream failed: ${reason}`);
            // A terminal frame lets the client render the failure instead of
            // hanging on a stream that will never produce another event.
            res.write(
              `event: error\ndata: ${JSON.stringify({ message: reason })}\n\n`,
            );
            res.end();
            resolve();
          },
          complete: () => {
            res.end();
            resolve();
          },
        });
    });
  }

  /**
   * The ORCHESTRATED stream: setup's own steps, then the API's frames.
   *
   * ── WHY THIS IS NOT `pipeTo` ANY MORE ───────────────────────────────────────
   * `pipeTo` copies the API's bytes. That was correct while setup had no work of
   * its own to report — but setup now performs the FIRST THREE steps (start the
   * cluster, start the API, stream its boot), and the API cannot report on any
   * of them because it is the process being started. A byte-pipe structurally
   * cannot produce those events.
   *
   * So setup becomes a PRODUCER for its own steps and a PIPE for everything
   * after: it emits `SetupStreamEvent`s in the API's own schema, then forwards
   * the API's frames verbatim once it is up. The wizard sees one timeline and
   * never learns which process produced which step.
   *
   * ── WHY THE UPSTREAM IS POLLED RATHER THAN ASSUMED ──────────────────────────
   * Connecting immediately is what produced the original failure:
   *
   *   WARN  Upstream http://api-dev:3005/setup/stream unreachable:
   *         getaddrinfo ENOTFOUND api-dev
   *   ERROR Setup stream failed: The platform API is not reachable yet
   *
   * The API is STARTED BEHIND THE GATE, so at the moment the wizard subscribes
   * there is legitimately nothing listening yet. Subscribing once and failing is
   * wrong: the operator gets a dead progress view for a platform that is
   * actually coming up. The stream therefore RETRIES the connection until the
   * API answers, reporting each attempt on the `await_api_boot` step — which is
   * both truthful and exactly what the operator needs to see.
   */
  orchestratedStream(
    orchestration: OrchestrationStreamService,
  ): Observable<SetupStreamEvent> {
    // Announce the pipeline. IDEMPOTENT on the service, so a reconnecting client
    // gets the SAME definitions rather than a second set appended to the replay
    // buffer — which is what made a reconnect rebuild the list from duplicates.
    const details = orchestration.stepDetails();
    const stepIds: OrchestrationStepId[] = details.flatMap((event) =>
      event.type === "step_detail" ? [event.stepId as OrchestrationStepId] : [],
    );

    // ── THE RE-SYNC IS ATOMIC: COUNT, SNAPSHOT, THEN LIVE TAIL ────────────────
    // The count is read FIRST, so the tail below starts exactly after the last
    // event the snapshot already describes. That pairing is what makes a
    // reconnect land in place: the client is told the CURRENT state, then
    // receives only what happens next — never the history again.
    //
    // The previous version replayed the whole buffer after an all-`pending`
    // snapshot, which is precisely how a reconnect re-ran every finished step
    // on screen.
    const checkpoint = orchestration.emittedSoFar();
    const current = orchestration.currentSnapshot();
    const initial =
      current ??
      orchestration.snapshot(stepIds.map((id) => ({ id, status: "pending" as const })));

    // ── THE HEARTBEAT IS MERGED HERE, NOT PUSHED THROUGH THE STREAM ───────────
    // `orchestration.emitted` is a bounded `ReplaySubject`, and `emittedCount`
    // is the checkpoint `liveAfter()` skips to. Routing pings through either
    // would be actively harmful: a ping every few seconds would EVICT real
    // events from the replay buffer, and would shift the checkpoint that the
    // re-sync depends on. A heartbeat carries no state, so it belongs beside
    // the stream rather than inside it.
    //
    // WHY A HEARTBEAT AT ALL: this pipeline WAITS on slow work and emits nothing
    // while it does — Docker scheduling a swarm service (14.1s observed), the
    // ingress taking the entry port and loading its router table (up to 90s).
    // SSE has no heartbeat of its own, so during those windows a client cannot
    // distinguish a quiet socket from a DEAD one, and is forced to choose
    // between a long timeout (a real drop goes unnoticed for minutes) and a
    // short one (healthy runs get aborted mid-step). A periodic ping removes the
    // ambiguity, so a short client timeout becomes correct.
    //
    // Merged into the LIVE TAIL rather than the prefix: the re-sync
    // (`details` + `initial`) is written as one atomic batch, and interleaving a
    // ping there would be pointless — it exists to prove liveness DURING waits.
    return merge(
      concat(from([...details, initial]), orchestration.liveAfter(checkpoint)),
      interval(WizardStreamService.HEARTBEAT_INTERVAL_MS).pipe(
        map(() => ({
          type: "heartbeat" as const,
          seq: 0,
          ts: new Date().toISOString(),
        })),
      ),
    );
  }

  /** How often to prove the socket is alive while the pipeline is quiet. */
  private static readonly HEARTBEAT_INTERVAL_MS = 3_000;

  /**
   * Attach the API's own stream once it answers, forwarding frames verbatim.
   *
   * Called by the handover once the API is reachable. Frames are re-emitted as
   * `SetupStreamEvent`s by PARSING the SSE envelope and forwarding the DATA
   * payload unchanged — the events themselves are still the API's, so this is a
   * transport adaptation, not a second producer.
   */
  attachUpstream(orchestration: OrchestrationStreamService, lastEventId?: string): void {
    const subscription = this.stream(lastEventId).subscribe({
      next: (frame) => {
        for (const event of parseFrames(frame)) {
          orchestration.forward(event);
        }
      },
      error: (error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.error(`Upstream stream failed: ${reason}`);
        orchestration.fail(reason);
      },
    });

    this.upstreamSubscriptions.add(subscription);
  }

  /**
   * Wait until the API answers its stream, then attach it.
   *
   * Bounded by the same budget the handover uses, so a genuinely broken API
   * fails onboarding instead of retrying forever.
   */
  async attachWhenReachable(
    orchestration: OrchestrationStreamService,
    lastEventId?: string,
    timeoutMs = 300_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let attempt = 0;

    for (;;) {
      attempt += 1;
      try {
        orchestration.log("await_api_boot", `Connecting to the platform API (attempt ${String(attempt)})…`);
        const response = await this.upstream.forward("/setup/stream", {
          method: "GET",
          headers: { Accept: "text/event-stream" },
        });

        if (response.ok && response.body !== null) {
          this.logger.log("Upstream setup stream connected");
          orchestration.log("await_api_boot", "Connected — streaming the API's output");
          this.attachUpstream(orchestration, lastEventId);
          return;
        }

        orchestration.log(
          "await_api_boot",
          `The API answered HTTP ${String(response.status)} — retrying…`,
        );
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error);
        orchestration.log("await_api_boot", `Not reachable yet: ${reason}`);
      }

      if (Date.now() >= deadline) {
        throw new Error("the platform API's stream never became reachable");
      }

      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs()));
    }
  }

  /** How often to retry the upstream connection. */
  pollIntervalMs(): number {
    return 2_000;
  }
}

/**
 * Decode one or more SSE frames into the events they carry.
 *
 * The upstream frames are ALREADY the API's `SetupStreamEvent`s, JSON-encoded in
 * `data:` lines. This unwraps the transport without touching the payload: the
 * events stay the API's, so there is still exactly one producer of provisioning
 * events.
 *
 * A frame that does not parse is DROPPED WITH A LOG rather than thrown: one
 * malformed frame must not tear down a stream that is otherwise reporting a
 * successful provisioning run.
 */
function parseFrames(chunk: string): SetupStreamEvent[] {
  const events: SetupStreamEvent[] = [];

  for (const raw of chunk.split("\n\n")) {
    const data = raw
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n");

    if (data.length === 0) continue;

    try {
      events.push(JSON.parse(data) as SetupStreamEvent);
    } catch {
      // Dropped, not fatal — see above.
    }
  }

  return events;
}
