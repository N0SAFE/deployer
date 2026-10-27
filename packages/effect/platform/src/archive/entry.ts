export type EntryType = "file" | "directory" | "symlink" | "hardlink" | "other";

/**
 * One archive member. `size` and `compressedSize` are the DECLARED values (the
 * readers verify the actual content against them, so budgets can trust them).
 * `read()` returns the full content and rejects with an `ArchiveError` on a mismatch.
 */
export type ArchiveEntry = {
  readonly path: string;
  readonly type: EntryType;
  /** Unix permission bits as stored (setuid/setgid/sticky included; the extractor strips them). */
  readonly mode: number;
  readonly size: number;
  readonly compressedSize: number;
  /** Aborting `signal` cancels an in-flight decompression. */
  readonly read: (signal?: AbortSignal) => Promise<Uint8Array>;
};

/** CRC-32 (zip variant) via the Bun builtin. */
export const crc32 = (bytes: Uint8Array): number => Bun.hash.crc32(bytes);
