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

const rolePageSchema = z.object({
	data: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			scope: z.string(),
			rank: z.number(),
			label: z.string(),
			isSystem: z.boolean(),
			permissions: z.array(z.string()),
		}),
	),
});

const stepUpSchema = z.object({
	steppedUp: z.boolean(),
	critical: z.boolean(),
	method: z.enum(["passkey", "totp"]).nullable(),
	windowSeconds: z.number().int(),
});

const approvalSchema = z.object({
	id: z.string(),
	permission: z.string(),
	requesterId: z.string(),
	actionHash: z.string(),
	status: z.string(),
	requiredApprovals: z.number().int(),
	approvals: z.number().int(),
});

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

	it("serves the seeded role catalogue", async () => {
		const response = await context.http.get("/roles").set("cookie", admin.cookie).expect(200);

		const body = rolePageSchema.parse(response.body);
		// The seed runs at boot, so the built-ins are rows the API can answer with.
		expect(body.data.map((role) => role.name)).toEqual(expect.arrayContaining(["admin", "superAdmin", "viewer"]));
		expect(body.data.find((role) => role.name === "admin")?.isSystem).toBe(true);
	});

	it("answers whether this session stepped up, and it has not", async () => {
		const response = await context.http.get("/authz/step-up").set("cookie", admin.cookie).expect(200);

		const body = stepUpSchema.parse(response.body);
		expect(body).toMatchObject({ steppedUp: false, critical: false, method: null, windowSeconds: 300 });
	});

	it("exports the CALLER's own data, scoped to the session", async () => {
		const response = await context.http.get("/user/me/export").set("cookie", admin.cookie).expect(200);

		const body = z
			.object({
				exportedAt: z.string(),
				user: z.object({ id: z.string() }),
				sessions: z.array(z.object({ id: z.string() })),
				apiKeys: z.array(z.object({ id: z.string() })),
			})
			.parse(response.body);
		expect(body.user.id).toBe(admin.userId);
		// No id parameter exists on the route: a caller cannot ask for someone else's export.
		expect(body.sessions.length).toBeGreaterThanOrEqual(1);
	});

	it("files an approval request and lists it, without deciding it", async () => {
		const create = await context.http
			.post("/approvals")
			.set("cookie", admin.cookie)
			.send({
				permission: "user:delete",
				scope: { userId: admin.userId },
				actionHash: "b".repeat(64),
				reason: "e2e: proving the ledger round-trips",
			})
			.expect(200);

		const created = approvalSchema.parse(create.body);
		expect(created).toMatchObject({ permission: "user:delete", status: "pending", requesterId: admin.userId });

		const list = await context.http
			.get("/approvals")
			.query({ "query[status]": "pending" })
			.set("cookie", admin.cookie)
			.expect(200);

		const page = z.object({ data: z.array(approvalSchema) }).parse(list.body);
		expect(page.data.map((row) => row.id)).toContain(created.id);

		// Deciding needs a passkey proof this session never gave, so the refusal is the step-up, not a self-approval.
		await context.http
			.post(`/approvals/${created.id}/decide`)
			.set("cookie", admin.cookie)
			.send({ decision: "approve" })
			.expect(403);
	});

	it("refuses to delete an account without a passkey step-up", async () => {
		const target = await createAuthenticatedSession(context, { role: "viewer" });

		const response = await context.http.delete(`/user/${target.userId}`).set("cookie", admin.cookie);

		expect(response.status).toBe(403);
		// Parsed, not cast: supertest types the body as `any` and lint refuses an untyped read.
		expect(z.object({ message: z.string() }).parse(response.body).message).toContain("step-up");
	});

	it("answers the analytics read with data, not an error", async () => {
		const response = await context.http.get("/analytics/metrics/deployments").set("cookie", admin.cookie).expect(200);

		const body = z.object({ dataSource: z.string() }).parse(response.body);
		expect(body.dataSource).toBe("deployments");
	});
});
