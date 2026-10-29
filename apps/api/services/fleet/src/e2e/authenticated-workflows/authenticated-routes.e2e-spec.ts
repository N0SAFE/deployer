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

	// Exercises the reachability Layers end to end. The whole FleetLive graph is built on the first call,
	// over platform services that are Nest providers (some created late in startup), so these two routes
	// prove the ports are real instances: the lanes are read from Postgres and the mesh view is built
	// even when no agent answers.
	it("reads the ingress lanes through the Effect services", async () => {
		const response = await context.http.get("/reachability/ingress").set("cookie", admin.cookie).expect(200);

		const body = response.body as { lanes: { entryPort: number }; mesh: { available: boolean }; edge: { providers: unknown[] } };
		expect(typeof body.lanes.entryPort).toBe("number");
		expect(typeof body.mesh.available).toBe("boolean");
		expect(body.edge.providers.length).toBeGreaterThan(0);
	});

	it("lists the node network configs through the Effect services", async () => {
		const response = await context.http.get("/reachability/node-network/all").set("cookie", admin.cookie).expect(200);

		expect(Array.isArray((response.body as { configs: unknown[] }).configs)).toBe(true);
	});

	// The cluster Layers over the swarm ports: the node inventory is read from the local store and
	// the master view from the persisted node row, neither of which needs a live engine.
	it.each(["/cluster/nodes", "/cluster/master"])("reads %s through the Effect services", async (path) => {
		await context.http.get(path).set("cookie", admin.cookie).expect(200);
	});

	// The managed-web Layer reads the platform config and the supervisor through the real runtime. The
	// controller documents itself as public, but nothing marks it `@AllowAnonymous`, so the global guard
	// answers an anonymous call with 401 (as it did before this module moved onto layers).
	it("answers the managed web console state through the Effect services", async () => {
		await context.http.get("/platform/managed-web/state").expect(401);
		const response = await context.http.get("/platform/managed-web/state").set("cookie", admin.cookie).expect(200);

		const body = response.body as { enabled: boolean; webHostname: string };
		expect(typeof body.enabled).toBe("boolean");
		expect(body.webHostname.length).toBeGreaterThan(0);
	});

	// The code and DNS providers' Effect services over the fleet database: each answer reads Postgres
	// through `FleetDb`, so these routes prove the stores, the ports and the module context are real.
	it.each([
		["/github/apps", "apps"],
		["/gitlab/apps", "apps"],
		["/dns/providers", "providers"],
	])("lists %s through the Effect services", async (path, key) => {
		const response = await context.http.get(path).set("cookie", admin.cookie).expect(200);

		const body = response.body as Record<string, unknown>;
		expect(Array.isArray(body[key])).toBe(true);
	});

	// The webhook guard is an Effect over the idempotency service and the apps store: with no webhook
	// secret configured it fails closed, as a domain error the host answers 401.
	it("refuses a GitHub webhook delivery when no webhook secret is configured", async () => {
		const response = await context.http
			.post("/webhooks/github")
			.set("cookie", admin.cookie)
			.set("x-github-event", "ping")
			.set("x-github-delivery", "e2e-delivery-1")
			.send({ zen: "keep it logically awesome" })
			.expect(401);

		expect((response.body as { code: string }).code).toBe("UNAUTHORIZED");
	});
});
