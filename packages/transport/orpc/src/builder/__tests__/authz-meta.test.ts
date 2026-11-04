import { describe, expect, it } from "vitest";
import z from "zod/v4";

import { access, accessOf } from "@deployer/auth/authz/meta";

import { standard } from "../../standard";

/**
 * The declaration travels on the CONTRACT (`DEC-AUTH-26`): the gate reads it back off the implemented procedure, so a
 * route cannot be gated by anything else. This proves the builder keeps it through `.build()` — the half that would fail
 * silently, because a dropped declaration only means "not gated".
 */
const ops = standard.zod(z.object({ id: z.string() }), "thing");

describe("authz declaration on the contract", () => {
	it("survives the build, next to the OpenAPI metadata", () => {
		const contract = ops
			.read()
			.path("/things/{id}")
			.input((b) => b.params(z.object({ id: z.string() })))
			.meta(access({ permission: "role:read" }))
			.build();

		expect(accessOf(contract)).toEqual({ permission: "role:read" });
		// The two `.meta()` calls must not clobber each other: routing is read from the OpenAPI entry.
		const meta = (contract as unknown as { "~orpc": { meta: Record<string, unknown> } })["~orpc"].meta;
		expect(Object.keys(meta).length).toBeGreaterThan(1);
	});

	it("leaves an undeclared route undeclared", () => {
		const contract = ops.read().path("/things").output(z.object({ ok: z.boolean() })).build();
		expect(accessOf(contract)).toBeUndefined();
	});
});
