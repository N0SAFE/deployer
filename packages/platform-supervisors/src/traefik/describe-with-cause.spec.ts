import { describe, expect, it } from "vitest";

import { describeWithCause } from "./traefik-supervisor";

describe("describeWithCause", () => {
	it("appends the reason an Effect.tryPromise error hides in its cause", () => {
		const error = new Error("An error occurred in Effect.tryPromise", { cause: new Error("connect ENOENT /run/agent.sock") });
		expect(describeWithCause(error)).toBe("An error occurred in Effect.tryPromise: connect ENOENT /run/agent.sock");
	});

	it("keeps a plain error and a non-error as they are", () => {
		expect(describeWithCause(new Error("boom"))).toBe("boom");
		expect(describeWithCause("text")).toBe("text");
	});
});
