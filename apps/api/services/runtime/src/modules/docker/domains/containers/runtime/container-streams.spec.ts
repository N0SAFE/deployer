import { Subject, firstValueFrom, take, toArray } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { streamLogs, streamProcessLogs } from "./container-streams";

const entry = (timestamp: string, message: string) =>
  ({ id: `${timestamp}${message}`, timestamp, stream: "stdout", level: "info", message }) as never;

describe("container streams", () => {
  it("emits each log line once and moves `since` forward to just before the newest line", async () => {
    const calls: (number | undefined)[] = [];
    const batches = [
      [entry("2026-10-01T10:00:10.000Z", "a")],
      [entry("2026-10-01T10:00:10.000Z", "a"), entry("2026-10-01T10:00:20.000Z", "b")],
    ];
    const collect = vi.fn(async (_tail: number, since: number | undefined) => {
      calls.push(since);
      return batches[Math.min(calls.length - 1, 1)]!;
    });

    const out = await firstValueFrom(streamLogs(collect, { refreshIntervalMs: 5 }).pipe(take(2), toArray()));

    expect(out.map((line) => line.message)).toEqual(["a", "b"]);
    expect(calls[0]).toBeUndefined();
    expect(calls[1]).toBe(Math.floor(Date.parse("2026-10-01T10:00:10.000Z") / 1000) - 1);
  });

  it("filters to the process when logs mention its pid, and passes everything through when none do", async () => {
    const lines = [entry("2026-10-01T10:00:00.000Z", "[42] hello"), entry("2026-10-01T10:00:01.000Z", "other service")];
    const correlated = await firstValueFrom(
      streamProcessLogs(async () => lines, { pid: 42, refreshIntervalMs: 5 }).pipe(take(1), toArray()),
    );
    expect(correlated.map((line) => line.message)).toEqual(["[42] hello"]);

    const uncorrelated = await firstValueFrom(
      streamProcessLogs(async () => [lines[1]!], { pid: 7, refreshIntervalMs: 5 }).pipe(take(1), toArray()),
    );
    expect(uncorrelated.map((line) => line.message)).toEqual(["other service"]);
  });

  it("surfaces a collector failure as a stream error", async () => {
    const failing = new Subject<never>();
    void failing;
    await expect(
      firstValueFrom(streamLogs(async () => { throw new Error("engine down"); }, { refreshIntervalMs: 5 })),
    ).rejects.toThrow("engine down");
  });
});
