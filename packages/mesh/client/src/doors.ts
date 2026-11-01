/**
 * Node doors — the address-scoped listeners in front of Traefik, one set per node.
 *
 * Swarm's port spec has no host-IP field, so a swarm publish always binds 0.0.0.0.
 * A listener on loopback only (the `local` lane), on the mesh address only (the
 * `private` lane) or on one LAN address (the `lan` lane) therefore has to be a plain
 * container with `HostConfig.PortBindings[].HostIp` — and something on EVERY node
 * must create it. The mesh agent is that something; this setting is what it
 * converges from.
 *
 * The API writes it (it knows the lanes, the prefix and the Traefik entrypoints);
 * every agent reads it from its own roster copy, so a node converges its doors even
 * when the API runs elsewhere — or nowhere.
 */

import z from "zod/v4";

/** Roster setting key holding the doors plan. */
export const NODE_DOORS_SETTING_KEY = "node.doors";

const portSchema = z.number().int().min(1).max(65_535);
const dnsNameSchema = z.string().min(1).max(253).regex(/^[A-Za-z0-9.-]+$/, "must be a DNS name");

export const doorLaneSchema = z.enum(["local", "private", "lan"]);
export type DoorLane = z.output<typeof doorLaneSchema>;

/** A hostname the local door answers DIRECTLY when Traefik does not. */
export const doorRescueRouteSchema = z.object({
	host: dnsNameSchema,
	/** Container/service name on `network`. */
	target: dnsNameSchema,
	port: portSchema,
});
export type DoorRescueRoute = z.output<typeof doorRescueRouteSchema>;

export const nodeDoorsSettingSchema = z.object({
	/** Proxy image (nginx). */
	image: z.string().min(1).max(256),
	/** Attachable overlay the doors join to reach Traefik by name. */
	network: dnsNameSchema,
	/** Container name prefix: doors are `<namePrefix>-door-<lane>`. */
	namePrefix: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/),
	/** Host port every door binds (the platform entry port, default 80). */
	entryPort: portSchema,
	/** Traefik's service name on `network`. */
	upstream: dnsNameSchema,
	lanes: z.object({
		local: z.object({ upstreamPort: portSchema }),
		/** Null = the private lane is disabled; the door is removed. */
		private: z.object({ upstreamPort: portSchema }).nullable(),
		/**
		 * Null = the LAN door is off (the default).
		 *
		 * A separate lane from `private` because they bind DIFFERENT addresses for
		 * different audiences: `private` binds the mesh address (members only, and
		 * only once the node has one), `lan` binds the node's LAN address (any peer
		 * on the subnet, member or not — the only door a pre-membership joiner can
		 * use). One implies nothing about the other.
		 */
		lan: z.object({ upstreamPort: portSchema }).nullable(),
	}),
	/**
	 * The rescue lane: when Traefik does not answer, the local door serves these
	 * hosts straight from their targets. Replaces the old failover proxy, which
	 * published :80/:3000/:3001 on every interface whenever Traefik degraded.
	 */
	rescue: z.array(doorRescueRouteSchema).max(16),
});
export type NodeDoorsSetting = z.output<typeof nodeDoorsSettingSchema>;

/** Container name of a lane's door. */
export function doorContainerName(namePrefix: string, lane: DoorLane): string {
	return `${namePrefix}-door-${lane}`;
}
