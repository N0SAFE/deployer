import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { Actor, CurrentActor } from "./actor";
import { domainError, isDomainError } from "./errors";

class UserNotFound extends domainError("UserNotFound", "not_found")<{ readonly id: string }>() {
	override publicData() {
		return { id: this.id };
	}
}
class EmailTaken extends domainError("EmailTaken", "conflict")<{ readonly email: string }>() {}

describe("domainError", () => {
	it("carries tag, kind and the declared public payload", () => {
		const error = new UserNotFound({ id: "u1" });
		expect(error._tag).toBe("UserNotFound");
		expect(error.kind).toBe("not_found");
		expect(UserNotFound.kind).toBe("not_found");
		expect(error.publicData()).toEqual({ id: "u1" });
	});

	it("exposes nothing by default, never the cause", () => {
		const error = new EmailTaken({ email: "a@b.c", cause: new Error("secret") });
		expect(error.publicData()).toEqual({});
	});

	it("is recognised by isDomainError and catchable by tag", async () => {
		expect(isDomainError(new EmailTaken({ email: "x" }))).toBe(true);
		expect(isDomainError(new Error("plain"))).toBe(false);
		const result = await Effect.runPromise(
			Effect.fail(new UserNotFound({ id: "u2" })).pipe(Effect.catchTag("UserNotFound", (e) => Effect.succeed(e.id))),
		);
		expect(result).toBe("u2");
	});
});

describe("CurrentActor", () => {
	it("is provided explicitly and read from the context", async () => {
		const id = await Effect.runPromise(
			Effect.gen(function* () {
				const actor = yield* CurrentActor;
				return actor.id;
			}).pipe(Effect.provideService(CurrentActor, Actor.system("deploy-worker"))),
		);
		expect(id).toBe("deploy-worker");
	});
});
