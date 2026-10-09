/**
 * Where can peers reach this member? Three sources, all discovered by the member
 * itself — nothing tells it.
 *
 *   lan        its own interface addresses (minus Docker's, the mesh's, loopback)
 *   reflexive  its NAT's public address, from a public STUN server
 *   declared   addresses the operator says are reachable (a `direct` node)
 *
 * Every candidate carries the WireGuard LISTEN port. For a reflexive address that
 * is an assumption — a port-preserving NAT keeps it, a symmetric NAT does not — and
 * the link planner treats it as one candidate among several, not a fact.
 */

import { createSocket } from "node:dgram";
import { randomBytes } from "node:crypto";
import type { NetworkInterfaceInfo } from "node:os";
import { decodeBindingResponse, encodeBindingRequest, STUN_TRANSACTION_ID_LENGTH, type EndpointCandidate } from "@repo/mesh-network";

/**
 * Interfaces that never carry a peer's traffic. Docker bridges and veths are
 * per-host and unreachable from elsewhere; the mesh interface would advertise the
 * mesh through itself.
 */
const IGNORED_INTERFACE = /^(lo|docker\d*|docker_gwbridge|br-|veth|virbr|vxlan|flannel|cni|cali|tun|tap|wg|deployer-mesh)/;

/** LAN candidates from `os.networkInterfaces()`. Pure, so it is tested without a host. */
export function lanCandidates(
	interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
	listenPort: number,
	meshInterface: string,
): EndpointCandidate[] {
	const out: EndpointCandidate[] = [];
	for (const [name, infos] of Object.entries(interfaces)) {
		if (name === meshInterface || IGNORED_INTERFACE.test(name)) continue;
		for (const info of infos ?? []) {
			if (info.family !== "IPv4" || info.internal || info.address.startsWith("169.254.")) continue;
			out.push({ kind: "lan", host: info.address, port: listenPort });
		}
	}
	return out.sort((a, b) => a.host.localeCompare(b.host));
}

/**
 * Ask one STUN server for this host's public IPv4 address.
 *
 * Resolves null on timeout or a malformed answer: reflexive discovery is
 * best-effort, and a LAN-only cluster never needs it.
 */
export function stunReflexiveAddress(server: string, timeoutMs = 3_000): Promise<string | null> {
	const separator = server.lastIndexOf(":");
	const host = separator > 0 ? server.slice(0, separator) : server;
	const port = separator > 0 ? Number(server.slice(separator + 1)) : 3478;
	const transactionId = randomBytes(STUN_TRANSACTION_ID_LENGTH);

	return new Promise((resolve) => {
		const socket = createSocket("udp4");
		const finish = (value: string | null) => {
			clearTimeout(timer);
			socket.close();
			resolve(value);
		};
		const timer = setTimeout(() => {
			finish(null);
		}, timeoutMs);
		socket.on("error", () => {
			finish(null);
		});
		socket.on("message", (message) => {
			const mapped = decodeBindingResponse(message, transactionId);
			if (mapped !== null) finish(mapped.address);
		});
		socket.send(encodeBindingRequest(transactionId), port, host, (error) => {
			if (error) finish(null);
		});
	});
}

/** First STUN server that answers wins; null when none does. */
export async function discoverReflexiveAddress(servers: readonly string[]): Promise<string | null> {
	for (const server of servers) {
		const address = await stunReflexiveAddress(server);
		if (address !== null) return address;
	}
	return null;
}
