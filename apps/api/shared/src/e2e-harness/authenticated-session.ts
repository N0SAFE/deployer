import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { user } from "@deployer/nest-schema/global/identity/auth";
import { GlobalDatabaseService } from "../core/modules/database/services/global-database.service";
import type { SharedApiRuntimeContext } from "./shared-api-runtime";

/**
 * A REAL signed-in caller for an e2e spec: a user created through Better Auth, given a
 * platform role, signed in, and reduced to the `Cookie` header a request carries.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Until now the e2e suites asserted only that anonymous callers are refused. The first full
 * boot found five delegated routes answering `500` to a signed-in admin, and nothing in CI
 * could have caught it, because no spec ever made an authorised call and read the answer.
 * This is the missing half: a caller who is allowed in.
 *
 * The role is written straight to the `user` row rather than through the user service: arranging
 * a fixture must not depend on the rules of the domain under test (and `signUpEmail` cannot set
 * a role).
 */
export type AuthenticatedSession = {
	readonly userId: string;
	readonly email: string;
	/** The value of the `Cookie` request header. */
	readonly cookie: string;
};

export async function createAuthenticatedSession(
	context: SharedApiRuntimeContext,
	options: { role?: "superAdmin" | "admin" | "operator" | "viewer" } = {},
): Promise<AuthenticatedSession> {
	const email = `e2e-${randomUUID()}@e2e.deployer.test`;
	const password = `e2e-${randomUUID()}`;

	const created = (await context.betterAuth.api.signUpEmail({
		body: { email, password, name: "E2E Caller" },
	})) as { user: { id: string } };
	const userId = created.user.id;

	const db = context.serviceMapper.get(GlobalDatabaseService).db;
	await db
		.update(user)
		.set({ role: options.role ?? "admin", emailVerified: true })
		.where(eq(user.id, userId));

	const response = await context.betterAuth.api.signInEmail({
		body: { email, password },
		asResponse: true,
	});
	const cookie = response.headers
		.getSetCookie()
		.map((entry) => entry.split(";")[0])
		.filter((pair): pair is string => pair !== undefined && pair.length > 0)
		.join("; ");
	if (cookie.length === 0) {
		throw new Error("signInEmail returned no session cookie");
	}

	return { userId, email, cookie };
}
