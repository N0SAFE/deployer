import { describe, expect, it } from "vitest";

import { parseContainerLogEntries, parseContainerProcesses } from "./container-ops-parsing";

const NOW = "2026-01-01T00:00:00.000Z";

describe("container ops parsing", () => {
  it("reads timestamped log lines with their stream and level", () => {
    const entries = parseContainerLogEntries(
      [
        "2026-10-01T10:00:00.000Z server started",
        "2026-10-01T10:00:01.000Z ERROR failed to bind",
        "",
        "2026-10-01T10:00:02.000Z warning: slow query",
        "2026-10-01T10:00:03.000Z stderr noise",
      ].join("\n"),
      "c1",
      NOW,
    );
    expect(entries.map((entry) => [entry.level, entry.stream, entry.message])).toEqual([
      ["info", "stdout", "server started"],
      ["error", "stdout", "ERROR failed to bind"],
      ["warn", "stdout", "warning: slow query"],
      ["info", "stderr", "stderr noise"],
    ]);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(4);
  });

  it("reads the engine's top table into process entries, skipping rows without a pid", () => {
    const processes = parseContainerProcesses(
      {
        Titles: ["USER", "PID", "%CPU", "%MEM", "STAT", "START", "COMMAND"],
        Processes: [
          ["root", "1", "0.5", "1.2%", "Ss", "10:00", "node", "server.js"],
          ["app", "x", "0", "0", "R", "10:01", "bad"],
          "not a row",
        ],
      },
      NOW,
    );
    expect(processes).toHaveLength(1);
    expect(processes[0]).toMatchObject({
      pid: 1,
      user: "root",
      cpuPercent: 0.5,
      memoryPercent: 1.2,
      state: "sleeping",
      startedAt: "10:00",
      command: "node server.js",
    });
  });

  it("falls back to the last cell as the command and the generation time as the start", () => {
    const [process] = parseContainerProcesses({ Titles: ["PID"], Processes: [["7"]] }, NOW);
    expect(process).toMatchObject({ pid: 7, user: "unknown", startedAt: NOW, command: "7" });
  });
});
