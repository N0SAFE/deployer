import { ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { rateLimit } from "./orpc-middleware";

/** Mirrors the oRPC middleware invocation shape: (options, input, outputFn), options carry { context, next, errors }. */
async function runMiddleware(
	middleware: ReturnType<typeof rateLimit>,
	ip: string | null,
): Promise<{ threw: ORPCError<string, unknown> | null }> {
	const errorsMap = {
		TOO_MANY_REQUESTS: (options?: { message?: string; status?: number }) => new ORPCError("TOO_MANY_REQUESTS", options ?? {}),
	};
	const next = ({ context }: { context: Record<string, unknown> }) => Promise.resolve({ context, output: "ok" });
	const fn = middleware as unknown as (options: unknown, input: unknown, outputFn: unknown) => Promise<unknown>;
	try {
		await fn(
			{
				context: { request: new Request("http://deployer.localhost", ip === null ? {} : { headers: { "x-forwarded-for": ip } }) },
				next,
				errors: errorsMap,
			},
			{},
			() => ({}),
		);
		return { threw: null };
	} catch (error) {
		return { threw: error as ORPCError<string, unknown> };
	}
}

describe("rateLimit middleware", () => {
	it("allows requests under the ceiling and blocks the burst with TOO_MANY_REQUESTS", async () => {
		const limiter = rateLimit({ windowMs: 60_000, max: 2 });
		expect((await runMiddleware(limiter, "10.0.0.1")).threw).toBeNull();
		expect((await runMiddleware(limiter, "10.0.0.1")).threw).toBeNull();
		// oRPC v2 REMOVED `status` from ORPCError: the HTTP status is mapped from the code by the handler, so the code is what a middleware can assert.
		expect((await runMiddleware(limiter, "10.0.0.1")).threw?.code).toBe("TOO_MANY_REQUESTS");
	});

	it("does not limit different clients against each other", async () => {
		const limiter = rateLimit({ windowMs: 60_000, max: 1 });
		await runMiddleware(limiter, "10.0.0.1");
		expect((await runMiddleware(limiter, "10.0.0.2")).threw).toBeNull();
	});

	it("shares one budget between requests that cannot be attributed", async () => {
		const limiter = rateLimit({ windowMs: 60_000, max: 1 });
		await runMiddleware(limiter, null);
		expect((await runMiddleware(limiter, null)).threw?.code).toBe("TOO_MANY_REQUESTS");
	});

	it("releases the window after it slides", async () => {
		const limiter = rateLimit({ windowMs: 50, max: 1 });
		await runMiddleware(limiter, "10.0.0.3");
		expect((await runMiddleware(limiter, "10.0.0.3")).threw).not.toBeNull();
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect((await runMiddleware(limiter, "10.0.0.3")).threw).toBeNull();
	});
});
