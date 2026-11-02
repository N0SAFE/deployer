/**
 * Reading what the engine returns for a container's logs and processes into the runtime's entities. Pure over
 * the raw text and the `top` table, so the parsing is tested without an engine.
 */
import { createHash } from "node:crypto";

import {
  dockerContainerLogEntrySchema,
  dockerContainerProcessEntrySchema,
  type DockerContainerLogEntry,
  type DockerContainerProcessEntry,
} from "@deployer/contracts-entities";

import { findTitleIndex, mapProcessState, parsePercent, parseTimestampedLogLine } from "./container-runtime-helpers";

/** The `top` table the engine returns: column titles and one row of cells per process. */
export type ContainerTopResult = {
  readonly Titles?: readonly string[] | null;
  readonly Processes?: readonly unknown[] | null;
};

export function parseContainerLogEntries(rawLogs: string, containerId: string, now: string): DockerContainerLogEntry[] {
  return rawLogs
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      const { timestamp, message } = parseTimestampedLogLine(line, now);
      const stream: DockerContainerLogEntry["stream"] = message.toLowerCase().includes("stderr") ? "stderr" : "stdout";
      const level: DockerContainerLogEntry["level"] = /\b(error|fatal|panic)\b/i.test(message)
        ? "error"
        : /\b(warn|warning)\b/i.test(message)
          ? "warn"
          : "info";

      return dockerContainerLogEntrySchema.parse({
        id: createHash("sha1").update(`${containerId}:${timestamp}:${message}:${String(index)}`).digest("hex"),
        timestamp,
        stream,
        level,
        message,
      });
    });
}

export function parseContainerProcesses(topResult: ContainerTopResult, generatedAt: string): DockerContainerProcessEntry[] {
  const titles = [...(topResult.Titles ?? [])];
  const rows = topResult.Processes ?? [];

  const pidIndex = findTitleIndex(titles, ["PID"]);
  const userIndex = findTitleIndex(titles, ["USER"]);
  const cpuIndex = findTitleIndex(titles, ["%CPU", "CPU"]);
  const memIndex = findTitleIndex(titles, ["%MEM", "MEM"]);
  const statIndex = findTitleIndex(titles, ["STAT", "STATE"]);
  const startIndex = findTitleIndex(titles, ["START", "STARTED"]);
  const commandIndex = findTitleIndex(titles, ["COMMAND", "CMD"]);

  return rows
    .map((row) => {
      if (!Array.isArray(row)) {
        return null;
      }
      const cells = row as string[];

      const pidRaw = pidIndex >= 0 ? cells[pidIndex] : undefined;
      const pid = pidRaw ? Number(pidRaw) : Number.NaN;
      if (!Number.isInteger(pid) || pid < 0) {
        return null;
      }

      const statValue = statIndex >= 0 ? (cells[statIndex] ?? "") : "";
      const command = commandIndex >= 0 ? cells.slice(commandIndex).join(" ").trim() : (cells[cells.length - 1] ?? "process");

      return dockerContainerProcessEntrySchema.parse({
        pid,
        user: (userIndex >= 0 ? cells[userIndex] : undefined) ?? "unknown",
        cpuPercent: parsePercent(cpuIndex >= 0 ? cells[cpuIndex] : undefined),
        memoryPercent: parsePercent(memIndex >= 0 ? cells[memIndex] : undefined),
        state: mapProcessState(statValue),
        startedAt: (startIndex >= 0 ? cells[startIndex] : undefined) ?? generatedAt,
        command,
      });
    })
    .filter((entry): entry is DockerContainerProcessEntry => entry !== null);
}
