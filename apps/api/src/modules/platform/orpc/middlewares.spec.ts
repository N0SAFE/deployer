import { beforeEach, describe, expect, it } from "vitest";
import { ORPCError } from "@orpc/server";
import { rateLimit } from "./middlewares";

/**
 * Mirror the oRPC middleware invocation shape: (options, input, outputFn),
 * options carry { context, next, errors }.
 */
async function runMiddleware(
    middleware: ReturnType<typeof rateLimit>,
    ip: string,
): Promise<{ outcome: unknown; threw: ORPCError<string, unknown> | null }> {
    const errorsMap = {
        TOO_MANY_REQUESTS: (options?: { message?: string; status?: number }) =>
            new ORPCError("TOO_MANY_REQUESTS", options ?? {}),
    };
    const next = async ({ context }: { context: Record<string, unknown> }) => ({ context, output: "ok" });
    const fn = middleware as unknown as (
        options: unknown,
        input: unknown,
        outputFn: unknown,
    ) => Promise<unknown>;

    try {
        const outcome = await fn(
            {
                context: {
                    request: new Request("http://deployer.localhost", {
                        headers: { "x-forwarded-for": ip },
                    }),
                },
                next,
                errors: errorsMap,
            },
            {},
            () => ({}),
        );
        return { outcome, threw: null };
    } catch (error) {
        return { outcome: null, threw: error as ORPCError<string, unknown> };
    }
}

describe("rateLimit (W-P3)", () => {
    it("allows requests under the ceiling and blocks the burst with 429", async () => {
        const limiter = rateLimit({ windowMs: 60_000, max: 2 });

        expect((await runMiddleware(limiter, "10.0.0.1")).threw).toBeNull();
        expect((await runMiddleware(limiter, "10.0.0.1")).threw).toBeNull();

        const third = await runMiddleware(limiter, "10.0.0.1");
        expect(third.threw).not.toBeNull();
        expect(third.threw?.code).toBe("TOO_MANY_REQUESTS");
        expect(third.threw?.["status"] === undefined ? undefined : third.threw["status"]).toBe(429);
    });

    it("does not rate-limit different clients", async () => {
        const limiter = rateLimit({ windowMs: 60_000, max: 1 });
        await runMiddleware(limiter, "10.0.0.1");
        expect((await runMiddleware(limiter, "10.0.0.2")).threw).toBeNull();
    });

    it("releases the window after it slides", async () => {
        const limiter = rateLimit({ windowMs: 50, max: 1 });
        await runMiddleware(limiter, "10.0.0.3");
        expect((await runMiddleware(limiter, "10.0.0.3")).threw).not.toBeNull();
        // After the window passes, the client can proceed again.
        await new Promise((resolve) => setTimeout(resolve, 60));
        expect((await runMiddleware(limiter, "10.0.0.3")).threw).toBeNull();
    });
});
