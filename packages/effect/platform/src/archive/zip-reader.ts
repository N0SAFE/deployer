import { crc32, type ArchiveEntry, type EntryType } from "./entry";
import { Corrupt, TooManyEntries, UnsupportedFormat } from "./errors";
import { inflateBounded, OutputLimitExceeded } from "./inflate";
import type { ExtractLimits } from "./limits";

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
 * Reads the CENTRAL directory (the authoritative index), cross-checks every local
 * header (name must agree: tools that disagree on which header wins are a classic
 * smuggling vector), verifies CRC32 and declared sizes, and decompresses with a hard
 * output cap equal to the declared size. Unsupported: encryption, zip64, multi-disk,
 * methods other than stored/deflate.
 */
export function* zipEntries(buf: Uint8Array, limits: Pick<ExtractLimits, "maxEntries">): Generator<ArchiveEntry> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const len = buf.length;
  if (len < EOCD_MIN) throw new Corrupt({ reason: "zip: too short" });

  let eocd = -1;
  for (let i = len - EOCD_MIN; i >= Math.max(0, len - EOCD_MIN - MAX_COMMENT); i--) {
    if (view.getUint32(i, true) === SIG_EOCD && i + EOCD_MIN + view.getUint16(i + 20, true) <= len) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Corrupt({ reason: "zip: end of central directory not found" });

  const disk = view.getUint16(eocd + 4, true);
  const cdDisk = view.getUint16(eocd + 6, true);
  const total = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (disk !== 0 || cdDisk !== 0) throw new UnsupportedFormat({ reason: "zip: multi-disk archives" });
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new UnsupportedFormat({ reason: "zip64" });
  }
  if (total > limits.maxEntries) throw new TooManyEntries({ limit: limits.maxEntries });
  if (cdOffset + cdSize > eocd) throw new Corrupt({ reason: "zip: central directory out of bounds" });

  let pos = cdOffset;
  for (let index = 0; index < total; index++) {
    if (pos + 46 > len || view.getUint32(pos, true) !== SIG_CENTRAL) {
      throw new Corrupt({ reason: "zip: bad central directory entry" });
    }
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
    if (nameStart + nameLen + extraLen + commentLen > len) throw new Corrupt({ reason: "zip: entry header out of bounds" });
    const nameBytes = buf.subarray(nameStart, nameStart + nameLen);
    const name = utf8.decode(nameBytes);
    pos = nameStart + nameLen + extraLen + commentLen;

    if ((flags & 0x1) !== 0 || (flags & 0x40) !== 0) throw new UnsupportedFormat({ reason: "zip: encrypted entries" });
    if (method !== 0 && method !== 8) throw new UnsupportedFormat({ reason: `zip: compression method ${String(method)}` });
    if (compSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      throw new UnsupportedFormat({ reason: "zip64" });
    }

    // Local header cross-check and data bounds.
    if (localOffset + 30 > len || view.getUint32(localOffset, true) !== SIG_LOCAL) {
      throw new Corrupt({ reason: "zip: bad local header" });
    }
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const localName = buf.subarray(localOffset + 30, localOffset + 30 + localNameLen);
    if (localNameLen !== nameLen || !localName.every((byte, i) => byte === nameBytes[i])) {
      throw new Corrupt({ reason: "zip: local and central names differ" });
    }
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > len) throw new Corrupt({ reason: "zip: entry data out of bounds" });

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

    yield {
      path: name,
      type,
      mode,
      size,
      compressedSize: compSize,
      read: async (signal) => {
        const raw = buf.subarray(dataStart, dataEnd);
        let content: Uint8Array;
        if (method === 0) {
          content = raw;
        } else {
          try {
            // The cap is the DECLARED size: an entry that inflates to more is lying.
            content = await inflateBounded(raw, "deflate-raw", size, signal);
          } catch (error) {
            throw new Corrupt({
              reason: error instanceof OutputLimitExceeded ? "zip: entry is larger than its declared size" : "zip: inflate failed",
            });
          }
        }
        if (content.length !== size) throw new Corrupt({ reason: "zip: entry size differs from its declared size" });
        if (crc32(content) !== crc) throw new Corrupt({ reason: "zip: CRC32 mismatch" });
        return content;
      },
    };
  }
}
