import { Cause, Effect } from "effect";
import { OutputLine } from "./types";
import { STDERR_TAIL_CHARS } from "./limits";

/** Splits decoded text into lines and reports them. Keeps the last partial line until flushed. */
export const lineSplitter = (stream: OutputLine["stream"], emit: (line: OutputLine) => void) => {
  let pending = "";
  return {
    push: (text: string) => {
      pending += text;
      let index = pending.indexOf("\n");
      while (index !== -1) {
        emit({ stream, line: pending.slice(0, index).replace(/\r$/, "") });
        pending = pending.slice(index + 1);
        index = pending.indexOf("\n");
      }
    },
    flush: () => {
      if (pending.length > 0) emit({ stream, line: pending.replace(/\r$/, "") });
      pending = "";
    },
  };
};

/**
 * Reads a pipe to the end, handing each chunk to `onChunk`. A pipe torn down by a kill ends quietly,
 * and the reader is cancelled and released however the read ends, interruption included.
 */
export const pump = (source: ReadableStream<Uint8Array>, onChunk: (chunk: Uint8Array) => void): Effect.Effect<void> =>
  Effect.acquireUseRelease(
    Effect.sync(() => source.getReader()),
    (reader) =>
      Effect.gen(function* () {
        for (;;) {
          const { done, value } = yield* Effect.tryPromise(() => reader.read());
          if (done) return;
          onChunk(value);
        }
      }).pipe(Effect.ignore),
    (reader) =>
      Effect.promise(() => reader.cancel().catch(() => undefined)).pipe(
        Effect.andThen(Effect.try(() => { reader.releaseLock(); })),
        Effect.ignore,
      ),
  );

export const tail = (text: string): string => (text.length > STDERR_TAIL_CHARS ? text.slice(-STDERR_TAIL_CHARS) : text);

export const failCause = <E>(error: E): Cause.Cause<E> => Cause.fail(error);
