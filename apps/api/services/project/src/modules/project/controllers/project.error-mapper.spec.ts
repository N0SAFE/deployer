import { describe, expect, it } from "vitest";
import {
	BadRequestError,
	ConflictError,
	ForbiddenError,
	NotFoundError,
} from "@deployer/errors";
import { ORPCError } from "@orpc/server";

import { toOrpcError } from "./project.error-mapper";

describe("toOrpcError", () => {
	it.each([
		[new NotFoundError("Project", "p1"), "NOT_FOUND"],
		[new ConflictError("already a collaborator"), "CONFLICT"],
		[new ForbiddenError("nope"), "FORBIDDEN"],
		[new BadRequestError("bad"), "BAD_REQUEST"],
	])("maps %s to %s", (error, code) => {
		expect(toOrpcError(error).code).toBe(code);
	});

	it("keeps an explicit ORPCError as-is", () => {
		const failure = new ORPCError("NOT_IMPLEMENTED", { message: "later" });

		expect(toOrpcError(failure)).toBe(failure);
	});

	it("does not disguise an unknown failure as a client error", () => {
		const mapped = toOrpcError(new Error("boom"));

		expect(mapped.code).toBe("INTERNAL_SERVER_ERROR");
		expect(mapped.message).toBe("boom");
	});
});
