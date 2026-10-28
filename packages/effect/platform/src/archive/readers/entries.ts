import { Effect } from "effect";

import type { ArchiveEntry } from "../entry";
import { Corrupt, TooLarge, UnsupportedFormat, type ArchiveError } from "../errors";
import { inflateBounded } from "../compression/inflate";
import { RATIO_FLOOR_BYTES, type ExtractLimits } from "../limits";
import { tarEntries } from "./tar-reader";
import { zipEntries } from "./zip-reader";

export type ArchiveFormat = "zip" | "tar" | "tar.gz";

/** Which format `bytes` is, by its magic numbers; the extension is never trusted. */
export const detect = (bytes: Uint8Array): Effect.Effect<ArchiveFormat, UnsupportedFormat> => {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5) && (bytes[3] === 4 || bytes[3] === 6)) {
    return Effect.succeed("zip");
  }
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return Effect.succeed("tar.gz");
  if (bytes.length >= 262 && new TextDecoder().decode(bytes.subarray(257, 262)) === "ustar") return Effect.succeed("tar");
  return Effect.fail(new UnsupportedFormat({ reason: "unrecognised archive format (expected zip, tar or tar.gz)" }));
};

const gunzip = (bytes: Uint8Array, limits: ExtractLimits): Effect.Effect<Uint8Array, TooLarge | Corrupt> =>
  Effect.gen(function* () {
    // Tar framing adds 512-byte headers and padding per entry on top of the content.
    const out = yield* inflateBounded(bytes, "gzip", limits.maxTotalBytes + limits.maxEntries * 1536 + 4096).pipe(
      Effect.mapError((error) =>
        error._tag === "OutputLimitExceeded"
          ? new TooLarge({ what: "total", limit: limits.maxTotalBytes })
          : new Corrupt({ reason: "tar.gz: gzip stream is corrupt" }),
      ),
    );
    if (out.length > RATIO_FLOOR_BYTES && out.length / Math.max(1, bytes.length) > limits.maxCompressionRatio) {
      return yield* Effect.fail(new TooLarge({ what: "ratio", limit: limits.maxCompressionRatio }));
    }
    return out;
  });

export const entriesOf = (
  format: ArchiveFormat,
  bytes: Uint8Array,
  limits: ExtractLimits,
): Effect.Effect<readonly ArchiveEntry[], ArchiveError> =>
  format === "zip"
    ? zipEntries(bytes, limits)
    : format === "tar.gz"
      ? gunzip(bytes, limits).pipe(Effect.flatMap(tarEntries))
      : tarEntries(bytes);

