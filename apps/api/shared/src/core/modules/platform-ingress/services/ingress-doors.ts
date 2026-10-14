/**
 * The node doors plan — what every node's mesh agent converges in front of Traefik.
 *
 * Pure: the lanes decide WHICH doors exist (local always, private when the lane is
 * on); this function only fills in the names the platform uses. The API publishes
 * the result as the replicated `node.doors` setting, so each node converges its own
 * doors from its own roster copy — no API call reaches another node.
 */

import type { IngressLanes } from "@repo/contracts-entities/entities/ingress/index";
import type { DoorRescueRoute, NodeDoorsSetting } from "@repo/mesh-network";

import { LANE_ENTRYPOINTS } from "./lane-traefik-config";

export interface NodeDoorsInput {
	lanes: IngressLanes;
	/** `deployer` or `deployer-<prefix>`: doors are `<namePrefix>-door-<lane>`. */
	namePrefix: string;
	/** Platform overlay the doors attach to. */
	network: string;
	image: string;
	/** Traefik's service name on the overlay. */
	traefikService: string;
	/** Platform hosts the LOCAL door serves directly when Traefik does not answer. */
	rescue: readonly DoorRescueRoute[];
}

export function buildNodeDoors(input: NodeDoorsInput): NodeDoorsSetting {
	return {
		image: input.image,
		network: input.network,
		namePrefix: input.namePrefix,
		entryPort: input.lanes.entryPort,
		upstream: input.traefikService,
		lanes: {
			local: { upstreamPort: LANE_ENTRYPOINTS.local.port },
			private: input.lanes.private.enabled ? { upstreamPort: LANE_ENTRYPOINTS.private.port } : null,
			// The LAN door serves Traefik's PRIVATE entrypoint: same routers, same
			// hostnames, reached on a different address. It is the only door a node
			// can use before it is a member, so it is keyed off `exposeOnLan` rather
			// than the private lane alone.
			lan: input.lanes.private.enabled && input.lanes.private.exposeOnLan ? { upstreamPort: LANE_ENTRYPOINTS.private.port } : null,
		},
		rescue: [...input.rescue],
	};
}
