import { domainError } from "@deployer/effect-core";
import { call as callProcedure, ORPCError, os } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { domainErrorInterceptor } from "./domain-error-interceptor";

class Missing extends domainError("Missing", "not_found")() {}

const call = (thrown: unknown) =>
	callProcedure(
		os.handler(() => {
			throw thrown;
		}),
		undefined,
		{ interceptors: [domainErrorInterceptor()] },
	);

describe("domainErrorInterceptor", () => {
	it("turns a thrown domain error into its oRPC error", async () => {
		const error = await call(new Missing({})).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ORPCError);
		expect((error as ORPCError<string, unknown>).code).toBe("NOT_FOUND");
	});

	it("leaves other errors alone", async () => {
		const boom = new Error("boom");
		const error = await call(boom).catch((e: unknown) => e);
		expect(error).toBe(boom);
	});
});
