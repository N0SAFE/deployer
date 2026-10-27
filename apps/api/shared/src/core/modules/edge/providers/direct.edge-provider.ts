/**
 * Direct — the public lane served by inbound ports on the nodes themselves.
 *
 * The one edge that opens ports: every node publishes :80 (and :443 with TLS)
 * straight to Traefik's public entrypoints, and the public domain resolves to the
 * nodes' declared public addresses. No third party is involved, which is its whole
 * appeal — and why it is opt-in behind an explicit acknowledgement.
 *
 * Built in (not a plugin module) because it needs nothing but the nodes: no
 * account, no connector, no state of its own. Its addresses are the operator's
 * per-node declarations (`node_network_config.publicAddress`).
 */

import { Injectable } from "@nestjs/common";
import type { EdgeProviderDescriptor, EdgeStatus, PublicJoinPath, PublicLane } from "@deployer/contracts-entities/entities/ingress/index";

import type { EdgeContext, EdgeDnsRecord, EdgeIngressPlan, EdgeProvider } from "../edge-provider";
import { EdgeProviderRegistry } from "../edge-provider.registry";

export const DIRECT_EDGE_ID = "direct";

const DESCRIPTOR: EdgeProviderDescriptor = {
	id: DIRECT_EDGE_ID,
	label: "Direct (inbound ports)",
	kind: "inbound",
	summary: "Clients connect straight to the nodes on :80/:443.",
	description:
		"Every node opens :80 (and :443 with TLS) to Traefik and the public domain resolves to the nodes' declared public addresses. No third party, but every node needs a public address and an open firewall — the only lane that opens inbound ports.",
	opensInboundPorts: true,
	usesProviderAccount: false,
	servesHttps: true,
	options: [
		{
			type: "boolean",
			key: "tls",
			label: "HTTPS with Let's Encrypt",
			description: "Obtain certificates on :443 (HTTP-01). Off serves plain HTTP on :80 only.",
			defaultValue: true,
		},
	],
};

function usesTls(lane: PublicLane): boolean {
	return lane.options.tls !== false;
}

/** The nodes' public IPs — what the A records point to and what a joiner dials. */
function publicIps(ctx: EdgeContext): string[] {
	return [
		...new Set(ctx.nodes.flatMap((node) => (node.addressKind === "ip" && node.publicAddress !== null ? [node.publicAddress] : []))),
	].sort();
}

@Injectable()
export class DirectEdgeProvider implements EdgeProvider {
	readonly descriptor = DESCRIPTOR;

	constructor(registry: EdgeProviderRegistry) {
		registry.register(this);
	}

	ingress(lane: PublicLane): EdgeIngressPlan {
		return usesTls(lane)
			? {
					publishedPorts: [
						{ published: 80, entrypoint: "public" },
						{ published: 443, entrypoint: "public-tls" },
					],
					tls: "acme",
				}
			: { publishedPorts: [{ published: 80, entrypoint: "public" }], tls: "none" };
	}

	/** Nothing to create: the nodes ARE the edge (the Traefik supervisor publishes `ingress()`'s ports). */
	provision(): Promise<void> {
		return Promise.resolve();
	}

	/** Nothing to remove: no provider-side resource, no state. */
	teardown(): Promise<void> {
		return Promise.resolve();
	}

	connector(): Promise<null> {
		return Promise.resolve(null);
	}

	dnsRecords(ctx: EdgeContext): Promise<EdgeDnsRecord[]> {
		const addresses = publicIps(ctx);
		if (addresses.length === 0) return Promise.resolve([]);
		return Promise.resolve([{ name: `*.${ctx.lane.domain}`, type: "A", contents: addresses, proxied: false, preferredAccountId: null }]);
	}

	status(ctx: EdgeContext): Promise<EdgeStatus> {
		const addresses = publicIps(ctx);
		const hostnames = ctx.nodes.filter((node) => node.addressKind === "hostname" && node.publicAddress !== null);
		return Promise.resolve({
			provisioned: addresses.length > 0,
			health: addresses.length > 0 ? "unknown" : "down",
			detail:
				addresses.length > 0
					? null
					: "No node has declared a public IP address. Declare one for each node that should serve the public lane (Network → Ingress & edge → node public addresses).",
			facts: [
				{ label: "Public addresses", value: addresses.length > 0 ? addresses.join(", ") : "none" },
				...(hostnames.length > 0 ? [{ label: "Hostnames (not used for DNS)", value: hostnames.map((node) => node.publicAddress).join(", ") }] : []),
				{ label: "Inbound ports", value: usesTls(ctx.lane) ? ":80, :443 on every node" : ":80 on every node" },
				{ label: "Certificates", value: usesTls(ctx.lane) ? "Let's Encrypt (HTTP-01)" : "none — plain HTTP" },
			],
			resources: [],
		});
	}

	joinPath(ctx: EdgeContext, status: EdgeStatus): PublicJoinPath {
		const addresses = publicIps(ctx);
		return {
			via: DESCRIPTOR.label,
			available: status.provisioned,
			target: `${usesTls(ctx.lane) ? "https" : "http"}://api.${ctx.lane.domain}`,
			hostHeader: null,
			sources: addresses.length,
			detail: status.provisioned
				? `A node anywhere dials api.${ctx.lane.domain}, which resolves to ${String(addresses.length)} declared address${addresses.length === 1 ? "" : "es"}. Requires the inbound ports open on those nodes.`
				: (status.detail ?? "No public address is declared."),
		};
	}
}
