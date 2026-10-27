import { beforeAll, describe, expect, it } from "vitest";

import { getSharedApiRuntimeContext, type SharedApiRuntimeContext } from "@/e2e/runtime";
import {
	createAuthenticatedSession,
	type AuthenticatedSession,
} from "@deployer/shared/e2e-harness/authenticated-session";

/** A signed-in admin lists projects and services on the project service, with no pagination sent. */
describe("Project routes e2e: an authenticated admin", () => {
	let context: SharedApiRuntimeContext;
	let admin: AuthenticatedSession;

	beforeAll(async () => {
		context = await getSharedApiRuntimeContext();
		admin = await createAuthenticatedSession(context, { role: "admin" });
	}, 120_000);

	it.each(["/projects", "/services"])("lists %s with NO query and gets the default pagination", async (path) => {
		const response = await context.http.get(path).set("cookie", admin.cookie).expect(200);

		const body = response.body as { data: unknown[]; meta: { limit: number; offset: number } };
		expect(Array.isArray(body.data)).toBe(true);
		expect(body.meta).toMatchObject({ limit: 20, offset: 0 });
	});

	it("honours an explicit query", async () => {
		const response = await context.http
			.get("/projects")
			.query({ "query[limit]": 3, "query[offset]": 0 })
			.set("cookie", admin.cookie)
			.expect(200);

		expect((response.body as { meta: { limit: number } }).meta.limit).toBe(3);
	});
});
