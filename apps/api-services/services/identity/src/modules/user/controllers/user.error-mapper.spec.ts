import {
	BadRequestError,
	ConflictError,
	ForbiddenError,
	NotFoundError,
	ValidationError,
} from "@deployer/errors";
import { ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { UserServiceFailure } from "../user.failures";
import { mapUserFailure } from "./user.error-mapper";

const map = (cause: unknown) => mapUserFailure(new UserServiceFailure({ cause }));

describe("mapUserFailure", () => {
	it.each([
		["a missing user", new NotFoundError("user", "u-1"), "NOT_FOUND"],
		["a taken email", new ConflictError("taken"), "CONFLICT"],
		["a forbidden action", new ForbiddenError("no"), "FORBIDDEN"],
		["a bad request", new BadRequestError("bad"), "BAD_REQUEST"],
		[
			"a validation failure",
			new ValidationError("bad", [{ path: "email", code: "invalid_format", severity: "error", message: "bad" }]),
			"BAD_REQUEST",
		],
	])("maps %s to %s", (_label, cause, code) => {
		const mapped = map(cause);

		expect(mapped).toBeInstanceOf(ORPCError);
		expect(mapped.code).toBe(code);
	});

	it("keeps the domain error's message", () => {
		expect(map(new ConflictError('an account for "a@b.c" already exists')).message).toContain("already exists");
	});

	it("hides an unexpected failure behind a generic internal error, keeping the cause", () => {
		const cause = new Error("connection refused");

		const mapped = map(cause);

		expect(mapped.code).toBe("INTERNAL_SERVER_ERROR");
		expect(mapped.message).toBe("Unexpected user service failure");
		expect(mapped.cause).toBe(cause);
	});
});
