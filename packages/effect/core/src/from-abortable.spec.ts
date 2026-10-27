import { Effect, Exit, Fiber } from "effect";
import { describe, expect, it } from "vitest";

import { fromAbortable } from "./from-abortable";

class Boom {
  readonly _tag = "Boom";
  constructor(readonly cause: unknown) {}
}

describe("fromAbortable", () => {
  it("resolves with the promise value", async () => {
    const result = await Effect.runPromise(
      fromAbortable(
        () => Promise.resolve(42),
        (cause) => new Boom(cause),
      ),
    );
    expect(result).toBe(42);
  });

  it("maps a rejection to the typed error", async () => {
    const exit = await Effect.runPromiseExit(
      fromAbortable(
        () => Promise.reject(new Error("nope")),
        (cause) => new Boom(cause),
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    const error = await Effect.runPromise(
      Effect.flip(
        fromAbortable(
          () => Promise.reject(new Error("nope")),
          (cause) => new Boom(cause),
        ),
      ),
    );
    expect(error._tag).toBe("Boom");
  });

  it("aborts the signal when the fiber is interrupted", async () => {
    let aborted = false;
    let started!: () => void;
    const startedP = new Promise<void>((resolve) => {
      started = resolve;
    });

    const program = fromAbortable(
      (signal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
          started();
        }),
      (cause) => new Boom(cause),
    );

    const fiber = Effect.runFork(program);
    await startedP;
    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(aborted).toBe(true);
  });
});
