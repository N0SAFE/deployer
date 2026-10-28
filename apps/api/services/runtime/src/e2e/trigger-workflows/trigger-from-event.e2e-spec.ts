import { signSystemActorClaim } from "@deployer/shared/core/modules/auth/system-actor/system-actor";
import { beforeAll, describe, expect, it } from "vitest";

import { getSharedApiRuntimeContext, type SharedApiRuntimeContext } from "@/e2e/runtime";

/**
 * `deployment.triggerFromEvent` through the real app: a peer service's signed system-actor claim,
 * the Effect runtime built over the deployment module's ports, and the trigger registry.
 *
 * Only the answers that need no queue are asserted here: an event no source claims, and a call that
 * carries no valid claim. Queueing a deployment is covered where the deployment service is.
 */
describe("Trigger from event e2e: the peer-only procedure", () => {
	let context: SharedApiRuntimeContext;
	let secret: string;

	beforeAll(async () => {
		context = await getSharedApiRuntimeContext();
		secret = (process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET ?? "").trim();
	}, 120_000);

	const claim = () => signSystemActorClaim({ source: "e2e", deliveryId: "d-e2e", aud: "runtime" }, secret);

	it("reports an event no trigger source owns as a normal outcome, not an error", async () => {
		expect(secret.length).toBeGreaterThan(0);
		const response = await context.http
			.post("/deployments/trigger-event")
			.set("x-deployer-system-actor", claim())
			.send({ provider: "github", eventName: "star", payload: {} })
			.expect(200);

		expect(response.body).toMatchObject({
			dispatched: false,
			sourceId: null,
			reason: "no_trigger_source:github/star",
		});
	});

	it("refuses a call with no claim, and one addressed to another service", async () => {
		const event = { provider: "github", eventName: "star", payload: {} };
		await context.http.post("/deployments/trigger-event").send(event).expect(401);
		await context.http
			.post("/deployments/trigger-event")
			.set("x-deployer-system-actor", signSystemActorClaim({ source: "e2e", aud: "fleet" }, secret))
			.send(event)
			.expect(401);
	});
});
