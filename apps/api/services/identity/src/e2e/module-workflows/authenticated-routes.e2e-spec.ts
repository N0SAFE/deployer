import { beforeAll, describe, expect, it } from "vitest";
import z from "zod/v4";

import {
	createAuthenticatedSession,
	type AuthenticatedSession,
} from "@deployer/shared/e2e-harness/authenticated-session";

import { getSharedApiRuntimeContext, type SharedApiRuntimeContext } from "@/e2e/runtime";

/**
 * A signed-in admin calls the identity service's routes and gets real answers.
 *
 * The anonymous cases elsewhere only prove who is refused. This proves what an allowed caller
 * receives: the status, and that the service's own output validation accepted what it built
 * (a failure there is a `500 Output validation failed`, which is what the first full boot found
 * on every list called without pagination).
 *
 * Response bodies are PARSED, not asserted with `as`: supertest types `response.body` as `any`,
 * so a cast would make every field read untyped (and lint refuses that). A schema here also
 * fails with the offending body when the service changes its shape, which is the point of an
 * end-to-end check.
 */
const userPageSchema = z.object({
	data: z.array(z.object({ id: z.string() })),
	meta: z.object({ limit: z.number(), offset: z.number(), total: z.number() }),
});

const userSchema = z.object({ id: z.string(), createdAt: z.string() });

describe("Identity routes e2e: an authenticated admin", () => {
	let context: SharedApiRuntimeContext;
	let admin: AuthenticatedSession;

	beforeAll(async () => {
		context = await getSharedApiRuntimeContext();
		admin = await createAuthenticatedSession(context, { role: "admin" });
	}, 120_000);

	it("lists users with NO query and gets the contract's default pagination", async () => {
		const response = await context.http.get("/user").set("cookie", admin.cookie).expect(200);

		const body = userPageSchema.parse(response.body);
		expect(body.meta).toMatchObject({ limit: 20, offset: 0 });
		expect(body.meta.total).toBeGreaterThanOrEqual(1);
		expect(body.data.map((row) => row.id)).toContain(admin.userId);
	});

	it("honours an explicit query", async () => {
		const response = await context.http
			.get("/user")
			.query({ "query[limit]": 1, "query[offset]": 0 })
			.set("cookie", admin.cookie)
			.expect(200);

		const body = userPageSchema.parse(response.body);
		expect(body.meta.limit).toBe(1);
		expect(body.data).toHaveLength(1);
	});

	it("reads a user by id, with its dates", async () => {
		const response = await context.http.get(`/user/${admin.userId}`).set("cookie", admin.cookie).expect(200);

		const body = userSchema.parse(response.body);
		expect(body.id).toBe(admin.userId);
		expect(Number.isNaN(Date.parse(body.createdAt))).toBe(false);
	});

	it("answers the analytics read with data, not an error", async () => {
		const response = await context.http.get("/analytics/metrics/deployments").set("cookie", admin.cookie).expect(200);

		const body = z.object({ dataSource: z.string() }).parse(response.body);
		expect(body.dataSource).toBe("deployments");
	});
});
