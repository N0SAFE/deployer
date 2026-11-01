import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentStore, type AgentStoreShape } from "../../local/agent-store";

import { DoorConverger, type DoorConvergerShape } from "./door-converger";
import { DoorAddresses, DoorsTick } from "./doors-tick.service";
import { DoorImage } from "./doors.setting";
import type { NodeDoorsSetting } from "./doors.types";

const SETTING: NodeDoorsSetting = {
	image: "nginx:alpine",
	network: "deployer-platform",
	namePrefix: "deployer",
	entryPort: 80,
	upstream: "traefik",
	lanes: { local: { upstreamPort: 3000 }, private: null, lan: null },
	rescue: [],
};

const addresses = { meshAddress: "10.9.0.1", lanAddress: "192.168.1.5" };

function run(
	raw: string | undefined,
	converge = vi.fn(() => Effect.succeed<readonly never[]>([])),
	image = "nginx:alpine",
) {
	const store = { setting: () => Effect.succeed(raw) } as unknown as AgentStoreShape;
	const converger = { converge } as unknown as DoorConvergerShape;

	return {
		converge,
		result: Effect.runPromise(
			Effect.gen(function* () {
				const tick = yield* DoorsTick;
				return yield* tick.convergeOnce();
			}).pipe(
				Effect.provideService(DoorsTick, DoorsTick.live),
				Effect.provideService(AgentStore, store),
				Effect.provideService(DoorConverger, converger),
				Effect.provideService(DoorAddresses, { current: () => Effect.succeed(addresses) }),
				Effect.provideService(DoorImage, { image }),
			) as Effect.Effect<readonly unknown[]>,
		),
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("DoorsTick", () => {
	it("converges the parsed setting onto the node's addresses", async () => {
		const { result, converge } = run(JSON.stringify(SETTING));

		await result;

		expect(converge).toHaveBeenCalledWith(SETTING, addresses.meshAddress, addresses.lanAddress);
	});

	it("does nothing while the API has published no setting", async () => {
		const { result, converge } = run(undefined);

		await expect(result).resolves.toEqual([]);
		expect(converge).not.toHaveBeenCalled();
	});

	it("refuses a setting that names another image, and converges nothing", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const { result, converge } = run(JSON.stringify({ ...SETTING, image: "attacker/nginx:latest" }));

		await expect(result).resolves.toEqual([]);
		expect(converge).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("attacker/nginx:latest"));
	});

	it("converges a setting that names the configured image", async () => {
		const { result, converge } = run(JSON.stringify({ ...SETTING, image: "nginx:1.27-alpine" }), undefined, "nginx:1.27-alpine");

		await result;

		expect(converge).toHaveBeenCalledWith(
			{ ...SETTING, image: "nginx:1.27-alpine" },
			addresses.meshAddress,
			addresses.lanAddress,
		);
	});

	it("ignores a malformed setting and says why", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const { result, converge } = run('{"entryPort":0}');

		await expect(result).resolves.toEqual([]);
		expect(converge).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("node.doors"));
	});
});

describe("DoorAddresses.live", () => {
	it("binds the private door to the overlay address this node published", async () => {
		const store = {
			secret: (name: string) =>
				Effect.succeed(
					name === "overlay.self"
						? JSON.stringify({ wireguardKey: "k", meshAddress: "10.88.4.5", endpoint: "node:51820", listenPort: 51820 })
						: undefined,
				),
		} as unknown as AgentStoreShape;

		const addresses = await Effect.runPromise(
			Effect.flatMap(DoorAddresses, (door) => door.current()).pipe(
				Effect.provideService(DoorAddresses, DoorAddresses.live),
				Effect.provideService(AgentStore, store),
			),
		);

		expect(addresses.meshAddress).toBe("10.88.4.5");
		expect(typeof addresses.lanAddress === "string" || addresses.lanAddress === null).toBe(true);
	});

	it("has no private address until a WireGuard pass published one", async () => {
		const store = { secret: () => Effect.succeed(undefined) } as unknown as AgentStoreShape;

		const addresses = await Effect.runPromise(
			Effect.flatMap(DoorAddresses, (door) => door.current()).pipe(
				Effect.provideService(DoorAddresses, DoorAddresses.live),
				Effect.provideService(AgentStore, store),
			),
		);

		expect(addresses.meshAddress).toBeNull();
	});
});
