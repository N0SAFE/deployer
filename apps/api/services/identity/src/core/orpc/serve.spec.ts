import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UserForbidden, UserInvalid } from "@identity/modules/user/domain/user.errors";

import { serve, setDenialSink, type DenialEvent } from "./serve";

const context = {
	auth: { user: { id: "user-1", role: "admin" } },
	request: { headers: new Headers({ "x-forwarded-for": "10.0.0.9", "user-agent": "vitest" }) },
};

describe("serve denial reporting", () => {
	afterEach(() => {
		setDenialSink(undefined);
	});

	it("records a refusal with the actor and the correlation id", async () => {
		const events: DenialEvent[] = [];
		setDenialSink((event) => {
			events.push(event);
		});

		await Effect.runPromise(
			serve(context)(Effect.fail(new UserForbidden({ reason: "actor lacks user:delete" }))).pipe(
				Effect.catchCause(() => Effect.void),
			),
		);

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			action: "access-denied",
			actorId: "user-1",
			ip: "10.0.0.9",
			userAgent: "vitest",
			detail: { tag: "UserForbidden", kind: "forbidden", message: "actor lacks user:delete" },
		});
	});

	it("does not record a validation failure: a typo is not an access attempt", async () => {
		const record = vi.fn();
		setDenialSink(record);

		// A validation-kind domain error must not reach the sink.
		await Effect.runPromise(
			serve(context)(Effect.fail(new UserInvalid({ reason: "bad input" }))).pipe(
				Effect.catchCause(() => Effect.void),
			),
		);

		expect(record).not.toHaveBeenCalled();
	});

	it("answers exactly as before when no sink is installed", async () => {
		const failure = await Effect.runPromise(
			Effect.flip(serve(context)(Effect.fail(new UserForbidden({ reason: "nope" })))),
		);

		// The refusal is still an oRPC error on the wire; the sink only observes it.
		expect(failure).toMatchObject({ code: "FORBIDDEN" });
	});
});
