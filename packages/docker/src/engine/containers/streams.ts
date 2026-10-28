/**
 * Decoding for what the engine streams back: exec output and container logs, which arrive either as
 * plain text or as Docker's multiplexed frames (an 8-byte header, then the payload).
 */

export const isReadableStream = (value: unknown): value is NodeJS.ReadableStream =>
	typeof value === "object" && value !== null && "pipe" in value && "read" in value && "on" in value;

export const isWritableStream = (value: unknown): value is NodeJS.ReadWriteStream =>
	typeof value === "object" && value !== null && "pipe" in value && "write" in value && "end" in value && "read" in value;

const isBufferLike = (value: unknown): value is Buffer | Uint8Array => Buffer.isBuffer(value) || value instanceof Uint8Array;

const text = (value: unknown): string =>
	typeof value === "string" ? value : isBufferLike(value) ? Buffer.from(value).toString("utf8") : "";

/**
 * Output some transports hand back inline instead of as a stream: a string, a buffer, or an object
 * carrying `output` or `stdout`/`stderr`. Null when `raw` is none of those.
 */
export function extractInlineOutput(raw: unknown): string | null {
	if (typeof raw === "string") return raw;
	if (isBufferLike(raw)) return Buffer.from(raw).toString("utf8");
	if (typeof raw !== "object" || raw === null) return null;
	const record = raw as Record<string, unknown>;
	if (typeof record.output === "string" || isBufferLike(record.output)) return text(record.output);
	const combined = `${text(record.stdout)}${text(record.stderr)}`;
	return combined.length > 0 ? combined : null;
}

/** The payloads of a complete multiplexed stream, joined; null when `raw` is not one. */
export function demultiplex(raw: Buffer): Buffer | null {
	if (raw.length < 8) return null;
	const frames: Buffer[] = [];
	let offset = 0;
	while (offset + 8 <= raw.length) {
		const type = raw[offset];
		// 0 = stdin, 1 = stdout, 2 = stderr
		if (type !== 0 && type !== 1 && type !== 2) return null;
		const end = offset + 8 + raw.readUInt32BE(offset + 4);
		if (end > raw.length) return null;
		frames.push(raw.subarray(offset + 8, end));
		offset = end;
	}
	return offset !== raw.length || frames.length === 0 ? null : Buffer.concat(frames);
}

/** A logs payload as text, whether or not it is multiplexed. */
export function decodeLogsPayload(raw: Buffer): string {
	return (demultiplex(raw) ?? raw).toString("utf8");
}

const toBuffer = (chunk: unknown): Buffer | null =>
	typeof chunk === "string" ? Buffer.from(chunk, "utf8") : isBufferLike(chunk) ? Buffer.from(chunk) : null;

/** Everything a readable stream emits, concatenated. */
export async function readAll(stream: AsyncIterable<unknown>): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of stream) {
		const buffer = toBuffer(chunk);
		if (buffer !== null) chunks.push(buffer);
	}
	return Buffer.concat(chunks);
}

/**
 * The lines of a followed logs stream. Stderr lines carry `stderrPrefix` so a caller can tell the
 * two apart; a stream that is not multiplexed is read as plain text. Stops (and so releases the
 * stream) as soon as the consumer does.
 */
export async function* logLines(stream: AsyncIterable<unknown>, stderrPrefix: string): AsyncGenerator<string> {
	let pending = Buffer.alloc(0);
	const lines = function* (payload: Buffer, prefix: string) {
		for (const line of payload.toString("utf8").split("\n")) {
			if (line.length > 0) yield prefix + line;
		}
	};

	for await (const chunk of stream) {
		const buffer = toBuffer(chunk);
		if (buffer === null) continue;
		pending = Buffer.concat([pending, buffer]);
		for (;;) {
			if (pending.length < 8) break;
			const type = pending[0];
			if (type !== 0 && type !== 1 && type !== 2) {
				yield* lines(pending, "");
				pending = Buffer.alloc(0);
				break;
			}
			const end = 8 + pending.readUInt32BE(4);
			if (pending.length < end) break;
			yield* lines(pending.subarray(8, end), type === 2 ? stderrPrefix : "");
			pending = pending.subarray(end);
		}
	}
	const rest = pending.toString("utf8").trim();
	if (rest.length > 0) yield rest;
}
