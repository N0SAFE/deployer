/** The DI token the module's options are registered under. */
export const MESH_TRANSPORT_OPTIONS = Symbol("mesh:transport-options");

/** One router: `group -> key -> procedure`. */
export type MeshRouter = Record<string, Record<string, unknown>>;

export type MeshTransportOptions = {
	/** The contract every door is validated against. A group named `node` is the node door. */
	readonly contract: Record<string, unknown>;
	/**
	 * What the LOCAL SERVICE door serves, as `group.key` ids. Omitted, the service door is the full local router (the
	 * pre-split behaviour); set, it is exactly that list, so a service on the node cannot reach the admin procedures.
	 * The admin door always serves everything.
	 */
	readonly serviceProcedures?: readonly string[];
	/**
	 * Loop intervals. A host that has config supplies them from there instead; these are the defaults for a host that
	 * does not.
	 */
	readonly gossipIntervalMs?: number;
	readonly doorsIntervalMs?: number;
	readonly wireguardIntervalMs?: number;
	readonly evictionIntervalMs?: number;
};

/** Five seconds for the busy loops, thirty for link eviction: a peer that left must not hold a socket forever. */
export const MESH_INTERVAL_DEFAULTS = {
	gossipIntervalMs: 5_000,
	doorsIntervalMs: 5_000,
	wireguardIntervalMs: 5_000,
	evictionIntervalMs: 30_000,
} as const;
