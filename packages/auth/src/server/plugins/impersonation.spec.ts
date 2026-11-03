import { beforeEach, describe, expect, it, vi } from "vitest";

import { IMPERSONATION_TTL_SECONDS } from "../../authz/impersonation";

import { impersonationPlugin } from "./impersonation";

vi.mock("better-auth/api", () => ({
	createAuthEndpoint: vi.fn((path, config, handler) => ({ path, config, handler })),
	sessionMiddleware: vi.fn(),
}));

const { setSessionCookie } = vi.hoisted(() => ({ setSessionCookie: vi.fn() }));
vi.mock("better-auth/cookies", () => ({ setSessionCookie }));

type Handler = (ctx: unknown) => Promise<{ body: Record<string, unknown>; status: number }>;

/** The endpoint's handler, as the mocked `createAuthEndpoint` returns it. */
const handlerOf = (plugin: ReturnType<typeof impersonationPlugin>, name: "impersonate" | "stopImpersonating"): Handler =>
	(plugin.endpoints[name] as unknown as { handler: Handler }).handler;

const target = { id: "target-1", name: "Ada", email: "ada@example.com", role: "user", banned: false };

function makeContext(overrides: { session?: unknown; stepUp?: boolean } = {}) {
	return {
		body: { userId: "target-1", reason: "debugging a deploy" },
		headers: new Headers({ "user-agent": "vitest", "x-forwarded-for": "10.0.0.1" }),
		context: {
			session:
				"session" in overrides
					? overrides.session
					: {
							session: { id: "session-admin", token: "admin-token", impersonatedBy: null },
							user: { id: "admin-1", role: "superAdmin" },
						},
			adapter: { findOne: vi.fn(() => Promise.resolve(target)) },
			internalAdapter: {
				createSession: vi.fn(() => Promise.resolve({ id: "session-impersonated", token: "imp-token" })),
				findSession: vi.fn(),
				deleteSession: vi.fn(() => Promise.resolve()),
			},
			secret: "test-secret",
		},
		json: (body: Record<string, unknown>, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }),
		setSignedCookie: vi.fn(),
		setCookie: vi.fn(),
		getSignedCookie: vi.fn(),
	};
}

describe("impersonationPlugin", () => {
	const audit = { record: vi.fn() };

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("refuses a caller with no session", async () => {
		const plugin = impersonationPlugin({ hasStepUp: () => Promise.resolve(true), audit });
		const response = await handlerOf(plugin, "impersonate")(makeContext({ session: null }));

		expect(response.status).toBe(401);
	});

	it("refuses a target that is not weaker, and records the refusal", async () => {
		const plugin = impersonationPlugin({ hasStepUp: () => Promise.resolve(true), audit });
		const ctx = makeContext();
		ctx.context.adapter.findOne.mockResolvedValue({ ...target, role: "superAdmin" });

		const response = await handlerOf(plugin, "impersonate")(ctx);

		expect(response.status).toBe(403);
		expect(ctx.context.internalAdapter.createSession).not.toHaveBeenCalled();
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({ action: "impersonation-start", detail: { refused: "equal-or-higher" } }),
		);
	});

	it("refuses without a fresh passkey step-up", async () => {
		const plugin = impersonationPlugin({ hasStepUp: () => Promise.resolve(false), audit });
		const ctx = makeContext();

		const response = await handlerOf(plugin, "impersonate")(ctx);

		expect(response.status).toBe(403);
		expect(ctx.context.internalAdapter.createSession).not.toHaveBeenCalled();
	});

	it("refuses without a step-up port at all", async () => {
		const plugin = impersonationPlugin({ audit });

		const response = await handlerOf(plugin, "impersonate")(makeContext());

		expect(response.status).toBe(403);
	});

	it("mints a one-hour session marked with the admin, and parks the admin's token", async () => {
		const plugin = impersonationPlugin({ hasStepUp: () => Promise.resolve(true), audit });
		const ctx = makeContext();

		const response = await handlerOf(plugin, "impersonate")(ctx);

		expect(response.status).toBe(200);
		const [userId, , override] = ctx.context.internalAdapter.createSession.mock.calls[0] as unknown as [
			string,
			boolean,
			{ impersonatedBy: string; expiresAt: Date },
		];
		expect(userId).toBe("target-1");
		expect(override.impersonatedBy).toBe("admin-1");
		expect(override.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(IMPERSONATION_TTL_SECONDS * 1000);

		expect(ctx.setSignedCookie).toHaveBeenCalledWith(
			"deployer.admin_session",
			"admin-token",
			"test-secret",
			expect.objectContaining({ httpOnly: true, maxAge: IMPERSONATION_TTL_SECONDS }),
		);
		expect(setSessionCookie).toHaveBeenCalled();
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "impersonation-start",
				actorId: "admin-1",
				targetId: "target-1",
				detail: expect.objectContaining({ reason: "debugging a deploy" }),
			}),
		);
	});

	it("stops only when the parked session belongs to the impersonating admin", async () => {
		const plugin = impersonationPlugin({ hasStepUp: () => Promise.resolve(true), audit });
		const ctx = makeContext({
			session: {
				session: { id: "session-impersonated", token: "imp-token", impersonatedBy: "admin-1" },
				user: { id: "target-1", role: "user" },
			},
		});
		ctx.getSignedCookie = vi.fn(() => Promise.resolve("admin-token"));
		ctx.context.internalAdapter.findSession.mockResolvedValue({
			session: { id: "session-admin", token: "admin-token" },
			user: { id: "admin-1", role: "superAdmin" },
		});

		const response = await handlerOf(plugin, "stopImpersonating")(ctx);

		expect(response.status).toBe(200);
		expect(ctx.context.internalAdapter.deleteSession).toHaveBeenCalledWith("imp-token");
		expect(ctx.setCookie).toHaveBeenCalledWith("deployer.admin_session", "", expect.objectContaining({ maxAge: 0 }));
	});

	it("refuses to restore a parked session that is a different user", async () => {
		const plugin = impersonationPlugin({ hasStepUp: () => Promise.resolve(true), audit });
		const ctx = makeContext({
			session: {
				session: { id: "session-impersonated", token: "imp-token", impersonatedBy: "admin-1" },
				user: { id: "target-1", role: "user" },
			},
		});
		ctx.getSignedCookie = vi.fn(() => Promise.resolve("someone-elses-token"));
		ctx.context.internalAdapter.findSession.mockResolvedValue({
			session: { id: "session-other", token: "someone-elses-token" },
			user: { id: "admin-2", role: "superAdmin" },
		});

		const response = await handlerOf(plugin, "stopImpersonating")(ctx);

		expect(response.status).toBe(400);
		expect(ctx.context.internalAdapter.deleteSession).not.toHaveBeenCalled();
	});
});
