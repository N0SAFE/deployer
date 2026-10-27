import { crc32 } from "./entry";

/**
 * Archive builders for specs and for the hostile-archive corpus. They can produce
 * VALID archives and archives that lie (wrong declared size, mismatched names,
 * links, traversal names) - the point is to exercise the extractor's refusals.
 */

const enc = new TextEncoder();
const bytesOf = (data: string | Uint8Array<ArrayBuffer> | undefined): Uint8Array<ArrayBuffer> =>
  data === undefined ? new Uint8Array(0) : typeof data === "string" ? enc.encode(data) : data;

const concat = (parts: readonly Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

export type ZipSpec = {
  readonly name: string;
  readonly data?: string | Uint8Array<ArrayBuffer>;
  /** Unix permission bits (default 0o644 / 0o755 for directories). */
  readonly mode?: number;
  readonly kind?: "file" | "dir" | "symlink" | "fifo";
  /** 8 = deflate (default), 0 = stored. */
  readonly method?: 0 | 8;
  /** Write the Unix host + mode into the external attributes (default true). */
  readonly unix?: boolean;
  /** Lies, to build hostile archives. */
  readonly declaredSize?: number;
  readonly declaredCompressedSize?: number;
  readonly crc?: number;
  readonly localName?: string;
};

export const buildZip = (entries: readonly ZipSpec[], options?: { readonly comment?: string }): Uint8Array<ArrayBuffer> => {
  const locals: Uint8Array<ArrayBuffer>[] = [];
  const centrals: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const entry of entries) {
    const kind = entry.kind ?? (entry.name.endsWith("/") ? "dir" : "file");
    const raw = kind === "symlink" ? bytesOf(entry.data) : bytesOf(entry.data);
    const method = entry.method ?? 8;
    const compressed = method === 8 ? new Uint8Array(Bun.deflateSync(raw)) : raw;
    const name = enc.encode(entry.name);
    const localName = enc.encode(entry.localName ?? entry.name);
    const crc = entry.crc ?? crc32(raw);
    const size = entry.declaredSize ?? raw.length;
    const compSize = entry.declaredCompressedSize ?? compressed.length;

    const local = new Uint8Array(30 + localName.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, compSize, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, localName.length, true);
    local.set(localName, 30);
    locals.push(local, compressed);

    const modeBits = kind === "dir" ? 0o040000 | (entry.mode ?? 0o755) : kind === "symlink" ? 0o120000 | (entry.mode ?? 0o777) : kind === "fifo" ? 0o010000 | (entry.mode ?? 0o644) : 0o100000 | (entry.mode ?? 0o644);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, (entry.unix === false ? 0 : 3) << 8 | 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, compSize, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(38, entry.unix === false ? (kind === "dir" ? 0x10 : 0) : (modeBits << 16) >>> 0, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.length + compressed.length;
  }

  const cd = concat(centrals);
  const comment = enc.encode(options?.comment ?? "");
  const eocd = new Uint8Array(22 + comment.length);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cd.length, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, comment.length, true);
  eocd.set(comment, 22);
  return concat([...locals, cd, eocd]);
};

export type TarSpec = {
  readonly name: string;
  readonly data?: string | Uint8Array<ArrayBuffer>;
  /** '0' file, '5' directory, '2' symlink, '1' hardlink, '3' char device, '6' fifo... Default '0' (or '5' for a trailing slash). */
  readonly type?: string;
  readonly mode?: number;
  readonly linkname?: string;
  /** POSIX ustar path prefix. */
  readonly prefix?: string;
  /** Emit the name through a GNU `L` long-name record instead of the 100-byte field. */
  readonly gnuLongName?: boolean;
  /** Emit the name through a pax `x` record. */
  readonly paxPath?: boolean;
  /** Corrupt the header checksum. */
  readonly badChecksum?: boolean;
};

const oct = (value: number, width: number): string => value.toString(8).padStart(width - 1, "0") + "\0";

const header = (spec: { name: string; size: number; type: string; mode: number; linkname?: string; prefix?: string }, badChecksum = false): Uint8Array<ArrayBuffer> => {
  const block = new Uint8Array(512);
  const put = (text: string, at: number, max: number) => { block.set(enc.encode(text).subarray(0, max), at); };
  put(spec.name, 0, 100);
  put(oct(spec.mode, 8), 100, 8);
  put(oct(0, 8), 108, 8);
  put(oct(0, 8), 116, 8);
  put(oct(spec.size, 12), 124, 12);
  put(oct(0, 12), 136, 12);
  block.fill(0x20, 148, 156);
  put(spec.type, 156, 1);
  put(spec.linkname ?? "", 157, 100);
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  put(spec.prefix ?? "", 345, 155);
  let sum = 0;
  for (const byte of block) sum += byte;
  put(`${(badChecksum ? sum + 1 : sum).toString(8).padStart(6, "0")}\0 `, 148, 8);
  return block;
};

const padded = (data: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(Math.ceil(data.length / 512) * 512);
  out.set(data);
  return out;
};

export const buildTar = (entries: readonly TarSpec[], options?: { readonly noEndMarker?: boolean }): Uint8Array<ArrayBuffer> => {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  for (const entry of entries) {
    const type = entry.type ?? (entry.name.endsWith("/") ? "5" : "0");
    const data = type === "0" || type === "7" ? bytesOf(entry.data) : new Uint8Array(0);
    const mode = entry.mode ?? (type === "5" ? 0o755 : 0o644);

    if (entry.gnuLongName === true) {
      const nameBytes = enc.encode(`${entry.name}\0`);
      parts.push(header({ name: "././@LongLink", size: nameBytes.length, type: "L", mode: 0 }), padded(nameBytes));
    }
    if (entry.paxPath === true) {
      const base = ` path=${entry.name}\n`;
      let total = base.length + String(base.length).length;
      if (String(total).length !== String(base.length).length) total = base.length + String(total).length;
      const body = enc.encode(`${String(total)}${base}`);
      parts.push(header({ name: "pax-header", size: body.length, type: "x", mode: 0 }), padded(body));
    }
    const fieldName = entry.gnuLongName === true || entry.paxPath === true ? entry.name.slice(0, 90) : entry.name;
    parts.push(
      header(
        { name: fieldName, size: data.length, type, mode, ...(entry.linkname === undefined ? {} : { linkname: entry.linkname }), ...(entry.prefix === undefined ? {} : { prefix: entry.prefix }) },
        entry.badChecksum === true,
      ),
      padded(data),
    );
  }
  if (options?.noEndMarker !== true) parts.push(new Uint8Array(1024));
  return concat(parts);
};

export const gzip = (bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> => new Uint8Array(Bun.gzipSync(bytes));

/** A highly compressible payload: a classic decompression bomb ingredient. */
export const zeros = (length: number): Uint8Array<ArrayBuffer> => new Uint8Array(length);
