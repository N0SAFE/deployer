import { Cause, Effect, Exit } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { provideTo } from "@deployer/effect-core";

import { FleetConflict, FleetInvalid, FleetNotFound } from "@/core/fleet.errors";
import { EdgeProviders, type EdgeProvidersShape } from "@/core/ports/edge-providers.port";
import { IngressLanes, type IngressLanesShape } from "@/core/ports/ingress-lanes.port";

import { DnsProvidersStore, type DnsProvidersStoreShape } from "../../shared/repositories/dns-providers.repository";

import { CloudflareAppService } from "./cloudflare-app.service";

/** The SDK stand-in: what the service asks of the client it builds from a stored token. */
const sdk = vi.hoisted(() => ({
	verify: vi.fn(),
	listAccounts: vi.fn(),
	listZones: vi.fn(),
}));

vi.mock("cloudflare", () => ({
	Cloudflare: class {
		user = { tokens: { verify: sdk.verify } };
		accounts = { list: sdk.listAccounts };
		zones = { list: sdk.listZones };
	},
}));

/** Run an Effect and reject with the ORIGINAL failure, so `rejects.toBeInstanceOf(...)` reads the real error. */
async function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
	const exit = await Effect.runPromiseExit(effect);
	if (Exit.isSuccess(exit)) return exit.value;
	throw Cause.squash(exit.cause);
}

const now = new Date("2026-10-29T10:00:00.000Z");

const row = (overrides: Record<string, unknown> = {}) => ({
	id: "p1",
	providerType: "cloudflare",
	name: "main",
	isActive: true,
	credentials: JSON.stringify({ apiToken: "tok-1" }),
	config: { accountId: null },
	features: { dnsManagement: true, tunnelManagement: false },
	state: null,
	createdAt: now,
	updatedAt: now,
	...overrides,
});

/** The store, lanes and edge registry are plain objects of `vi.fn()`; every store call answers an Effect. */
function setup(rows: Record<string, ReturnType<typeof row>> = { p1: row() }) {
	const store = {
		findById: vi.fn((id: string) => Effect.succeed(rows[id] ?? null)),
		list: vi.fn(() => Effect.succeed(Object.values(rows))),
		create: vi.fn((values: Record<string, unknown>) => {
			const created = row({ ...values, id: "p-new" });
			rows[created.id] = created;
			return Effect.succeed(created);
		}),
		updateById: vi.fn((id: string, values: Record<string, unknown>) => Effect.succeed(rows[id] ? { ...rows[id], ...values } : null)),
		deleteById: vi.fn(() => Effect.void),
	};
	const lanes = { getLanes: vi.fn(() => Promise.resolve({})) };
	const edges = { accountsInUse: vi.fn((): string[] => []) };
	// The fakes need nothing from the context beyond what is provided here.
	const service = provideTo(CloudflareAppService.live, (effect) =>
		(effect.pipe(
			Effect.provideService(DnsProvidersStore, store as unknown as DnsProvidersStoreShape),
			Effect.provideService(IngressLanes, lanes as unknown as IngressLanesShape),
			Effect.provideService(EdgeProviders, edges as unknown as EdgeProvidersShape),
		) as Effect.Effect<unknown>),
	);
	return { service, store, lanes, edges };
}

describe("CloudflareAppService", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		sdk.verify.mockResolvedValue({ status: "active" });
		sdk.listAccounts.mockResolvedValue({ result: [{ id: "acc-1" }] });
		sdk.listZones.mockResolvedValue({ result: [] });
	});

	describe("createApp", () => {
		it("verifies the token, persists the row with its credentials and returns the live view", async () => {
			const { service, store } = setup();

			const view = await run(service.createApp({ name: "main", providerType: "cloudflare", apiToken: "tok-1", accountEmail: "ops@example.com" }));

			expect(sdk.verify).toHaveBeenCalled();
			expect(store.create).toHaveBeenCalledWith(
				expect.objectContaining({
					providerType: "cloudflare",
					name: "main",
					isActive: true,
					credentials: JSON.stringify({ apiToken: "tok-1", accountEmail: "ops@example.com" }),
					features: { dnsManagement: true, tunnelManagement: false },
				}),
			);
			expect(view).toMatchObject({ id: "p-new", name: "main", providerType: "cloudflare" });
			expect(view.state).toMatchObject({ status: "ok", tokenValid: true });
		});

		it("refuses a provider type that is not implemented, before touching the SDK or the store", async () => {
			const { service, store } = setup();
			await expect(run(service.createApp({ name: "r53", providerType: "route53", apiToken: "x" }))).rejects.toBeInstanceOf(FleetInvalid);
			expect(sdk.verify).not.toHaveBeenCalled();
			expect(store.create).not.toHaveBeenCalled();
		});

		it("refuses a token the SDK rejects, and one that is not active, without persisting anything", async () => {
			const { service, store } = setup();

			sdk.verify.mockRejectedValueOnce(new Error("bad token"));
			const failure = await run(service.createApp({ name: "main", providerType: "cloudflare", apiToken: "x" })).catch((e: unknown) => e);
			expect(failure).toBeInstanceOf(FleetInvalid);
			expect((failure as FleetInvalid).reason).toContain("bad token");

			sdk.verify.mockResolvedValueOnce({ status: "disabled" });
			await expect(run(service.createApp({ name: "main", providerType: "cloudflare", apiToken: "x" }))).rejects.toBeInstanceOf(FleetInvalid);

			expect(store.create).not.toHaveBeenCalled();
		});
	});

	describe("updateApp", () => {
		it("fails with not-found when the row does not exist", async () => {
			const { service, store } = setup({});
			await expect(run(service.updateApp("missing", { name: "x" }))).rejects.toBeInstanceOf(FleetNotFound);
			expect(store.updateById).not.toHaveBeenCalled();
		});

		it("merges the feature flags over the stored ones", async () => {
			const { service, store } = setup({ "p-upd": row({ id: "p-upd" }) });

			await run(service.updateApp("p-upd", { features: { tunnelManagement: true } }));

			expect(store.updateById).toHaveBeenCalledWith("p-upd", { features: { dnsManagement: true, tunnelManagement: true } });
		});
	});

	describe("getAppView", () => {
		it("answers null for an unknown provider", async () => {
			const { service } = setup({});
			expect(await run(service.getAppView("missing"))).toBeNull();
		});
	});

	describe("deleteApp", () => {
		it("deletes a provider the public edge does not run on", async () => {
			const { service, store } = setup();
			expect(await run(service.deleteApp("p1"))).toBe(true);
			expect(store.deleteById).toHaveBeenCalledWith("p1");
		});

		it("refuses with a conflict while the public edge runs on the account", async () => {
			const { service, store, edges } = setup();
			edges.accountsInUse.mockReturnValue(["p1"]);

			await expect(run(service.deleteApp("p1"))).rejects.toBeInstanceOf(FleetConflict);
			expect(store.deleteById).not.toHaveBeenCalled();
		});
	});

	describe("getLiveState", () => {
		beforeEach(() => {
			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(now);
		});
		afterEach(() => {
			vi.useRealTimers();
		});

		it("checks the SDK once and answers from the cache inside the 15 s window", async () => {
			const { service, store } = setup({ "p-ttl": row({ id: "p-ttl" }) });

			const first = await run(service.getLiveState("p-ttl"));
			vi.setSystemTime(now.getTime() + 14_000);
			const second = await run(service.getLiveState("p-ttl"));

			expect(first).toMatchObject({ status: "ok", accountId: "acc-1" });
			expect(second).toBe(first);
			expect(sdk.verify).toHaveBeenCalledTimes(1);
			// The state is also persisted as a display cache.
			expect(store.updateById).toHaveBeenCalledWith("p-ttl", { state: first });
		});

		it("checks again once the window has passed", async () => {
			const { service } = setup({ "p-exp": row({ id: "p-exp" }) });

			await run(service.getLiveState("p-exp"));
			vi.setSystemTime(now.getTime() + 15_001);
			await run(service.getLiveState("p-exp"));

			expect(sdk.verify).toHaveBeenCalledTimes(2);
		});

		it("skips the cache with `force`", async () => {
			const { service } = setup({ "p-force": row({ id: "p-force" }) });

			await run(service.getLiveState("p-force"));
			await run(service.getLiveState("p-force", true));

			expect(sdk.verify).toHaveBeenCalledTimes(2);
		});

		it("reports an error state, never a failure, when the provider cannot be used", async () => {
			const { service } = setup({});
			const state = await run(service.getLiveState("p-gone"));
			expect(state).toMatchObject({ status: "error", tokenValid: false, accountId: null });
			expect(sdk.verify).not.toHaveBeenCalled();
		});

		it("reports an inactive token as an error state", async () => {
			sdk.verify.mockResolvedValue({ status: "expired" });
			const { service } = setup({ "p-tok": row({ id: "p-tok" }) });

			const state = await run(service.getLiveState("p-tok"));

			expect(state).toMatchObject({ status: "error", tokenValid: false, error: 'Token status is "expired"' });
		});
	});
});
