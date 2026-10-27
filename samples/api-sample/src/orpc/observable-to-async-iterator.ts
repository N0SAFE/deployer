import { Observable } from "rxjs";

export interface ObservableIteratorOptions {
  /** Aborted when the oRPC handler's request is cancelled. */
  signal?: AbortSignal | undefined;
}

/**
 * Adapter: RxJS `Observable` → oRPC `AsyncIteratorObject` (SSE).
 *
 * RxJS owns the pipeline and its operators; this bridge only moves values
 * across the boundary. The subscription starts on the first `next()` (cold
 * source) and is torn down on completion, error, abort or early `return()`.
 *
 * Unbounded queue: fine for log-style streams. Add a bound if a producer can
 * outrun the consumer indefinitely.
 */
export function observableToAsyncIterator<T>(
  source: Observable<T>,
  { signal }: ObservableIteratorOptions = {},
): AsyncGenerator<T, void, unknown> {
  return (async function* () {
    const queue: T[] = [];
    let completed = false;
    let failure: unknown;
    let wake: (() => void) | undefined;

    const notify = () => {
      const resolve = wake;
      wake = undefined;
      resolve?.();
    };

    const subscription = source.subscribe({
      next: (value) => {
        queue.push(value);
        notify();
      },
      error: (error: unknown) => {
        failure = error;
        completed = true;
        notify();
      },
      complete: () => {
        completed = true;
        notify();
      },
    });

    const onAbort = () => notify();
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      while (true) {
        if (signal?.aborted) return;

        if (queue.length > 0) {
          yield queue.shift() as T;
          continue;
        }

        if (failure !== undefined) throw failure;
        if (completed) return;

        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
      subscription.unsubscribe();
    }
  })();
}
