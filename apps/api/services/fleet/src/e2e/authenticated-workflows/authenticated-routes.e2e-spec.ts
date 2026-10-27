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

	// A domain error thrown from a Promise-based service reaches the client as its declared code,
	// through the shared host's `domainErrorInterceptor`, with the sentence the error carries.
	it("answers an unknown provider schema as a defined NOT_FOUND carrying the service's message", async () => {
		const response = await context.http.get("/providers/no-such-provider/schema").set("cookie", admin.cookie).expect(404);

		const body = response.body as { code: string; message: string };
		expect(body.code).toBe("NOT_FOUND");
		expect(body.message).toContain("no-such-provider");
	});
});
