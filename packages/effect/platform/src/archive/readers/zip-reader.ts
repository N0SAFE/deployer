import { Effect } from "effect";

import { crc32, type ArchiveEntry, type EntryType } from "../entry";
import { Corrupt, TooManyEntries, UnsupportedFormat, type ArchiveError } from "../errors";
import { inflateBounded } from "../compression/inflate";
import type { ExtractLimits } from "../limits";

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const EOCD_MIN = 22;
const MAX_COMMENT = 0xffff;

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFDIR = 0o040000;
const S_IFREG = 0o100000;

const utf8 = new TextDecoder("utf-8");

/**
 * Minimal, strict ZIP reader (no shell, no `unzip` binary).
 *
 * Reads the CENTRAL directory (the authoritative index), cross-checks every local header (the
 * name must agree: tools that disagree on which header wins are a classic smuggling vector),
 * verifies CRC32 and declared sizes when an entry is read, and decompresses with a hard output cap
 * equal to the declared size. Unsupported: encryption, zip64, multi-disk, methods other than
 * stored/deflate. The whole index is validated before any entry is handed out.
 */
export const zipEntries = (
  buf: Uint8Array,
  limits: Pick<ExtractLimits, "maxEntries">,
): Effect.Effect<readonly ArchiveEntry[], ArchiveError> =>
  Effect.gen(function* () {
    const corrupt = (reason: string) => Effect.fail(new Corrupt({ reason }));
    const unsupported = (reason: string) => Effect.fail(new UnsupportedFormat({ reason }));

    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const len = buf.length;
    if (len < EOCD_MIN) return yield* corrupt("zip: too short");

    let eocd = -1;
    for (let i = len - EOCD_MIN; i >= Math.max(0, len - EOCD_MIN - MAX_COMMENT); i--) {
      if (view.getUint32(i, true) === SIG_EOCD && i + EOCD_MIN + view.getUint16(i + 20, true) <= len) {
        eocd = i;
        break;
      }
    }
    if (eocd === -1) return yield* corrupt("zip: end of central directory not found");

    const disk = view.getUint16(eocd + 4, true);
    const cdDisk = view.getUint16(eocd + 6, true);
    const total = view.getUint16(eocd + 10, true);
    const cdSize = view.getUint32(eocd + 12, true);
    const cdOffset = view.getUint32(eocd + 16, true);
    if (disk !== 0 || cdDisk !== 0) return yield* unsupported("zip: multi-disk archives");
    if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return yield* unsupported("zip64");
    if (total > limits.maxEntries) return yield* Effect.fail(new TooManyEntries({ limit: limits.maxEntries }));
    if (cdOffset + cdSize > eocd) return yield* corrupt("zip: central directory out of bounds");

    const entries: ArchiveEntry[] = [];
    let pos = cdOffset;
    for (let index = 0; index < total; index++) {
      if (pos + 46 > len || view.getUint32(pos, true) !== SIG_CENTRAL) return yield* corrupt("zip: bad central directory entry");
      const versionMadeBy = view.getUint16(pos + 4, true);
      const flags = view.getUint16(pos + 8, true);
      const method = view.getUint16(pos + 10, true);
      const crc = view.getUint32(pos + 16, true);
      const compSize = view.getUint32(pos + 20, true);
      const size = view.getUint32(pos + 24, true);
      const nameLen = view.getUint16(pos + 28, true);
      const extraLen = view.getUint16(pos + 30, true);
      const commentLen = view.getUint16(pos + 32, true);
      const externalAttrs = view.getUint32(pos + 38, true);
      const localOffset = view.getUint32(pos + 42, true);
      const nameStart = pos + 46;
      if (nameStart + nameLen + extraLen + commentLen > len) return yield* corrupt("zip: entry header out of bounds");
      const nameBytes = buf.subarray(nameStart, nameStart + nameLen);
      const name = utf8.decode(nameBytes);
      pos = nameStart + nameLen + extraLen + commentLen;

      if ((flags & 0x1) !== 0 || (flags & 0x40) !== 0) return yield* unsupported("zip: encrypted entries");
      if (method !== 0 && method !== 8) return yield* unsupported(`zip: compression method ${String(method)}`);
      if (compSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) return yield* unsupported("zip64");

      // Local header cross-check and data bounds.
      if (localOffset + 30 > len || view.getUint32(localOffset, true) !== SIG_LOCAL) return yield* corrupt("zip: bad local header");
      const localNameLen = view.getUint16(localOffset + 26, true);
      const localExtraLen = view.getUint16(localOffset + 28, true);
      const localName = buf.subarray(localOffset + 30, localOffset + 30 + localNameLen);
      if (localNameLen !== nameLen || !localName.every((byte, i) => byte === nameBytes[i])) {
        return yield* corrupt("zip: local and central names differ");
      }
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const dataEnd = dataStart + compSize;
      if (dataEnd > len) return yield* corrupt("zip: entry data out of bounds");

      // Entry type and permissions.
      const unixHost = versionMadeBy >> 8 === 3;
      const unixMode = unixHost ? (externalAttrs >>> 16) & 0xffff : 0;
      const fileType = unixMode & S_IFMT;
      let type: EntryType;
      if (unixHost && fileType === S_IFLNK) type = "symlink";
      else if (unixHost && fileType !== 0 && fileType !== S_IFREG && fileType !== S_IFDIR) type = "other";
      else if (name.endsWith("/") || (unixHost && fileType === S_IFDIR) || (!unixHost && (externalAttrs & 0x10) !== 0)) type = "directory";
      else type = "file";
      const mode = unixHost && (unixMode & 0o7777) !== 0 ? unixMode & 0o7777 : type === "directory" ? 0o755 : 0o644;

      const read = Effect.gen(function* () {
        const raw = buf.subarray(dataStart, dataEnd);
        // The cap is the DECLARED size: an entry that inflates to more is lying.
        const content =
          method === 0
            ? raw
            : yield* inflateBounded(raw, "deflate-raw", size).pipe(
                Effect.mapError((error) =>
                  new Corrupt({
                    reason: error._tag === "OutputLimitExceeded" ? "zip: entry is larger than its declared size" : "zip: inflate failed",
                  }),
                ),
              );
        if (content.length !== size) return yield* corrupt("zip: entry size differs from its declared size");
        if (crc32(content) !== crc) return yield* corrupt("zip: CRC32 mismatch");
        return content;
      });

      entries.push({ path: name, type, mode, size, compressedSize: compSize, read });
    }
    return entries;
  });
