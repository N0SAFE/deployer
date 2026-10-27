import { NestingTooDeep, UnsafePath } from "./errors";
import type { ExtractLimits } from "./limits";

const MAX_SEGMENT = 255;

/**
 * Turn an archive entry name into path segments under the destination, or throw.
 *
 * Rejected: NUL, backslash (a Windows separator that tools disagree on), absolute
 * paths, drive prefixes (`C:`), any `..` segment, over-long names, and excessive depth.
 * `.` and empty segments are dropped, so `./a//b/` is `["a", "b"]`; an entry that
 * reduces to nothing is the archive root (`[]`).
 */
export const entrySegments = (entry: string, limits: Pick<ExtractLimits, "maxPathLength" | "maxDepth">): string[] => {
  const unsafe = (reason: string): never => {
    throw new UnsafePath({ entry: entry.slice(0, 200), reason });
  };
  if (entry.includes("\0")) return unsafe("NUL byte");
  if (entry.includes("\\")) return unsafe("backslash");
  if (entry.startsWith("/")) return unsafe("absolute path");
  if (/^[a-zA-Z]:/.test(entry)) return unsafe("drive prefix");
  if (entry.length > limits.maxPathLength) return unsafe("path too long");

  const segments: string[] = [];
  for (const segment of entry.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") return unsafe("parent directory segment");
    if (segment.length > MAX_SEGMENT) return unsafe("path segment too long");
    segments.push(segment);
  }
  if (segments.length > limits.maxDepth) {
    throw new NestingTooDeep({ entry: entry.slice(0, 200), limit: limits.maxDepth });
  }
  return segments;
};

/** Join under `root` and re-check containment lexically (defence in depth over `entrySegments`). */
export const joinUnder = (root: string, segments: readonly string[], entry: string): string => {
  const full = `${root.replace(/\/+$/, "")}/${segments.join("/")}`;
  if (full !== root && !full.startsWith(root.endsWith("/") ? root : `${root}/`)) {
    throw new UnsafePath({ entry: entry.slice(0, 200), reason: "resolves outside the destination" });
  }
  return full;
};
