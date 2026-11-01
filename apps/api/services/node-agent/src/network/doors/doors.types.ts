/**
 * Node doors — the address-scoped listeners in front of Traefik, one set per node.
 *
 * Copied from the old mesh network package with the doors themselves (`docs/architecture/node-agent-service.md`, migration
 * step 1: the package folds into the service), so the service owns its types and imports nothing from it.
 *
 * Swarm's port spec has no host-IP field, so a swarm publish always binds 0.0.0.0. A listener on loopback only (the
 * `local` lane), on the mesh address only (the `private` lane) or on one LAN address (the `lan` lane) therefore has to
 * be a plain container with `HostConfig.PortBindings[].HostIp` — and something on EVERY node must create it. The mesh
 * agent is that something; this setting is what it converges from.
 *
 * The API writes it (it knows the lanes, the prefix and the Traefik entrypoints); every agent reads it from its own
 * roster copy, so a node converges its doors even when the API runs elsewhere — or nowhere.
 */

/** Roster setting key holding the doors plan. */
export const NODE_DOORS_SETTING_KEY = "node.doors";

/** The local lane binds loopback only: reachable from this machine and nowhere else. */
export const LOOPBACK_DOOR_ADDRESS = "127.0.0.1";

/** Label marking a container as a door this agent owns. */
export const DOOR_LABEL = "deployer.mesh.door";
/** Label carrying the hash of everything the door was built from. */
export const DOOR_HASH_LABEL = "deployer.mesh.door.hash";

export type DoorLane = "local" | "private" | "lan";

/** A hostname the local door answers DIRECTLY when Traefik does not. */
export type DoorRescueRoute = {
	readonly host: string;
	/** Container/service name on `network`. */
	readonly target: string;
	readonly port: number;
};

export type NodeDoorsSetting = {
	/** Proxy image (nginx). */
	readonly image: string;
	/** Attachable overlay the doors join to reach Traefik by name. */
	readonly network: string;
	/** Container name prefix: doors are `<namePrefix>-door-<lane>`. */
	readonly namePrefix: string;
	/** Host port every door binds (the platform entry port, default 80). */
	readonly entryPort: number;
	/** Traefik's service name on `network`. */
	readonly upstream: string;
	readonly lanes: {
		readonly local: { readonly upstreamPort: number };
		/** Null = the private lane is disabled; the door is removed. */
		readonly private: { readonly upstreamPort: number } | null;
		/**
		 * Null = the LAN door is off (the default).
		 *
		 * A separate lane from `private` because they bind DIFFERENT addresses for different audiences: `private` binds
		 * the mesh address (members only, and only once the node has one), `lan` binds the node's LAN address (any peer
		 * on the subnet, member or not — the only door a pre-membership joiner can use). One implies nothing about the
		 * other.
		 */
		readonly lan: { readonly upstreamPort: number } | null;
	};
	/**
	 * The rescue lane: when Traefik does not answer, the local door serves these hosts straight from their targets.
	 * Replaces the old failover proxy, which published :80/:3000/:3001 on every interface whenever Traefik degraded.
	 */
	readonly rescue: readonly DoorRescueRoute[];
};

/** What one node's agent reports about one of its doors. */
export type AgentDoorView = {
	readonly lane: DoorLane;
	readonly container: string;
	readonly bindAddress: string;
	readonly port: number;
	readonly state: "running" | "absent" | "failed";
	readonly detail: string | null;
};

/** Container name of a lane's door. */
export function doorContainerName(namePrefix: string, lane: DoorLane): string {
	return `${namePrefix}-door-${lane}`;
}
