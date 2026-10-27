import { domainError, type ErrorKind } from "@deployer/effect-core";
import { ORPCError } from "@orpc/client";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { catchDomainErrors, mapDomainError } from "./map-domain-error";

const CODES: Record<ErrorKind, [string, number]> = {
	not_found: ["NOT_FOUND", 404],
	validation: ["BAD_REQUEST", 400],
	conflict: ["CONFLICT", 409],
	unauthorized: ["UNAUTHORIZED", 401],
	forbidden: ["FORBIDDEN", 403],
	dependency_missing: ["FAILED_DEPENDENCY", 424],
};

class Missing extends domainError("Missing", "not_found")<{ readonly id: string }>() {}
class Plain extends Error {}

describe("mapDomainError", () => {
	it.each(Object.entries(CODES))("maps kind %s to its code and status", (kind, [code, status]) => {
		const Err = domainError("E", kind as ErrorKind)();
		const mapped = mapDomainError(new Err({}));
		expect(mapped).toBeInstanceOf(ORPCError);
		expect(mapped.code).toBe(code);
		expect((mapped.data as { statusCode: number }).statusCode).toBe(status);
	});
});

describe("catchDomainErrors", () => {
	it("converts a domain failure, never leaking the cause", async () => {
		const exit = await Effect.runPromiseExit(
			catchDomainErrors(Effect.fail(new Missing({ id: "1", cause: new Error("secret") }))),
		);
		expect(Exit.isFailure(exit)).toBe(true);
		const text = JSON.stringify(exit);
		expect(text).toContain("NOT_FOUND");
		expect(text).not.toContain("secret");
	});

	it("passes other failures through unchanged", async () => {
		const boom = new Plain("boom");
		const error = await Effect.runPromise(Effect.flip(catchDomainErrors(Effect.fail(boom))));
		expect(error).toBe(boom);
	});

	it("leaves successes alone", async () => {
		await expect(Effect.runPromise(catchDomainErrors(Effect.succeed(7)))).resolves.toBe(7);
	});
});
