/**
 * Container operations that fall back to the node that owns the container: when this node does not know the
 * container (or the terminal session), the same call is made across the mesh and the first answer is used. The error
 * tests, the fallback combinator and the polling streams over mesh snapshots are pure, so they are tested with fakes.
 */
import { Effect } from "effect";
import { Observable, from, interval, startWith, switchMap, type Observable as Obs } from "rxjs";

import type { DockerContainerLogEntry } from "@deployer/contracts-entities";

import { createLogDeduper, DEFAULT_REFRESH_INTERVAL_MS } from "./container-streams";

/** Ask one node, give up after a moment: the options every mesh fallback call uses. */
export const MESH_FIRST_RESPONSE = { timeoutMs: 1_500, maxCollectedResponses: 1, stopWhen: () => true } as const;

export const TERMINAL_STREAM_REFRESH_INTERVAL_MS = 400;

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function isContainerNotFoundLikeError(error: unknown): boolean {
  const message = describeError(error).toLowerCase();
  return (
    message.includes("no such container")
    || (message.includes("container") && message.includes("not found"))
    || (message.includes("404") && message.includes("container"))
  );
}

export function isTerminalSessionNotFoundError(error: unknown): boolean {
  const message = describeError(error).toLowerCase();
  return message.includes("terminal session") && message.includes("not found");
}

/** The first node's answer to a mesh call, or null when nobody answered. */
export async function firstResponse<T>(call: Promise<{ responses: readonly T[] }>): Promise<T | null> {
  const result = await call;
  return result.responses[0] ?? null;
}

/**
 * Run `local`; when it fails with an error `isMissing` recognises, try `mesh` and use its value. A mesh answer of
 * null means nobody has it, so the local error is the one reported.
 */
export function withMeshFallback<A, R>(
  local: Effect.Effect<A, unknown, R>,
  mesh: () => Promise<A | null>,
  isMissing: (error: unknown) => boolean,
): Effect.Effect<A, unknown, R> {
  return local.pipe(
    Effect.catchIf(isMissing, (error) =>
      Effect.tryPromise({ try: mesh, catch: (meshError) => meshError }).pipe(
        Effect.flatMap((value) => (value === null ? Effect.fail(error) : Effect.succeed(value))),
      ),
    ),
  );
}

/** Log lines polled from the mesh on an interval, each emitted once. */
export function streamMeshLogs(
  fetchEntries: () => Promise<readonly DockerContainerLogEntry[]>,
  refreshIntervalMs: number | undefined,
): Observable<DockerContainerLogEntry> {
  return new Observable((subscriber) => {
    const dedupe = createLogDeduper();
    const subscription = interval(refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS)
      .pipe(
        startWith(0),
        switchMap(() => from(fetchEntries())),
      )
      .subscribe({
        next: (entries) => {
          for (const entry of dedupe(entries)) subscriber.next(entry);
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

/** Process snapshots polled from the mesh; a poll nobody answers emits nothing. */
export function streamMeshSnapshots<T>(
  fetchSnapshot: () => Promise<T | null>,
  refreshIntervalMs: number | undefined,
): Obs<T> {
  return interval(refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS).pipe(
    startWith(0),
    switchMap(() => from(fetchSnapshot())),
    switchMap((snapshot) => (snapshot === null ? from([] as T[]) : from([snapshot]))),
  );
}

export type MeshTerminalSnapshot<E> = {
  readonly closed: boolean;
  readonly events: readonly (E & { readonly sequence: number })[];
};

/** Terminal events polled from the mesh after the last sequence seen, in order; completes when the session closes. */
export function streamMeshTerminalEvents<E extends { sequence: number }, O>(
  fetchSnapshot: (afterSequence: number) => Promise<MeshTerminalSnapshot<E> | null>,
  toEvent: (event: E) => O,
): Observable<O> {
  return new Observable<O>((subscriber) => {
    let latestSequence = 0;

    const subscription = interval(TERMINAL_STREAM_REFRESH_INTERVAL_MS)
      .pipe(
        startWith(0),
        switchMap(() => from(fetchSnapshot(latestSequence))),
      )
      .subscribe({
        next: (snapshot) => {
          if (!snapshot) return;

          for (const event of [...snapshot.events].sort((left, right) => left.sequence - right.sequence)) {
            latestSequence = Math.max(latestSequence, event.sequence);
            subscriber.next(toEvent(event));
          }

          if (snapshot.closed) subscriber.complete();
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
