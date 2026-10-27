import { Data } from "effect";

/** An entry path escapes the destination (`..`, absolute, drive prefix, NUL, backslash, too long...). */
export class UnsafePath extends Data.TaggedError("UnsafePath")<{
  readonly entry: string;
  readonly reason: string;
}> {}

/** A symlink, hardlink, device, fifo or socket entry. Links are refused outright (no escape is possible when none exist). */
export class SymlinkEscape extends Data.TaggedError("SymlinkEscape")<{
  readonly entry: string;
  readonly kind: string;
}> {}

export class TooManyEntries extends Data.TaggedError("TooManyEntries")<{ readonly limit: number }> {}

/** A declared or actual size exceeds a limit (entry, total, archive, or a zip-bomb compression ratio). */
export class TooLarge extends Data.TaggedError("TooLarge")<{
  readonly what: "archive" | "entry" | "total" | "ratio";
  readonly limit: number;
  readonly entry?: string;
}> {}

export class UnsupportedFormat extends Data.TaggedError("UnsupportedFormat")<{ readonly reason: string }> {}

export class Corrupt extends Data.TaggedError("Corrupt")<{ readonly reason: string }> {}

export class NestingTooDeep extends Data.TaggedError("NestingTooDeep")<{
  readonly entry: string;
  readonly limit: number;
}> {}

/** The destination exists and is not an empty directory. */
export class DestinationNotEmpty extends Data.TaggedError("DestinationNotEmpty")<{ readonly dest: string }> {}

export type ArchiveError =
  | UnsafePath
  | SymlinkEscape
  | TooManyEntries
  | TooLarge
  | UnsupportedFormat
  | Corrupt
  | NestingTooDeep
  | DestinationNotEmpty;

const ARCHIVE_TAGS: ReadonlySet<string> = new Set([
  "UnsafePath",
  "SymlinkEscape",
  "TooManyEntries",
  "TooLarge",
  "UnsupportedFormat",
  "Corrupt",
  "NestingTooDeep",
  "DestinationNotEmpty",
]);

export const isArchiveError = (value: unknown): value is ArchiveError =>
  typeof value === "object" && value !== null && ARCHIVE_TAGS.has((value as { _tag?: string })._tag ?? "");
