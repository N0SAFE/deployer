import { beforeAll, describe, expect, it } from "vitest";

import { getSharedApiRuntimeContext, type SharedApiRuntimeContext } from "@/e2e/runtime";
import {
	createAuthenticatedSession,
	type AuthenticatedSession,
} from "@deployer/shared/e2e-harness/authenticated-session";

/** A signed-in admin reads the fleet service's node and provider surfaces. */
describe("Fleet routes e2e: an authenticated admin", () => {
	let context: SharedApiRuntimeContext;
	let admin: AuthenticatedSession;

	beforeAll(async () => {
		context = await getSharedApiRuntimeContext();
		admin = await createAuthenticatedSession(context, { role: "admin" });
	}, 120_000);

	it("lists the registered servers", async () => {
		const response = await context.http.get("/nodes/servers").set("cookie", admin.cookie).expect(200);

		expect(Array.isArray((response.body as { items: unknown[] }).items)).toBe(true);
	});

	it("lists the deployment providers", async () => {
		const response = await context.http.get("/providers").set("cookie", admin.cookie).expect(200);

		const providers = (response.body as { providers: { id: string }[] }).providers;
		expect(providers.map((provider) => provider.id)).toContain("github");
	});
});
