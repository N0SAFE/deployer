export type ExtractLimits = {
  /** Compressed archive size on disk. */
  readonly maxArchiveBytes: number;
  readonly maxEntries: number;
  /** Uncompressed size of one entry. */
  readonly maxEntryBytes: number;
  /** Sum of all uncompressed entry sizes. */
  readonly maxTotalBytes: number;
  /** Uncompressed / compressed; applied only above 1 MiB so tiny files do not trip it. */
  readonly maxCompressionRatio: number;
  readonly maxPathLength: number;
  readonly maxDepth: number;
};

const MiB = 1024 * 1024;

/** Conservative defaults for a source-code upload. Raise them explicitly per use case. */
export const DEFAULT_EXTRACT_LIMITS: ExtractLimits = {
  maxArchiveBytes: 512 * MiB,
  maxEntries: 10_000,
  maxEntryBytes: 512 * MiB,
  maxTotalBytes: 1024 * MiB,
  maxCompressionRatio: 200,
  maxPathLength: 1024,
  maxDepth: 32,
};

/** Ratio checks start here: a 10 KiB file of zeros legitimately compresses 1000:1. */
export const RATIO_FLOOR_BYTES = MiB;
