import { Injectable } from "@nestjs/common";
import { trace } from "@opentelemetry/api";
import { Context, Effect } from "effect";
import {
  asyncScheduler,
  finalize,
  interval,
  map,
  type Observable,
  type SchedulerLike,
  take,
  tap,
  timeout,
} from "rxjs";
import type { LogEvent } from "../../../contracts/stream.contract";

export interface StreamLogsInput {
  count: number;
}

export interface StreamLogsOptions {
  /** Injectable scheduler keeps the pipeline testable with `TestScheduler`. */
  scheduler?: SchedulerLike;
  tickMs?: number;
}

export interface LogStreamShape {
  readonly stream: (
    input: StreamLogsInput,
    options?: StreamLogsOptions,
  ) => Effect.Effect<Observable<LogEvent>, never, never>;
}

export class LogStream extends Context.Service<LogStream, LogStreamShape>()("stream/LogStream") {}

/** Builds one event per tick; the only shape-dependent line in the pipeline. */
function toLogEvent(count: number) {
  return (index: number): LogEvent => ({
    seq: index + 1,
    at: new Date().toISOString(),
    message: `tick ${index + 1}/${count}`,
  });
}

/** Observability hook: span events while the stream is alive. */
function traceStream(span: ReturnType<typeof trace.getActiveSpan>) {
  return tap({
    next: (event: LogEvent) => span?.addEvent("log.stream.event", { seq: event.seq }),
    complete: () => span?.addEvent("log.stream.complete"),
    error: (error: unknown) =>
      span?.recordException(error instanceof Error ? error : new Error(String(error))),
  });
}

/**
 * NestJS provider; RxJS owns the stream and its observability.
 *
 * Pipeline: cold `interval` → one event per tick → `take(count)` → span events
 * → stall detection → cleanup. Effect only wraps construction, so the
 * controller can `yield*` it like any other service; nothing is subscribed
 * until the consumer pulls.
 */
@Injectable()
export class LogStreamServiceImpl implements LogStreamShape {
  stream(
    { count }: StreamLogsInput,
    { scheduler = asyncScheduler, tickMs = 250 }: StreamLogsOptions = {},
  ): Effect.Effect<Observable<LogEvent>, never, never> {
    return Effect.sync(() => {
      const span = trace.getActiveSpan();

      return interval(tickMs, scheduler).pipe(
        take(count),
        map(toLogEvent(count)),
        traceStream(span),
        timeout({ each: Math.max(tickMs * 4, 2_000) }),
        finalize(() => span?.addEvent("log.stream.closed")),
      );
    });
  }
}
