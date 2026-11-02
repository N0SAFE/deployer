import { Effect } from "effect";
import { firstValueFrom, toArray } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import {
  firstResponse,
  isContainerNotFoundLikeError,
  isTerminalSessionNotFoundError,
  streamMeshLogs,
  streamMeshTerminalEvents,
  withMeshFallback,
} from "./mesh-fallback";

const entry = (message: string) => ({ id: message, timestamp: "2026-10-01T10:00:00.000Z", stream: "stdout", level: "info", message }) as never;

describe("mesh fallback", () => {
  it("recognises a missing container or terminal session from the error text", () => {
    expect(isContainerNotFoundLikeError(new Error("No such container: abc"))).toBe(true);
    expect(isContainerNotFoundLikeError(new Error("container abc not found"))).toBe(true);
    expect(isContainerNotFoundLikeError(new Error("404 container gone"))).toBe(true);
    expect(isContainerNotFoundLikeError(new Error("permission denied"))).toBe(false);
    expect(isTerminalSessionNotFoundError(new Error("Terminal session 'x' not found"))).toBe(true);
    expect(isTerminalSessionNotFoundError(new Error("session not found"))).toBe(false);
  });

  it("uses the local value without asking the mesh", async () => {
    const mesh = vi.fn(async () => "remote");
    await expect(Effect.runPromise(withMeshFallback(Effect.succeed("local"), mesh, isContainerNotFoundLikeError))).resolves.toBe("local");
    expect(mesh).not.toHaveBeenCalled();
  });

  it("asks the mesh when the container is missing, and reports the local error when nobody has it", async () => {
    const missing = Effect.fail(new Error("No such container: c1"));
    await expect(Effect.runPromise(withMeshFallback(missing, async () => "remote", isContainerNotFoundLikeError))).resolves.toBe("remote");
    await expect(Effect.runPromise(withMeshFallback(missing, async () => null, isContainerNotFoundLikeError))).rejects.toThrow(/No such container/);
  });

  it("does not ask the mesh for an unrelated failure", async () => {
    const mesh = vi.fn(async () => "remote");
    await expect(
      Effect.runPromise(withMeshFallback(Effect.fail(new Error("boom")), mesh, isContainerNotFoundLikeError)),
    ).rejects.toThrow("boom");
    expect(mesh).not.toHaveBeenCalled();
  });

  it("takes the first responder, or null", async () => {
    await expect(firstResponse(Promise.resolve({ responses: ["a", "b"] }))).resolves.toBe("a");
    await expect(firstResponse(Promise.resolve({ responses: [] }))).resolves.toBeNull();
  });

  it("emits mesh log lines once across polls", async () => {
    const batches = [[entry("a")], [entry("a"), entry("b")]];
    let call = 0;
    const out = await firstValueFrom(
      streamMeshLogs(async () => batches[Math.min(call++, 1)]!, 5).pipe(
        // take the first two distinct lines
        (source) => new (source.constructor as typeof import("rxjs").Observable)((sub) => {
          const seen: unknown[] = [];
          const subscription = source.subscribe((line) => {
            seen.push(line);
            if (seen.length === 2) { sub.next(seen); sub.complete(); }
          });
          return () => { subscription.unsubscribe(); };
        }),
      ),
    );
    expect((out as { message: string }[]).map((line) => line.message)).toEqual(["a", "b"]);
  });

  it("emits mesh terminal events in order after the last sequence and completes when closed", async () => {
    const after: number[] = [];
    const stream = streamMeshTerminalEvents(
      async (afterSequence) => {
        after.push(afterSequence);
        return {
          closed: true,
          events: [
            { sequence: 2, data: "second" },
            { sequence: 1, data: "first" },
          ],
        };
      },
      (event) => event.data,
    );
    await expect(firstValueFrom(stream.pipe(toArray()))).resolves.toEqual(["first", "second"]);
    expect(after[0]).toBe(0);
  });
});
