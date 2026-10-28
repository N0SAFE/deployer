import { FsError } from "./errors";
import { FileKind } from "./types";

export const kindOfError = (error: unknown): FsError["kind"] => {
  const code = (error as { code?: string } | undefined)?.code;
  switch (code) {
    case "ENOENT":
      return "NotFound";
    case "EEXIST":
      return "AlreadyExists";
    case "ENOTEMPTY":
      return "NotEmpty";
    case "ENOTDIR":
      return "NotDirectory";
    case "E2BIG":
      return "TooLarge";
    default:
      return "Other";
  }
};

export const fsError = (op: string, path: string) => (cause: unknown) =>
  new FsError({ op, path, kind: kindOfError(cause), message: cause instanceof Error ? cause.message : String(cause) });


export const kindFromStats = (stats: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }): FileKind =>
  stats.isSymbolicLink() ? "symlink" : stats.isFile() ? "file" : stats.isDirectory() ? "directory" : "other";

export const dirname = (path: string): string => {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
};

/** Collapse duplicate slashes and `.` segments, resolve `..`, drop a trailing slash. Absolute paths only. */
export const normalize = (path: string): string => {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
};
