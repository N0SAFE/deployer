import { beforeAll, describe, expect, it } from "vitest";

import { getSharedApiRuntimeContext, type SharedApiRuntimeContext } from "@/e2e/runtime";
import {
	createAuthenticatedSession,
	type AuthenticatedSession,
} from "@deployer/shared/e2e-harness/authenticated-session";

/**
 * A signed-in admin lists deployments on the runtime service.
 *
 * A bare `GET /deployments` (no `?query=`) used to answer `500 Output validation failed`
 * (`meta.limit` / `meta.offset` undefined): the contract made `query` optional, so its defaults
 * never applied and the repository read pagination from nothing. This pins the fix.
 */
describe("Runtime routes e2e: an authenticated admin", () => {
	let context: SharedApiRuntimeContext;
	let admin: AuthenticatedSession;

	beforeAll(async () => {
		context = await getSharedApiRuntimeContext();
		admin = await createAuthenticatedSession(context, { role: "admin" });
	}, 120_000);

	it("lists deployments with NO query and gets the contract's default pagination", async () => {
		const response = await context.http.get("/deployments").set("cookie", admin.cookie).expect(200);

		const body = response.body as { data: unknown[]; meta: { limit: number; offset: number; total: number; hasMore: boolean } };
		expect(Array.isArray(body.data)).toBe(true);
		expect(body.meta).toMatchObject({ limit: 20, offset: 0 });
		expect(typeof body.meta.total).toBe("number");
	});

	it("honours an explicit query", async () => {
		const response = await context.http
			.get("/deployments")
			.query({ "query[limit]": 5, "query[offset]": 0 })
			.set("cookie", admin.cookie)
			.expect(200);

		expect((response.body as { meta: { limit: number } }).meta.limit).toBe(5);
	});
});
