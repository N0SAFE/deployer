import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { provideTo } from "@deployer/effect-core";

import { GithubAppsStore, type GithubAppsStoreShape } from "../repositories/github-apps.repository";

import { WebhookIdempotencyService } from "./webhook-idempotency.service";

describe("WebhookIdempotencyService (durable)", () => {
	const store = { claimWebhookDelivery: vi.fn() };
	// The fake needs nothing from the context beyond what is provided here.
	const service = provideTo(WebhookIdempotencyService.live, (effect) =>
		(effect.pipe(Effect.provideService(GithubAppsStore, store as unknown as GithubAppsStoreShape)) as Effect.Effect<unknown>),
	);

	beforeEach(async () => {
		vi.clearAllMocks();
		store.claimWebhookDelivery.mockReturnValue(Effect.succeed(true));
		await Effect.runPromise(service.clear());
	});

	it("claims a delivery once, then dedupes it in-process", async () => {
		await expect(Effect.runPromise(service.claim("delivery-1", "push", { ref: "main" }))).resolves.toBe(true);
		expect(store.claimWebhookDelivery).toHaveBeenCalledWith({ deliveryId: "delivery-1", event: "push", payload: { ref: "main" } });

		await expect(Effect.runPromise(service.claim("delivery-1", "push", { ref: "main" }))).resolves.toBe(false);
		expect(store.claimWebhookDelivery).toHaveBeenCalledTimes(1);
	});

	it("dedupes a delivery the database already holds, as after a restart (empty cache)", async () => {
		store.claimWebhookDelivery.mockReturnValue(Effect.succeed(false));

		await expect(Effect.runPromise(service.claim("delivery-2", "push", {}))).resolves.toBe(false);
		// A refused claim is not remembered: only a delivery THIS process claimed is cached.
		await expect(Effect.runPromise(service.isDuplicate("delivery-2"))).resolves.toBe(false);
	});

	it("lets exactly one of two concurrent redeliveries win, because the claim is the database's", async () => {
		// The unique index decides: the first INSERT answers true, the conflicting one false.
		store.claimWebhookDelivery
			.mockReturnValueOnce(Effect.succeed(true))
			.mockReturnValueOnce(Effect.succeed(false));

		const results = await Effect.runPromise(
			Effect.all([service.claim("delivery-3", "push", {}), service.claim("delivery-3", "push", {})], { concurrency: "unbounded" }),
		);

		expect(results.filter(Boolean)).toHaveLength(1);
	});

	it("marks a delivery seen without touching the database", async () => {
		await Effect.runPromise(service.markSeen("delivery-4"));

		await expect(Effect.runPromise(service.isDuplicate("delivery-4"))).resolves.toBe(true);
		await expect(Effect.runPromise(service.claim("delivery-4", "push", {}))).resolves.toBe(false);
		expect(store.claimWebhookDelivery).not.toHaveBeenCalled();
	});

	it("clears the in-process cache, so the database decides again", async () => {
		await Effect.runPromise(service.claim("delivery-5", "push", {}));
		await Effect.runPromise(service.clear());

		store.claimWebhookDelivery.mockReturnValue(Effect.succeed(false));
		await expect(Effect.runPromise(service.claim("delivery-5", "push", {}))).resolves.toBe(false);
		expect(store.claimWebhookDelivery).toHaveBeenCalledTimes(2);
	});

	it("keeps the in-process cache bounded", async () => {
		for (let i = 0; i < 10_001; i++) await Effect.runPromise(service.markSeen(`d-${String(i)}`));

		// The oldest entry was evicted, the newest is still held.
		await expect(Effect.runPromise(service.isDuplicate("d-0"))).resolves.toBe(false);
		await expect(Effect.runPromise(service.isDuplicate("d-10000"))).resolves.toBe(true);
	});
});
