import type { Effect } from "effect";

import type { ArchiveError } from "./errors";

export type EntryType = "file" | "directory" | "symlink" | "hardlink" | "other";

/**
 * One archive member. `size` and `compressedSize` are the DECLARED values (the
 * readers verify the actual content against them, so budgets can trust them).
 * `read` yields the full content and fails with an `ArchiveError` on a mismatch; interrupting it
 * cancels an in-flight decompression.
 */
export type ArchiveEntry = {
  readonly path: string;
  readonly type: EntryType;
  /** Unix permission bits as stored (setuid/setgid/sticky included; the extractor strips them). */
  readonly mode: number;
  readonly size: number;
  readonly compressedSize: number;
  readonly read: Effect.Effect<Uint8Array, ArchiveError>;
};

/** CRC-32 (zip variant) via the Bun builtin. */
export const crc32 = (bytes: Uint8Array): number => Bun.hash.crc32(bytes);
