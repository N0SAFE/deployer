/**
 * Row → view mapping for `node_network_config`, shared by every reader (the
 * reachability API and the public edge), so "what kind of address is this" has
 * one answer.
 */

import { isIP } from "node:net";

/** Full per-node network config persisted in the global `node_network_config`. */
export type NodeNetworkConfigData = {
	nodeId: string;
	publicAddress: string | null;
	addressKind: "ip" | "hostname" | null;
	updatedAt: string;
}

/** `ip` for a bare IP (with or without scheme/port), `hostname` for anything else. */
export function deriveAddressKind(value: string | null): "ip" | "hostname" | null {
	const clean = value?.trim();
	if (!clean) return null;
	const host = clean.replace(/^https?:\/\//i, "").split("/")[0]?.split(":")[0] ?? "";
	return isIP(host) !== 0 ? "ip" : "hostname";
}

export function toNodeNetworkConfigData(
	nodeId: string,
	row: { publicAddress: string | null; updatedAt: Date } | null,
): NodeNetworkConfigData {
	const address = row?.publicAddress?.trim() ? row.publicAddress.trim() : null;
	return {
		nodeId,
		publicAddress: address,
		addressKind: deriveAddressKind(address),
		updatedAt: row?.updatedAt.toISOString() ?? new Date(0).toISOString(),
	};
}
