import { beforeAll, describe, expect, it } from "vitest";

import { getSharedApiRuntimeContext, type SharedApiRuntimeContext } from "@/e2e/runtime";
import {
	createAuthenticatedSession,
	type AuthenticatedSession,
} from "@deployer/shared/e2e-harness/authenticated-session";

/**
 * A signed-in admin reads the detailed health report, which carries a `timestamp` date.
 *
 * Anonymous callers are refused (401) elsewhere; the report itself was never read.
 */
describe("Health routes e2e: an authenticated admin", () => {
	let context: SharedApiRuntimeContext;
	let admin: AuthenticatedSession;

	beforeAll(async () => {
		context = await getSharedApiRuntimeContext();
		admin = await createAuthenticatedSession(context, { role: "admin" });
	}, 120_000);

	it("reads the detailed report with its timestamp", async () => {
		const response = await context.http.get("/health/detailed").set("cookie", admin.cookie).expect(200);

		const body = response.body as { status: string; timestamp: string };
		expect(typeof body.status).toBe("string");
		expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
	});
});
