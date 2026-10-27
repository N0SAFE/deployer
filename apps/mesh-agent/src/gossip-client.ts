/**
 * Push this member's roster to a peer and get the peer's merged roster back.
 *
 * Plain HTTP over the mesh: the request only travels inside WireGuard, which
 * already authenticates the source address as a member, and every record in the
 * body is signed. TLS would add nothing but a certificate authority — a source of
 * truth the design exists to avoid.
 */

import { AGENT_ROUTES, gossipMessageSchema, type RosterState } from "@deployer/mesh-network";

export type GossipClient = (address: string, port: number, roster: RosterState) => Promise<RosterState | null>;

export const httpGossipClient: GossipClient = async (address, port, roster) => {
	try {
		const response = await fetch(`http://${address}:${String(port)}${AGENT_ROUTES.gossip}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ roster }),
			signal: AbortSignal.timeout(4_000),
		});
		if (!response.ok) return null;
		return gossipMessageSchema.parse(await response.json()).roster;
	} catch {
		// An unreachable peer is the normal case during link setup, not an error.
		return null;
	}
};
