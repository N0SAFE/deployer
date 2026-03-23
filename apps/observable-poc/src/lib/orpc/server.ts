import { implement, os } from "@orpc/server";
import { interval, map, take } from "rxjs";
import {
  appContract,
  streamLogsContract,
  streamLogsObservableContract,
  type LogEvent,
} from "./contract";

function buildLogEvent(index: number): LogEvent {
  const levels = ["info", "warn", "error"] as const;
  const level = levels[index % levels.length] ?? "info";
  const lineNumber = String(index + 1);
  const message =
    level === "info"
      ? `Worker heartbeat #${lineNumber}`
      : level === "warn"
        ? `Retrying slow dependency for chunk #${lineNumber}`
        : `Recovered transient error for chunk #${lineNumber}`;

  return {
    index,
    level,
    message,
    emittedAt: new Date().toISOString(),
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const streamLogsObservableProcedure = implement(streamLogsObservableContract).handler(({ input }) => {
  const count = input.count;
  const intervalMs = input.intervalMs;

  return interval(intervalMs).pipe(
    take(count),
    map((index): LogEvent => buildLogEvent(index)),
  );
});

const streamLogsProcedure = implement(streamLogsContract).handler(async function* ({ input }) {
  for (let index = 0; index < input.count; index += 1) {
    yield buildLogEvent(index);
    await wait(input.intervalMs);
  }
});

export const appRouter = os.router({
  streamObservableLogs: streamLogsObservableProcedure,
  streamLogs: streamLogsProcedure,
});

export { appContract };
