/**
 * The polling streams over a container's logs and processes: one snapshot per interval, de-duplicated (logs) or
 * narrowed to a process (process logs). RxJS built from snapshot collectors the Effect service provides, so the
 * stream rules are tested with fake collectors and no engine.
 */
import { Observable, from, interval, startWith, switchMap } from "rxjs";

import type { DockerContainerLogEntry } from "@deployer/contracts-entities";

import { logMatchesProcess } from "./container-runtime-helpers";

export const DEFAULT_REFRESH_INTERVAL_MS = 1_000;
export const DEFAULT_LOG_TAIL = 300;
const MAX_SEEN_LOG_KEYS = 3_000;

export type LogsCollector = (
  tail: number,
  sinceSeconds: number | undefined,
  untilSeconds: number | undefined,
) => Promise<DockerContainerLogEntry[]>;

export type LogsStreamOptions = {
  readonly refreshIntervalMs?: number | undefined;
  readonly tail?: number | undefined;
  readonly since?: Date | undefined;
  readonly until?: Date | undefined;
};

/**
 * Remembers the log lines it has seen (up to a cap) and returns only the new ones from each snapshot, so a line a
 * later snapshot repeats is emitted once.
 */
export function createLogDeduper(): (entries: readonly DockerContainerLogEntry[]) => DockerContainerLogEntry[] {
  const seenKeys: string[] = [];
  const seenSet = new Set<string>();

  return (entries) => {
    const fresh: DockerContainerLogEntry[] = [];
    for (const entry of entries) {
      const seenKey = `${entry.timestamp}|${entry.stream}|${entry.message}`;
      if (seenSet.has(seenKey)) continue;

      seenSet.add(seenKey);
      seenKeys.push(seenKey);
      if (seenKeys.length > MAX_SEEN_LOG_KEYS) {
        const oldest = seenKeys.shift();
        if (oldest) seenSet.delete(oldest);
      }
      fresh.push(entry);
    }
    return fresh;
  };
}

const toSeconds = (date: Date | undefined) => (date ? Math.max(0, Math.floor(date.getTime() / 1_000)) : undefined);

/** Logs seen so far are remembered (up to a cap) so a repeated snapshot line is emitted once; `since` follows the newest line. */
export function streamLogs(collect: LogsCollector, options: LogsStreamOptions): Observable<DockerContainerLogEntry> {
  const refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
  const tail = options.tail ?? DEFAULT_LOG_TAIL;
  const untilSeconds = toSeconds(options.until);

  return new Observable((subscriber) => {
    const dedupe = createLogDeduper();
    let nextSinceSeconds: number | undefined = toSeconds(options.since);

    const subscription = interval(refreshIntervalMs)
      .pipe(
        startWith(0),
        switchMap(() => from(collect(tail, nextSinceSeconds, untilSeconds))),
      )
      .subscribe({
        next: (entries) => {
          for (const entry of dedupe(entries)) {
            subscriber.next(entry);
          }

          const latestEntryTimestamp = entries
            .map((entry) => Date.parse(entry.timestamp))
            .filter((value) => Number.isFinite(value))
            .sort((a, b) => b - a)[0];

          if (typeof latestEntryTimestamp === "number") {
            const candidateSince = Math.max(0, Math.floor(latestEntryTimestamp / 1_000) - 1);
            nextSinceSeconds = typeof nextSinceSeconds === "number" ? Math.max(nextSinceSeconds, candidateSince) : candidateSince;
          }
        },
        error: (error) => {
          subscriber.error(error);
        },
      });

    return () => {
      subscription.unsubscribe();
    };
  });
}

/** A poll of any snapshot on an interval, emitting each result (the first immediately). */
export function pollSnapshot<T>(snapshot: () => Promise<T>, refreshIntervalMs: number | undefined): Observable<T> {
  return interval(refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS).pipe(
    startWith(0),
    switchMap(() => from(snapshot())),
  );
}

/**
 * The logs of one process: when recent logs mention the pid, only lines mentioning it are streamed; when none do,
 * the whole stream is passed through (a container that does not log pids still shows something).
 */
export function streamProcessLogs(
  collect: LogsCollector,
  input: { pid: number; tail?: number | undefined; refreshIntervalMs?: number | undefined },
): Observable<DockerContainerLogEntry> {
  const pidNeedle = input.pid.toString();

  return new Observable((subscriber) => {
    let subscription: { unsubscribe(): void } | undefined;
    let disposed = false;

    void collect(Math.min(input.tail ?? DEFAULT_LOG_TAIL, 200), undefined, undefined)
      .then((sampleEntries) => {
        const hasPidCorrelatedEntries = sampleEntries.some((entry) => logMatchesProcess(entry.message, pidNeedle));
        if (disposed || subscriber.closed) return;

        subscription = streamLogs(collect, { tail: input.tail, refreshIntervalMs: input.refreshIntervalMs }).subscribe({
          next: (entry) => {
            if (!hasPidCorrelatedEntries || logMatchesProcess(entry.message, pidNeedle)) {
              subscriber.next(entry);
            }
          },
          error: (error) => {
            subscriber.error(error);
          },
        });
      })
      .catch((error) => {
        if (!disposed && !subscriber.closed) subscriber.error(error);
      });

    return () => {
      disposed = true;
      subscription?.unsubscribe();
    };
  });
}
