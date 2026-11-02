import { Context, Effect } from "effect";

import { primaryLanAddress } from "@deployer/node-agent-container";

import { AgentStore, type AgentStoreError } from "../../local/agent-store";
import { OVERLAY_SELF_SECRET, parseOverlaySelf } from "../overlay";

import { DoorConverger } from "./door-converger";
import { DoorImage, parseNodeDoorsSetting } from "./doors.setting";
import { NODE_DOORS_SETTING_KEY, type AgentDoorView, type NodeDoorsSetting } from "./doors.types";

import type { DockerEngine } from "./docker-engine";

/**
 * Where a door may bind: the overlay address this node published, and the one LAN address a joiner-facing door can use.
 * Read per pass, not at boot: the overlay exists only after a WireGuard pass, and a LAN interface can appear later.
 */
export class DoorAddresses extends Context.Service<
	DoorAddresses,
	{ readonly current: () => Effect.Effect<{ readonly meshAddress: string | null; readonly lanAddress: string | null }, AgentStoreError, AgentStore> }
>()("node-agent/DoorAddresses") {
	static readonly live = class DoorAddressesImpl {
		current = () =>
			Effect.gen(function* () {
				const store = yield* AgentStore;
				const overlay = parseOverlaySelf(
					yield* store.secret(OVERLAY_SELF_SECRET).pipe(Effect.catch(() => Effect.succeed(undefined))),
				);
				return { meshAddress: overlay?.meshAddress ?? null, lanAddress: primaryLanAddress() };
			})
	};
}

export type DoorsTickShape = {
	/** One pass: read `node.doors`, validate it, converge. No setting is the normal first state, not a fault. */
	readonly convergeOnce: () => Effect.Effect<
		readonly AgentDoorView[],
		AgentStoreError,
		AgentStore | DoorConverger | DoorAddresses | DoorImage | DockerEngine
	>;
};

/** Images already reported, so one refused setting is logged once and not on every five-second pass. */
const refusedImages = new Set<string>();

/**
 * One door pass per tick, driven by the roster setting the API publishes.
 *
 * A malformed setting is reported once per tick and the node is left exactly as it is: a half-valid plan applied to the
 * host would take the ingress down, which is worse than converging nothing. A setting that asks for an image other than
 * the deployment's is refused the same way: the image is the deployment's decision, and a setting that names one is a
 * setting trying to run code of its own choosing.
 */
export class DoorsTick extends Context.Service<DoorsTick, DoorsTickShape>()("node-agent/DoorsTick") {
	static readonly live = class DoorsTickImpl implements DoorsTickShape {
		convergeOnce = () =>
			Effect.gen(function* () {
				const store = yield* AgentStore;
				const converger = yield* DoorConverger;
				const pinned = yield* DoorImage;

				const { setting, error } = parseNodeDoorsSetting(yield* store.setting(NODE_DOORS_SETTING_KEY));
				if (error !== null) {
					console.warn(`[node-agent] ignoring malformed ${NODE_DOORS_SETTING_KEY}: ${error}`);
				}
				if (setting === null) return [];

				if (setting.image !== pinned.image) {
					if (!refusedImages.has(setting.image)) {
						refusedImages.add(setting.image);
						console.warn(
							`[node-agent] refusing ${NODE_DOORS_SETTING_KEY}: image ${setting.image} is not the configured door image (${pinned.image})`,
						);
					}
					return [];
				}

				const addresses = yield* DoorAddresses;
				const { meshAddress, lanAddress } = yield* addresses.current();

				return yield* converger.converge(setting satisfies NodeDoorsSetting, meshAddress, lanAddress);
			})
	};
}
