import type Docker from "dockerode";
import { Effect, Stream } from "effect";

import { DockerUnavailable, type DockerError } from "../../errors/errors";
import { engineCall } from "../call";
import { isReadableStream } from "../containers/streams";

/** One entry of the engine's event feed; only the fields callers read are typed. */
export type DockerEvent = {
	readonly Type?: string;
	readonly Action?: string;
	readonly Actor?: { readonly ID?: string; readonly Attributes?: Readonly<Record<string, string>> };
	readonly [key: string]: unknown;
};

export type EventsOptions = {
	/** Engine-side filters, e.g. `{ type: ["container"], event: ["start"] }`. */
	readonly filters?: Readonly<Record<string, readonly string[]>>;
	/** Unix seconds; omit to receive only events from now on. */
	readonly since?: number;
};

export type EventsShape = {
	/**
	 * The engine's event feed, one decoded event per element. Ends when the engine closes the
	 * connection and fails with `DockerUnavailable` when it breaks; stopping early destroys the
	 * connection. Lines that are not JSON are skipped.
	 */
	readonly stream: (options?: EventsOptions) => Stream.Stream<DockerEvent, DockerError>;
};

async function* decodeEvents(stream: AsyncIterable<unknown>): AsyncGenerator<DockerEvent> {
	let buffer = "";
	for await (const chunk of stream) {
		buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			if (line.trim() === "") continue;
			try {
				yield JSON.parse(line) as DockerEvent;
			} catch {
				// a partial or garbled line is not an event
			}
		}
	}
}

export function makeEvents(client: Docker): EventsShape {
	const stream: EventsShape["stream"] = (options = {}) =>
		Stream.unwrap(
			Effect.acquireRelease(
				engineCall("subscribe to engine events", async () => {
					const raw: unknown = await (client.getEvents as (opts: Record<string, unknown>) => Promise<unknown>)({
						filters: options.filters,
						since: options.since,
					});
					if (!isReadableStream(raw)) throw new Error("getEvents() returned an unexpected non-stream value");
					return raw;
				}),
				(raw) => Effect.sync(() => (raw as { destroy?: () => void }).destroy?.()),
			).pipe(
				Effect.map((raw) =>
					Stream.fromAsyncIterable(
						decodeEvents(raw as unknown as AsyncIterable<unknown>),
						(cause): DockerError =>
							new DockerUnavailable({ reason: `Engine event stream failed: ${String(cause)}`, cause }),
					),
				),
			),
		);
	return { stream };
}
