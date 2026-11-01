import { describe, expect, it, vi } from "vitest";

import { adminSessionRevocationPlugin, revokedUserId } from "./adminSessionRevocation";

/**
 * The revocation half of an administration action: after a ban, a role change or a removal, the target must not keep
 * acting. The plugin's work is two adapter calls, so the test drives the hook with a fake context and asserts what it
 * asks for — including that a failure to revoke never turns a successful ban into an error.
 */
type AfterHook = { matcher: (ctx: { path?: string }) => boolean; handler: (ctx: unknown) => Promise<unknown> };

const afterHook = (): AfterHook =>
	(adminSessionRevocationPlugin().hooks?.after?.[0] ?? {}) as unknown as AfterHook;

function contextOf(options: {
	readonly sessions?: { token: string }[];
	readonly deleteSessions?: (...args: unknown[]) => Promise<unknown>;
	readonly deleteMany?: (args: unknown) => Promise<unknown>;
}) {
	const listSessions = vi.fn(async () => options.sessions ?? []);
	const deleteSessions = vi.fn(options.deleteSessions ?? (async () => undefined));
	const deleteMany = vi.fn(options.deleteMany ?? (async () => ({ count: 0 })));

	return {
		ctx: {
			path: "/admin/ban-user",
			body: { userId: "user-9" },
			context: {
				internalAdapter: { listSessions, deleteSessions },
				adapter: { deleteMany },
			},
		},
		spies: { listSessions, deleteSessions, deleteMany },
	};
}

describe("revokedUserId", () => {
	it("reads the target from the admin body", () => {
		expect(revokedUserId({ userId: "user-9" })).toBe("user-9");
	});

	it("refuses a body that names nobody", () => {
		expect(revokedUserId({})).toBeNull();
		expect(revokedUserId({ userId: "" })).toBeNull();
		expect(revokedUserId({ userId: 42 })).toBeNull();
		expect(revokedUserId(undefined)).toBeNull();
	});
});

describe("adminSessionRevocationPlugin", () => {
	it("matches exactly the actions that change what a user may do", () => {
		const hook = afterHook();

		expect(hook.matcher({ path: "/admin/ban-user" })).toBe(true);
		expect(hook.matcher({ path: "/admin/set-role" })).toBe(true);
		expect(hook.matcher({ path: "/admin/remove-user" })).toBe(true);
		expect(hook.matcher({ path: "/admin/list-users" })).toBe(false);
		expect(hook.matcher({ path: "/get-session" })).toBe(false);
	});

	it("deletes every session of the target, by token", async () => {
		const { ctx, spies } = contextOf({ sessions: [{ token: "a" }, { token: "b" }] });

		await afterHook().handler(ctx);

		expect(spies.listSessions).toHaveBeenCalledWith("user-9");
		expect(spies.deleteSessions).toHaveBeenCalledWith(["a", "b"]);
	});

	it("deletes the target's API keys, which resolve to sessions of their own", async () => {
		const { ctx, spies } = contextOf({});

		await afterHook().handler(ctx);

		expect(spies.deleteMany).toHaveBeenCalledWith({
			model: "apikey",
			where: [{ field: "referenceId", value: "user-9" }],
		});
	});

	it("keeps a successful ban successful when the revocation itself fails", async () => {
		const { ctx } = contextOf({
			sessions: [{ token: "a" }],
			deleteSessions: async () => {
				throw new Error("database is gone");
			},
			deleteMany: async () => {
				throw new Error("database is gone");
			},
		});

		await expect(afterHook().handler(ctx)).resolves.toBeUndefined();
	});

	it("does nothing when the action names no target", async () => {
		const { ctx, spies } = contextOf({ sessions: [{ token: "a" }] });
		const withoutTarget = { ...ctx, body: {} };

		await afterHook().handler(withoutTarget);

		expect(spies.listSessions).not.toHaveBeenCalled();
		expect(spies.deleteMany).not.toHaveBeenCalled();
	});
});
