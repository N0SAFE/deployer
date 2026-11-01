/**
 * WireGuard wire formats — moved from the old mesh network package with the driver (`docs/architecture/node-agent-service.md`,
 * migration step 1: the package's protocol folds into the service).
 *
 * `syncconf` (not `setconf`) is deliberate: it changes only what differs, so a peer whose plan did not change keeps its
 * live session instead of being torn down and re-handshaken every tick.
 */

/** Name of the mesh interface on every member. ≤ 15 chars (IFNAMSIZ). */
export const MESH_INTERFACE_NAME = "deployer-mesh";

/** Below Ethernet's 1500 by WireGuard's own overhead (80 bytes over IPv6). */
export const MESH_INTERFACE_MTU = 1420;

export type PlannedPeer = {
	readonly wireguardKey: string;
	readonly allowedIps: readonly string[];
	readonly endpoint: string | null;
	readonly persistentKeepaliveSeconds: number;
};

export type WireguardInterfaceConfig = {
	readonly privateKey: string;
	readonly listenPort: number;
	readonly peers: readonly PlannedPeer[];
};

export type WireguardPeerStatus = {
	readonly publicKey: string;
	readonly endpoint: string | null;
	readonly allowedIps: readonly string[];
	/** Epoch ms, or null when the peer never completed a handshake. */
	readonly latestHandshakeAt: number | null;
	readonly rxBytes: number;
	readonly txBytes: number;
};

export type WireguardDump = {
	readonly publicKey: string;
	readonly listenPort: number;
	readonly peers: Readonly<Record<string, WireguardPeerStatus>>;
};

/** Render the configuration `wg syncconf <iface> <file>` applies. */
export function renderWireguardConfig(config: WireguardInterfaceConfig): string {
	const lines = ["[Interface]", `PrivateKey = ${config.privateKey}`, `ListenPort = ${String(config.listenPort)}`];

	for (const peer of config.peers) {
		lines.push("", "[Peer]", `PublicKey = ${peer.wireguardKey}`, `AllowedIPs = ${peer.allowedIps.join(", ")}`);
		if (peer.endpoint !== null) lines.push(`Endpoint = ${peer.endpoint}`);
		lines.push(`PersistentKeepalive = ${String(peer.persistentKeepaliveSeconds)}`);
	}

	return `${lines.join("\n")}\n`;
}

/**
 * Parse `wg show <iface> dump`.
 *
 * Line 1 is the interface (private key, public key, listen port, fwmark); every other line is a peer (public key,
 * preshared key, endpoint, allowed ips, latest handshake in epoch SECONDS with 0 meaning never, rx, tx, keepalive).
 * Returns null for output that is not a dump — the agent then treats the interface as absent.
 */
export function parseWireguardDump(dump: string): WireguardDump | null {
	const lines = dump
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
	const header = lines[0]?.split("\t");
	if (header === undefined || header.length < 3) return null;

	const listenPort = Number(header[2]);
	if (!Number.isInteger(listenPort)) return null;

	const peers: Record<string, WireguardPeerStatus> = {};
	for (const line of lines.slice(1)) {
		const fields = line.split("\t");
		if (fields.length < 8) continue;

		const [publicKey = "", , endpoint = "", allowedIps = "", handshake = "0", rx = "0", tx = "0"] = fields;
		const handshakeSeconds = Number(handshake);
		peers[publicKey] = {
			publicKey,
			endpoint: endpoint === "(none)" || endpoint === "" ? null : endpoint,
			allowedIps: allowedIps === "(none)" ? [] : allowedIps.split(","),
			latestHandshakeAt: Number.isFinite(handshakeSeconds) && handshakeSeconds > 0 ? handshakeSeconds * 1000 : null,
			rxBytes: Number(rx) || 0,
			txBytes: Number(tx) || 0,
		};
	}

	return { publicKey: header[1] ?? "", listenPort, peers };
}
