/** The decompressed stream exceeded the byte limit; the transfer was cancelled. */
export class OutputLimitExceeded extends Error {
  constructor(readonly limit: number) {
    super(`decompressed output exceeds ${String(limit)} bytes`);
  }
}

/** The compressed stream is malformed or truncated. */
export class InflateFailed extends Error {}

/**
 * Decompress `data` with a HARD cap on the output, using the web-standard
 * `DecompressionStream` (a Bun builtin). `Bun.inflateSync`/`gunzipSync` have no output
 * limit, so a 100 KB bomb would allocate gigabytes before any size check could run;
 * here the stream is cancelled the moment the cap is crossed.
 */
export const inflateBounded = async (
  data: Uint8Array,
  format: "deflate-raw" | "gzip",
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> => {
  const reader = new Blob([data as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream(format), signal === undefined ? {} : { signal })
    .getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw new OutputLimitExceeded(maxBytes);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof OutputLimitExceeded) throw error;
    throw new InflateFailed(error instanceof Error ? error.message : String(error));
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};
