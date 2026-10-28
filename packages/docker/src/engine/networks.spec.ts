import { Cause, Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";

import { makeNetworks } from "./networks";
import type { SwarmServicesShape } from "./swarm-services";

async function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
	const exit = await Effect.runPromiseExit(effect);
	if (Exit.isSuccess(exit)) return exit.value;
	throw Cause.squash(exit.cause);
}

describe("DockerNetworks.recreateOverlay (poisoned VXLAN repair)", () => {
	const VNI = "com.docker.network.driver.overlay.vxlanid_list";
	const request = {
		name: "deployer-platform-overlay",
		driver: "overlay",
		attachable: true,
		ingress: false,
		enableIpv6: false,
		labels: {},
	} as never;

	function build() {
		const calls: string[] = [];
		let exists = true;
		const network = {
			inspect: vi.fn(() => {
				if (!exists) return Promise.reject(Object.assign(new Error("not found"), { statusCode: 404 }));
				return Promise.resolve({ Id: "net-id", Driver: "overlay", Options: { [VNI]: "4097" } });
			}),
			disconnect: vi.fn(() => {
				calls.push("disconnect");
				return Promise.resolve();
			}),
			remove: vi.fn(() => {
				calls.push("remove");
				exists = false;
				return Promise.resolve();
			}),
		};
		const createNetwork = vi.fn(() => {
			calls.push("create");
			exists = true;
			return Promise.resolve({});
		});
		const client = {
			getNetwork: () => network,
			createNetwork,
			listNetworks: vi.fn(() => Promise.resolve([{ Options: { [VNI]: "4096" } }, { Options: { [VNI]: "4099" } }])),
		};
		const services = {
			list: () =>
				Effect.succeed([
					{ Spec: { Name: "svc-bff", TaskTemplate: { Networks: [{ Target: "net-id" }] } } },
					{ Spec: { Name: "unrelated", TaskTemplate: { Networks: [{ Target: "other" }] } } },
				]),
			remove: (name: string) =>
				Effect.sync(() => {
					calls.push(`rm:${name}`);
				}),
		} as unknown as SwarmServicesShape;
		return { networks: makeNetworks(client as never, services), createNetwork, calls };
	}

	it("removes attached services, drops the network and recreates it on an unused, different VNI", async () => {
		const { networks, createNetwork, calls } = build();

		const result = await run(networks.recreateOverlay(request, { detachContainerIds: ["me"] }));

		expect(result.removedServices).toEqual(["svc-bff"]);
		expect(calls).toEqual(["rm:svc-bff", "disconnect", "remove", "create"]);
		// 4097 is poisoned, 4096 and 4099 are taken by other networks → 4098.
		expect(result.vxlanId).toBe(4098);
		expect(createNetwork).toHaveBeenCalledWith(expect.objectContaining({ Options: { [VNI]: "4098" } }));
	});

	it("never reuses a VNI the caller already saw poisoned", async () => {
		const { networks } = build();

		const result = await run(networks.recreateOverlay(request, { avoidVxlanIds: [4098] }));

		expect(result.vxlanId).toBe(4100);
		expect(result.avoidedVxlanIds).toEqual(expect.arrayContaining([4097, 4098]));
	});
});
