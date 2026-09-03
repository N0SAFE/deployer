/**
 * E2E — App-instance lifecycle (api-centric deployment, BYO flow).
 *
 * Exercises the full possession-based identity path against a real running
 * API + shared Postgres:
 *
 *   1. A consumer creates an account on the target API.
 *   2. Their web instance registers with those credentials → receives a token
 *      scoped to THE WEB APP (never user claims).
 *   3. Heartbeats keep the instance active; bad/garbage tokens are rejected.
 *   4. Operator-side revocation instantly kills the instance's access.
 *
 * Operator-side assertions use serviceMapper (direct service handles) — the
 * HTTP auth surface for admin routes is covered by module-http-guards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	getSharedApiRuntimeContext,
	stopSharedApiRuntime,
	type SharedApiRuntimeContext,
} from "../utils/shared-api-runtime";
import { AppInstanceService } from "@/core/modules/platform-ingress/services/app-instance.service";

const INSTANCE_LABEL = "e2e-byo-web";

describe("Platform: app-instance lifecycle (BYO)", () => {
	let context: SharedApiRuntimeContext;
	let instances: AppInstanceService;
	const account = {
		email: `byo-web-${Date.now()}@e2e.deployer.test`,
		password: "e2e-byo-pass-123",
		name: "BYO Web Instance",
	};
	let appToken = "";
	let instanceId = "";

	beforeAll(async () => {
		context = await getSharedApiRuntimeContext({ instanceKey: "platform-app-instance" });
		instances = context.serviceMapper.get(AppInstanceService);

		// Consumer account on THIS API — the anti-abuse boundary for registration.
		// Fail LOUDLY with the provider's own error body — silent signup
		// failures otherwise surface as confusing 401s in the register test.
		let signUpResult: unknown;
		try {
			signUpResult = await context.betterAuth.api.signUpEmail({
				body: { email: account.email, password: account.password, name: account.name },
			});
		} catch (error) {
			const detail =
				(error as { body?: unknown; message?: string }).body ??
				(error as { message?: string }).message ??
				String(error);
			throw new Error(`signUpEmail failed: ${JSON.stringify(detail)}`);
		}
		if (
			signUpResult === null ||
			typeof signUpResult !== "object" ||
			!("user" in signUpResult)
		) {
			throw new Error(
				`signUpEmail did not create a user: ${JSON.stringify(signUpResult)}`,
			);
		}

		// Prove the credentials actually authenticate before the register tests.
		await context.betterAuth.api.signInEmail({
			body: { email: account.email, password: account.password },
		});
	}, 180_000);

	afterAll(async () => {
		await stopSharedApiRuntime({ instanceKey: "platform-app-instance" });
	});

	it("rejects registration with invalid credentials (401 surface)", async () => {
		const response = await context.http
			.post("/platform/app-instances/register")
			.set("content-type", "application/json")
			.send({
				email: account.email,
				password: "definitely-wrong-password",
				instanceLabel: INSTANCE_LABEL,
			})
			.expect(401);

		expect(response.body).toBeDefined();
	});

	it("registers a web instance and returns its own (non-user) token", async () => {
		const response = await context.http
			.post("/platform/app-instances/register")
			.set("content-type", "application/json")
			.send({
				email: account.email,
				password: account.password,
				instanceLabel: INSTANCE_LABEL,
			});

		// Surface the error body directly — 401s here must be explainable.
		if (response.status !== 201) {
			console.error(
				`[e2e] register failed ${String(response.status)}: ${JSON.stringify(response.body)}`,
			);
		}
		expect(response.status).toBe(201);

		const body = response.body as {
			instanceId: string;
			appToken: string;
			heartbeatIntervalMs: number;
		};

		expect(body.instanceId).toBeTruthy();
		// Opaque 32-byte base64url token — 43 chars.
		expect(body.appToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(body.heartbeatIntervalMs).toBeGreaterThan(0);

		appToken = body.appToken;
		instanceId = body.instanceId;

		// The instance exists server-side in active state.
		const stored = await instances.list();
		const mine = stored.find((row) => row.id === instanceId);
		expect(mine?.status).toBe("active");
		expect(mine?.kind).toBe("external");
		expect(mine?.label).toBe(INSTANCE_LABEL);
	});

	it("accepts heartbeats carrying the instance token", async () => {
		const response = await context.http
			.post("/platform/app-instances/heartbeat")
			.set("content-type", "application/json")
			.set("x-app-instance-token", appToken)
			.send({});

		if (response.status !== 201) {
			console.error(
				`[e2e] heartbeat failed ${String(response.status)}: ${JSON.stringify(response.body)}`,
			);
		}
		expect(response.status).toBe(201);

		const body = response.body as { renewUntil: string };
		expect(new Date(body.renewUntil).getTime()).toBeGreaterThan(Date.now());
	});

	it("rejects heartbeats without or with garbage tokens", async () => {
		await context.http
			.post("/platform/app-instances/heartbeat")
			.set("content-type", "application/json")
			.send({})
			.expect(401);

		await context.http
			.post("/platform/app-instances/heartbeat")
			.set("content-type", "application/json")
			.set("x-app-instance-token", "totally-made-up-token")
			.send({})
			.expect(401);
	});

	it("revocation is immediate: heartbeat dies after operator revoke", async () => {
		const revoked = await instances.revoke(instanceId);
		expect(revoked).toBe(true);

		await context.http
			.post("/platform/app-instances/heartbeat")
			.set("content-type", "application/json")
			.set("x-app-instance-token", appToken)
			.send({})
			.expect(401);
	});

	it("revoking twice is idempotent", async () => {
		const second = await instances.revoke(instanceId);
		// Second call finds no live (non-revoked) row to transition — either a
		// false or a no-op true is acceptable, but the store must stay revoked.
		void second;
		const stored = await instances.list();
		const mine = stored.find((row) => row.id === instanceId);
		expect(mine?.status).toBe("revoked");
	});
});
