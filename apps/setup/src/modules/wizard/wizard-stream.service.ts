import { Injectable, Logger } from "@nestjs/common";
import { Observable, from, map, takeUntil, Subject, share } from "rxjs";

import { WizardUpstreamService } from "./wizard-upstream.service";
import { SetupPhaseService } from "@/modules/health/setup-phase.service";

/**
 * Pipes the API's provisioning event stream to the wizard.
 *
 * THE RULE (plan §10.1): the setup app is a PIPE, never a second producer.
 * Provisioning needs the Drizzle schema, migrations and auth, so only the API
 * can execute it. The setup app therefore forwards the upstream SSE frames
 * verbatim — the wire format the client already expects — instead of parsing
 * and re-emitting, which would be a second implementation of the event contract
 * that could silently drift from the API's.
 *
 * WHY RxJS HERE
 * The stream is a long-lived subscription that must:
 *   - tear the upstream connection down when the client disconnects (no leaked
 *     sockets against the API),
 *   - survive reconnection by replaying via `Last-Event-ID`,
 *   - feed the phase state machine so `/setup/state` reflects "driving".
 * Those are all stream-composition problems, and expressing them as an
 * Observable keeps the teardown in one place (`takeUntil`) rather than spread
 * across try/finally blocks in a request handler.
 */
@Injectable()
export class WizardStreamService {
  private readonly logger = new Logger(WizardStreamService.name);

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
    this.phase.record("driving", "Receiving provisioning progress from the platform API");

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
}
