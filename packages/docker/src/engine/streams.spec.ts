import { describe, expect, it } from "vitest";

import { decodeLogsPayload, demultiplex, extractInlineOutput, logLines } from "./streams";

const frame = (type: 1 | 2, payload: string) => {
	const body = Buffer.from(payload);
	const header = Buffer.alloc(8);
	header[0] = type;
	header.writeUInt32BE(body.length, 4);
	return Buffer.concat([header, body]);
};

async function collect(source: AsyncIterable<unknown>, prefix = "[stderr] ") {
	const lines: string[] = [];
	for await (const line of logLines(source, prefix)) lines.push(line);
	return lines;
}

// eslint-disable-next-line @typescript-eslint/require-await
async function* chunks(...parts: Buffer[]) {
	for (const part of parts) yield part;
}

describe("demultiplex", () => {
	it("joins the payloads of a complete multiplexed stream", () => {
		expect(demultiplex(Buffer.concat([frame(1, "out\n"), frame(2, "err\n")]))?.toString()).toBe("out\nerr\n");
	});

	it("returns null for plain text and for a truncated frame", () => {
		expect(demultiplex(Buffer.from("plain text output"))).toBeNull();
		expect(demultiplex(frame(1, "hello").subarray(0, 10))).toBeNull();
	});

	it("decodes plain logs unchanged", () => {
		expect(decodeLogsPayload(Buffer.from("plain text output"))).toBe("plain text output");
	});
});

describe("extractInlineOutput", () => {
	it("reads strings, buffers, output and stdout/stderr, and nothing else", () => {
		expect(extractInlineOutput("text")).toBe("text");
		expect(extractInlineOutput(Buffer.from("buf"))).toBe("buf");
		expect(extractInlineOutput({ output: "o" })).toBe("o");
		expect(extractInlineOutput({ stdout: "a", stderr: "b" })).toBe("ab");
		expect(extractInlineOutput({})).toBeNull();
		expect(extractInlineOutput(42)).toBeNull();
	});
});

describe("logLines", () => {
	it("splits frames into lines and prefixes stderr", async () => {
		const lines = await collect(chunks(frame(1, "one\ntwo\n"), frame(2, "bad\n")));

		expect(lines).toEqual(["one", "two", "[stderr] bad"]);
	});

	it("reassembles a frame split across chunks", async () => {
		const whole = frame(1, "hello world\n");

		expect(await collect(chunks(whole.subarray(0, 5), whole.subarray(5, 12), whole.subarray(12)))).toEqual(["hello world"]);
	});

	it("reads a stream that is not multiplexed as plain lines", async () => {
		expect(await collect(chunks(Buffer.from("alpha\nbeta\n")))).toEqual(["alpha", "beta"]);
	});
});
