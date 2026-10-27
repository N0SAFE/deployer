import { BadRequestError, ConflictError, NotFoundError, ValidationError } from "@deployer/errors";
import { ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { PushServiceFailure } from "../push.failures";
import { mapPushFailure } from "./push.error-mapper";

const map = (cause: unknown) => mapPushFailure(new PushServiceFailure({ cause }));

describe("mapPushFailure", () => {
	it.each([
		["an unknown subscription", new NotFoundError("push subscription", "e"), "NOT_FOUND"],
		["a conflict", new ConflictError("clash"), "CONFLICT"],
		["a bad request", new BadRequestError("bad"), "BAD_REQUEST"],
		[
			"a validation failure",
			new ValidationError("bad", [{ path: "endpoint", code: "invalid_format", severity: "error", message: "bad" }]),
			"BAD_REQUEST",
		],
	])("maps %s to %s", (_label, cause, code) => {
		const mapped = map(cause);

		expect(mapped).toBeInstanceOf(ORPCError);
		expect(mapped.code).toBe(code);
	});

	it("hides an unexpected failure behind a generic internal error, keeping the cause", () => {
		const cause = new Error("db down");

		const mapped = map(cause);

		expect(mapped.code).toBe("INTERNAL_SERVER_ERROR");
		expect(mapped.message).toBe("Unexpected push service failure");
		expect(mapped.cause).toBe(cause);
	});
});
