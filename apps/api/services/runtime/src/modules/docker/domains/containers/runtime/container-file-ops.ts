import type { DockerFileEntry } from "@deployer/contracts-entities";

import { parseListEntry } from "./container-runtime-helpers";

export type FileMutationAck = { readonly ok: true; readonly timestamp: string };

/** The listing `ls -la` printed for a directory as file entries, without the `total` line, `.` and `..`. */
export function buildFileListing(containerId: string, containerPath: string, output: string, generatedAt: string) {
  const entries = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("total "))
    .map((line) => parseListEntry(line, containerPath, generatedAt))
    .filter((entry): entry is DockerFileEntry => entry !== null);

  return { containerId, path: containerPath, generatedAt, entries };
}
