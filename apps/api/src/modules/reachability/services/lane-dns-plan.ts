/**
 * Lane DNS plan — which records make each lane's hostnames resolve.
 *
 * DNS is a separate plane from ingress: ingress decides how a packet reaches
 * Traefik, DNS decides where a NAME points. Keeping the two apart is what lets an
 * edge be provisioned without touching DNS, and lets a lane switch be a record
 * swap rather than a re-provision.
 *
 *   public    *.<domain>   whatever the EDGE PROVIDER asks for (`EdgeProvider.dnsRecords`):
 *                          a CNAME to a tunnel, A records to the nodes' public IPs, …
 *   private   *.<domain>   A → every node's MESH address
 *   local     (none — every *.localhost name resolves to loopback, RFC 6761)
 *
 * A private domain under a reserved non-public suffix (`.internal`, `.localhost`,
 * …) is never planned: no public provider can serve it, and the operator resolves
 * it on the mesh instead.
 */

import type { IngressLanes } from "@repo/contracts-entities/entities/ingress/index";

import type { EdgeDnsRecord } from "@/core/modules/edge/edge-provider";

export interface LaneDnsRecordPlan extends EdgeDnsRecord {
	lane: "public" | "private";
}

/** Suffixes no public DNS provider can serve. */
const NON_PUBLIC_SUFFIXES = [".internal", ".localhost", ".local", ".home.arpa", ".lan"];

export function isPubliclyResolvable(domain: string): boolean {
	const lower = `.${domain.toLowerCase()}`;
	return !NON_PUBLIC_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/**
 * Every record the lanes need: the public edge's own records plus the private
 * lane's, each tagged with its lane.
 */
export function planLaneDnsRecords(
	lanes: IngressLanes,
	inputs: { publicEdgeRecords: readonly EdgeDnsRecord[]; meshAddresses: readonly string[] },
): LaneDnsRecordPlan[] {
	const plans: LaneDnsRecordPlan[] = inputs.publicEdgeRecords.map((record) => ({ ...record, lane: "public" }));
	if (lanes.private.enabled && isPubliclyResolvable(lanes.private.domain) && inputs.meshAddresses.length > 0) {
		plans.push({
			lane: "private",
			name: `*.${lanes.private.domain}`,
			type: "A",
			contents: [...new Set(inputs.meshAddresses)].sort(),
			proxied: false,
			preferredAccountId: null,
		});
	}
	return plans;
}
