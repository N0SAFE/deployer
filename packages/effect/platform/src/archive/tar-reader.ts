import type { ArchiveEntry, EntryType } from "./entry";
import { Corrupt, UnsupportedFormat } from "./errors";

const BLOCK = 512;
const ascii = new TextDecoder("utf-8");

const cString = (bytes: Uint8Array): string => {
  const end = bytes.indexOf(0);
  return ascii.decode(end === -1 ? bytes : bytes.subarray(0, end));
};

const octal = (bytes: Uint8Array, field: string): number => {
  if (((bytes[0] ?? 0) & 0x80) !== 0) throw new UnsupportedFormat({ reason: `tar: base-256 ${field}` });
  const text = cString(bytes).trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/.test(text)) throw new Corrupt({ reason: `tar: invalid ${field}` });
  return parseInt(text, 8);
};

const isZeroBlock = (block: Uint8Array): boolean => block.every((byte) => byte === 0);

const verifyChecksum = (header: Uint8Array): void => {
  const stored = octal(header.subarray(148, 156), "checksum");
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : (header[i] ?? 0);
  if (sum !== stored) throw new Corrupt({ reason: "tar: header checksum mismatch" });
};

/** Parse pax extended-header records (`<len> <key>=<value>\n`). Only `path` and `size` are honoured. */
const paxRecords = (data: Uint8Array): Record<string, string> => {
  const out: Record<string, string> = {};
  let offset = 0;
  const text = new TextDecoder("utf-8");
  while (offset < data.length) {
    let space = offset;
    while (space < data.length && data[space] !== 0x20) space++;
    const length = Number(text.decode(data.subarray(offset, space)));
    if (!Number.isInteger(length) || length <= 0 || offset + length > data.length) {
      throw new Corrupt({ reason: "tar: malformed pax record" });
    }
    const record = text.decode(data.subarray(space + 1, offset + length - 1));
    const equals = record.indexOf("=");
    if (equals > 0) out[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return out;
};

const typeOf = (flag: string): EntryType => {
  switch (flag) {
    case "0":
    case "\0":
    case "7":
      return "file";
    case "5":
      return "directory";
    case "2":
      return "symlink";
    case "1":
      return "hardlink";
    default:
      return "other"; // character/block devices, fifos, vendor extensions
  }
};

/**
 * Minimal, strict USTAR/pax/GNU-longname reader over an in-memory (already
 * decompressed) tar. Header checksums are verified, truncation is detected, and
 * base-256 sizes are refused. Links and special files are surfaced as such so the
 * extractor can refuse them.
 */
export function* tarEntries(buf: Uint8Array): Generator<ArchiveEntry> {
  let offset = 0;
  let longName: string | undefined;
  let pax: Record<string, string> = {};

  while (offset < buf.length) {
    if (offset + BLOCK > buf.length) throw new Corrupt({ reason: "tar: truncated header" });
    const header = buf.subarray(offset, offset + BLOCK);
    if (isZeroBlock(header)) return; // end-of-archive marker

    verifyChecksum(header);
    const magic = cString(header.subarray(257, 263));
    if (!magic.startsWith("ustar")) throw new UnsupportedFormat({ reason: "tar: not a ustar archive" });

    const flag = String.fromCharCode(header[156] ?? 0);
    const nameField = cString(header.subarray(0, 100));
    // POSIX ustar has a path prefix at 345; GNU ("ustar  ") reuses those bytes for atime/ctime.
    const prefix = magic === "ustar" ? cString(header.subarray(345, 500)) : "";
    let size = octal(header.subarray(124, 136), "size");
    const mode = octal(header.subarray(100, 108), "mode") & 0o7777;

    const dataStart = offset + BLOCK;
    const next = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (flag === "x" || flag === "g" || flag === "L" || flag === "K") {
      if (dataStart + size > buf.length) throw new Corrupt({ reason: "tar: truncated metadata" });
      const data = buf.subarray(dataStart, dataStart + size);
      if (flag === "x") pax = paxRecords(data);
      else if (flag === "L") longName = cString(data);
      // 'g' (global pax) and 'K' (GNU long link target) carry nothing we honour.
      offset = next;
      continue;
    }

    const paxSize = pax.size;
    if (paxSize !== undefined) {
      if (!/^\d+$/.test(paxSize)) throw new Corrupt({ reason: "tar: invalid pax size" });
      size = Number(paxSize);
    }
    const path = pax.path ?? longName ?? (prefix === "" ? nameField : `${prefix}/${nameField}`);
    pax = {};
    longName = undefined;

    const type = typeOf(flag);
    const dataEnd = dataStart + size;
    if (type === "file" && dataEnd > buf.length) throw new Corrupt({ reason: "tar: truncated entry data" });

    // Entries without data blocks (directories, links, specials) must not consume any.
    const advance = type === "file" ? dataStart + Math.ceil(size / BLOCK) * BLOCK : dataStart;
    yield {
      path,
      type,
      mode,
      size: type === "file" ? size : 0,
      compressedSize: type === "file" ? size : 0,
      read: () => Promise.resolve(buf.subarray(dataStart, dataEnd)),
    };
    offset = advance;
  }
}
