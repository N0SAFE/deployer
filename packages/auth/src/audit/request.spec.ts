import { describe, expect, it } from "vitest";

import { auditEventFromRequest, type AuditRequestContext } from "./request";

const request = (patch: Partial<AuditRequestContext> = {}): AuditRequestContext => ({
	path: "/sign-in/email",
	sessionUserId: undefined,
	body: undefined,
	returned: undefined,
	ip: "203.0.113.7",
	userAgent: "vitest",
	...patch,
});

describe("auditEventFromRequest", () => {
	it("records a sign-in with the actor the endpoint authenticated", () => {
		const event = auditEventFromRequest(
			request({ returned: { user: { id: "u1" }, token: "t" } }),
		);

		expect(event).toEqual({
			action: "sign-in",
			actorId: "u1",
			ip: "203.0.113.7",
			userAgent: "vitest",
		});
	});

	it("matches every sign-in provider by prefix", () => {
		expect(auditEventFromRequest(request({ path: "/sign-in/passkey" }))?.action).toBe("sign-in");
		expect(auditEventFromRequest(request({ path: "/sign-in/social" }))?.action).toBe("sign-in");
	});

	it("records who signed out from the session that did it", () => {
		expect(auditEventFromRequest(request({ path: "/sign-out", sessionUserId: "u1" }))).toMatchObject({
			action: "sign-out",
			actorId: "u1",
		});
	});

	it("records both sides of a role change, and the granted role", () => {
		const event = auditEventFromRequest(
			request({ path: "/admin/set-role", sessionUserId: "admin-1", body: { userId: "u2", role: "operator" } }),
		);

		expect(event).toMatchObject({
			action: "role-change",
			actorId: "admin-1",
			targetId: "u2",
			detail: { role: "operator" },
		});
	});

	it("distinguishes a ban from an unban", () => {
		expect(
			auditEventFromRequest(request({ path: "/admin/ban-user", sessionUserId: "a", body: { userId: "u2" } }))?.action,
		).toBe("ban");
		expect(
			auditEventFromRequest(request({ path: "/admin/unban-user", sessionUserId: "a", body: { userId: "u2" } }))?.action,
		).toBe("unban");
	});

	it("keeps the subject of an admin action even when the body is not what we expect", () => {
		const event = auditEventFromRequest(
			request({ path: "/admin/remove-user", sessionUserId: "a", body: "not-an-object" }),
		);

		// The action and the actor are still worth recording; the detail is simply absent.
		expect(event).toMatchObject({ action: "user-deleted", actorId: "a" });
		expect(event?.detail).toBeUndefined();
		expect(event?.targetId).toBeUndefined();
	});

	it("returns null for traffic that is not an audited action", () => {
		expect(auditEventFromRequest(request({ path: "/get-session" }))).toBeNull();
		expect(auditEventFromRequest(request({ path: "/ok" }))).toBeNull();
	});

	it("never records a secret: only the key id reaches the detail", () => {
		const event = auditEventFromRequest(
			request({ path: "/api-key/create", sessionUserId: "u1", body: { name: "cli", keyId: "k1", key: "dk_secret" } }),
		);

		expect(event?.detail).toEqual({ keyId: "k1" });
		expect(JSON.stringify(event)).not.toContain("dk_secret");
	});
});
