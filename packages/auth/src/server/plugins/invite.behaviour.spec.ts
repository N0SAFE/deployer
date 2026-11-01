import { describe, expect, it, vi } from "vitest";
import * as z from "zod";

import { invitePlugin } from "./invite";

/**
 * Behaviour of the two endpoints the audit found broken: the status filters (`usedAt` is `null` from the database, not
 * `undefined`) and the single-use claim in `validate` (it used to mark the invite after writing the account, so two
 * concurrent validates both provisioned).
 *
 * `createAuthEndpoint` is mocked by `invite.spec.ts` for the same plugin; here it is mocked to hand back the handler so
 * the flow can be driven with a fake adapter — no database, no HTTP.
 */
vi.mock("better-auth/api", () => ({
	createAuthEndpoint: vi.fn((path, config, handler) => ({ path, config, handler })),
	sessionMiddleware: vi.fn(),
}));

vi.mock("better-auth/crypto", () => ({
	generateRandomString: vi.fn(() => "spent-token-random"),
}));

const roleSchema = z.union([z.literal("admin"), z.literal("user")]) as never;

type Handler = (ctx: unknown) => Promise<unknown>;

const plugin = () =>
	invitePlugin({
		inviteDurationDays: 7,
		roleSchema,
		canCreateInvite: () => true,
		getDate: () => new Date("2026-11-01T00:00:00.000Z"),
	});

const invite = (overrides: Record<string, unknown> = {}) => ({
	id: "inv-1",
	token: "invite-token",
	email: "new@example.com",
	role: "user",
	createdAt: new Date("2026-10-31T00:00:00.000Z"),
	expiresAt: new Date("2026-11-08T00:00:00.000Z"),
	usedAt: null,
	invitedUserId: "user-9",
	...overrides,
});

/** A context shaped like Better Auth's, with the error/json helpers the handlers use. */
function contextOf(adapter: Record<string, unknown>, body: Record<string, unknown>, query: Record<string, unknown> = {}) {
	return {
		context: {
			session: { user: { id: "admin-1" } },
			adapter,
			password: { hash: vi.fn(async (password: string) => `hashed:${password}`) },
			internalAdapter: { findUserById: vi.fn(async () => ({ id: "admin-1", role: "admin" })) },
		},
		body,
		query,
		json: (payload: unknown, init?: unknown) => ({ payload, init }),
		error: (code: string, payload: { message: string }) => Object.assign(new Error(payload.message), { code }),
	};
}

describe("/invite/list filters", () => {
	const list = () => (plugin().endpoints.list as unknown as { handler: Handler }).handler;

	it("treats a null usedAt as pending, not as used", async () => {
		const adapter = {
			findMany: vi.fn(async () => [
				invite({ id: "a", token: "pending", usedAt: null }),
				invite({ id: "b", token: "used", usedAt: new Date("2026-10-31T12:00:00.000Z") }),
			]),
		};

		const result = (await list()(contextOf(adapter, {}, { status: "pending" }))) as { payload: { invitations: { id: string }[] } };

		expect(result.payload.invitations.map((row) => row.id)).toEqual(["a"]);
	});

	it("returns only the used rows for status=used", async () => {
		const adapter = {
			findMany: vi.fn(async () => [
				invite({ id: "a", token: "pending", usedAt: null }),
				invite({ id: "b", token: "used", usedAt: new Date("2026-10-31T12:00:00.000Z") }),
			]),
		};

		const result = (await list()(contextOf(adapter, {}, { status: "used" }))) as { payload: { invitations: { id: string }[] } };

		expect(result.payload.invitations.map((row) => row.id)).toEqual(["b"]);
	});
});

describe("/invite/validate single use", () => {
	const validate = () => (plugin().endpoints.validate as unknown as { handler: Handler }).handler;

	it("claims the invite before writing anything, and rotates its token", async () => {
		const adapter = {
			findOne: vi.fn(async (args: { model: string; where: { value: string }[] }) => {
				if (args.model === "account") return null;
				return args.where[0]?.value === "invite-token"
					? invite()
					: invite({ token: "invite-token.spent.spent-token-random", usedAt: new Date("2026-11-01T00:00:00.000Z") });
			}),
			update: vi.fn(async (_args: { update: { token: string; usedAt: Date } }) => null),
			create: vi.fn(async () => null),
		};

		await validate()(contextOf(adapter, { token: "invite-token", password: "correct-horse", name: "New" }));

		const claim = adapter.update.mock.calls[0]?.[0];
		expect(claim?.update.token).toBe("invite-token.spent.spent-token-random");
		expect(adapter.create).toHaveBeenCalledTimes(1);
	});

	it("refuses when another caller already consumed the invite", async () => {
		const adapter = {
			// The row exists under the original token, but the spent-token read-back finds nothing: this caller lost.
			findOne: vi.fn(async (args: { model: string; where: { value: string }[] }) =>
				args.model === "platformInvite" && args.where[0]?.value === "invite-token" ? invite() : null,
			),
			update: vi.fn(async () => null),
			create: vi.fn(async () => null),
		};

		await expect(
			validate()(contextOf(adapter, { token: "invite-token", password: "correct-horse", name: "New" })),
		).rejects.toThrow(/already been used/);
		expect(adapter.create).not.toHaveBeenCalled();
	});

	it("refuses an expired invite without claiming it", async () => {
		const adapter = {
			findOne: vi.fn(async () => invite({ expiresAt: new Date("2026-10-01T00:00:00.000Z") })),
			update: vi.fn(async () => null),
			create: vi.fn(async () => null),
		};

		await expect(
			validate()(contextOf(adapter, { token: "invite-token", password: "correct-horse", name: "New" })),
		).rejects.toThrow(/Invalid or expired invite/);
		expect(adapter.update).not.toHaveBeenCalled();
	});
});
