/**
 * IngressEdgeService — what the Network pages read and change: the lanes, the
 * public edge, the DNS records they need, and the mesh they ride on.
 *
 * Orchestration only — every decision has an owner elsewhere:
 *
 *   the lanes                   IngressLanesService     (replicated cluster setting)
 *   which edge, its rules       EdgeProviderRegistry    (validation, inbound-port consent)
 *   the edge itself             the EdgeProvider        (provision / teardown / status)
 *   the DNS records             EdgeDnsService          (separate plane from ingress)
 *   the ingress processes       TraefikConfigRefresher  (re-converge now, not next sweep)
 *   the mesh view               MeshAgentClient
 *
 * ── SWITCHING THE PUBLIC EDGE ───────────────────────────────────────────────
 * New edge first, lanes second, old edge last:
 *
 *   1. provision the new edge — if it cannot exist, nothing changes;
 *   2. write the lanes — Traefik, the connector and DNS follow them;
 *   3. tear the previous edge down (best effort — the lane no longer names it, so
 *      it carries nothing even if its provider is unreachable right now).
 *
 * Turning the public lane OFF always succeeds for the same reason: the lane is the
 * switch, the teardown is cleanup.
 */

import { BadRequestException, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import type { IngressState, UpdateIngressInput } from "@deployer/fleet-contracts/modules/reachability/contracts";
import {
	ingressExposure,
	ingressLanesSchema,
	joinEntryPoints,
	type IngressLanes,
	type PublicLane,
} from "@deployer/contracts-entities/entities/ingress/index";

import { EdgeProviderRegistry } from "@deployer/shared/core/modules/edge/edge-provider.registry";
import { MeshAgentClient } from "@deployer/shared/core/modules/mesh-agent/mesh-agent.client";
import { HostnameService } from "@deployer/shared/core/modules/platform-ingress/services/hostname.service";
import { IngressLanesService } from "@deployer/shared/core/modules/platform-ingress/services/ingress-lanes.service";
import { PublicEdgeService } from "@deployer/shared/core/modules/reachability/services/public-edge.service";
import { TraefikConfigRefresher } from "@deployer/shared/core/modules/traefik/services/traefik-config-refresher.service";

import { EdgeDnsService } from "./edge-dns.service";
import { planLaneDnsRecords } from "./lane-dns-plan";

/** Converge DNS on this cadence too: mesh addresses and public addresses change. */
const DNS_RECONCILE_INTERVAL_MS = 10 * 60_000;

type MeshView = IngressState["mesh"];

/** A record name the public edge owned before a change, and the account it lived on. */
type RetiredDnsName = {
	name: string;
	accountId: string | null;
}

@Injectable()
export class IngressEdgeService implements OnApplicationBootstrap, OnModuleDestroy {
	private readonly logger = new Logger(IngressEdgeService.name);
	private dnsTimer: ReturnType<typeof setInterval> | null = null;

	constructor(
		private readonly lanes: IngressLanesService,
		private readonly edges: EdgeProviderRegistry,
		private readonly publicEdge: PublicEdgeService,
		private readonly dns: EdgeDnsService,
		private readonly mesh: MeshAgentClient,
		private readonly hostnames: HostnameService,
		private readonly refresher: TraefikConfigRefresher,
	) {}

	onApplicationBootstrap(): void {
		this.dnsTimer = setInterval(() => {
			void this.reconcileDns();
		}, DNS_RECONCILE_INTERVAL_MS);
	}

	onModuleDestroy(): void {
		if (this.dnsTimer !== null) clearInterval(this.dnsTimer);
	}

	async getState(): Promise<IngressState> {
		const lanes = await this.lanes.getLanes();
		const [mesh, edge, publicPath] = await Promise.all([this.meshView(), this.publicEdge.view(lanes), this.publicEdge.joinPath(lanes)]);
		return {
			lanes,
			exposure: ingressExposure(lanes, edge?.provider ?? null),
			domains: {
				local: this.hostnames.localDomain(),
				private: lanes.private.enabled ? lanes.private.domain : null,
				public: lanes.public?.domain ?? null,
			},
			consoleUrls: this.consoleUrls(lanes),
			edge: { providers: this.edges.descriptors(), active: edge },
			dns: this.dns.results(),
			mesh,
			// Counts NODE members only: an operator laptop is a member but serves no entry.
			entryPoints: joinEntryPoints({
				lanes,
				memberCount: mesh.members.filter((member) => member.kind === "node" && member.state === "active").length,
				publicPath,
			}),
		};
	}

	/** Apply a partial lanes change; only the fields sent change. */
	async update(input: UpdateIngressInput): Promise<IngressState> {
		const current = await this.lanes.getLanes();
		const next: IngressLanes = {
			entryPort: input.entryPort ?? current.entryPort,
			private:
				input.private === undefined
					? current.private
					: {
							enabled: input.private.enabled,
							domain: input.private.domain ?? current.private.domain,
							exposeOnLan: input.private.exposeOnLan ?? current.private.exposeOnLan,
						},
			public: input.public === undefined ? current.public : this.toPublicLane(input.public, current.public),
			consoleVisibility: input.consoleVisibility ?? current.consoleVisibility,
		};
		const parsed = ingressLanesSchema.safeParse(next);
		if (!parsed.success) throw new BadRequestException(`Invalid lanes: ${parsed.error.message}`);
		const lanes = parsed.data;

		const retired = await this.retiredNames(current);

		// 1. The new edge must exist before the lanes claim it.
		if (lanes.public !== null) {
			const resolved = await this.publicEdge.resolve(lanes);
			if (resolved === null) throw new BadRequestException(`Unknown edge provider '${lanes.public.provider}'`);
			await resolved.provider.provision(resolved.ctx);
		}
		// 2. The switch.
		await this.lanes.setLanes(lanes);
		// 3. The old edge carries nothing any more; clean it up.
		if (current.public !== null && current.public.provider !== lanes.public?.provider) {
			await this.teardownProvider(current.public.provider, false);
		}

		await this.reconcileDns(retired);
		this.refresher.refresh();
		return this.getState();
	}

	/** Delete everything the public edge created, then turn the public lane off. */
	async teardownPublicEdge(): Promise<IngressState> {
		const lanes = await this.lanes.getLanes();
		if (lanes.public === null) return this.getState();
		const retired = await this.retiredNames(lanes);
		// Explicit request: a provider failure is reported, not swallowed.
		await this.teardownProvider(lanes.public.provider, true);
		await this.lanes.setLanes({ ...lanes, public: null });
		await this.reconcileDns(retired);
		this.refresher.refresh();
		return this.getState();
	}

	/** Revoke a mesh member from this node's agent; every member drops it on the next gossip round. */
	async revokeMeshMember(memberId: string, reason: string): Promise<IngressState> {
		const status = await this.mesh.status();
		if (status.memberId === memberId) {
			throw new BadRequestException("A node cannot revoke itself. Revoke it from another member's console.");
		}
		if (!status.members.some((member) => member.memberId === memberId)) {
			throw new BadRequestException(`No mesh member ${memberId}`);
		}
		await this.mesh.revoke(memberId, reason);
		this.logger.log(`Revoked mesh member ${memberId}: ${reason}`);
		return this.getState();
	}

	/**
	 * Converge the DNS records the lanes need. Never throws.
	 *
	 * `retired` are names a previous edge owned; any that the new plan no longer
	 * covers are removed, so a domain or provider change does not leave a record
	 * pointing at an edge that is gone.
	 */
	async reconcileDns(retired: readonly RetiredDnsName[] = []): Promise<void> {
		try {
			const lanes = await this.lanes.getLanes();
			const status = await this.mesh.status().catch(() => null);
			const meshAddresses = (status?.members ?? []).filter((m) => m.kind === "node" && m.state === "active").map((m) => m.address);
			const publicEdgeRecords = await this.publicEdge.dnsRecords(lanes);
			const plans = planLaneDnsRecords(lanes, { publicEdgeRecords, meshAddresses });
			const planned = new Set(plans.map((plan) => plan.name.toLowerCase()));
			for (const old of retired) {
				if (!planned.has(old.name.toLowerCase())) await this.dns.removeRecords(old.name, old.accountId);
			}
			await this.dns.reconcile(plans);
		} catch (error) {
			this.logger.warn(`DNS reconcile skipped: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/** The names the current public edge owns — candidates for removal after a change. */
	private async retiredNames(lanes: IngressLanes): Promise<RetiredDnsName[]> {
		try {
			return (await this.publicEdge.dnsRecords(lanes)).map((record) => ({ name: record.name, accountId: record.preferredAccountId }));
		} catch {
			return [];
		}
	}

	private async teardownProvider(providerId: string, strict: boolean): Promise<void> {
		const provider = this.edges.find(providerId);
		if (provider === null) return;
		try {
			await provider.teardown();
		} catch (error) {
			if (strict) throw error;
			this.logger.warn(
				`${provider.descriptor.label} not torn down (it no longer carries the public lane): ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * The requested public lane, validated against its provider. Options sent for the
	 * SAME provider replace the current ones; omitted options keep them, so toggling
	 * the domain does not require re-sending the account.
	 */
	private toPublicLane(input: NonNullable<UpdateIngressInput["public"]> | null, current: PublicLane | null): PublicLane | null {
		if (input === null) return null;
		const sameProvider = current?.provider === input.provider;
		return this.edges.normalize({
			provider: input.provider,
			domain: input.domain,
			acknowledgedInboundPorts: input.acknowledgedInboundPorts ?? (sameProvider ? current.acknowledgedInboundPorts : false),
			options: input.options ?? (sameProvider ? current.options : {}),
		});
	}

	private consoleUrls(lanes: IngressLanes): IngressState["consoleUrls"] {
		const port = lanes.entryPort === 80 ? "" : `:${String(lanes.entryPort)}`;
		const publicLane = lanes.public;
		const scheme = this.edges.ingressPlan(lanes).tls === "none" ? "http" : "https";
		return {
			local: `${this.hostnames.webOrigin()}${port}`,
			private: lanes.private.enabled ? `http://web.${lanes.private.domain}${port}` : null,
			public: publicLane !== null && lanes.consoleVisibility === "public" ? `${scheme}://web.${publicLane.domain}` : null,
		};
	}

	private async meshView(): Promise<MeshView> {
		try {
			const status = await this.mesh.status();
			return {
				available: true,
				clusterId: status.cluster?.clusterId ?? null,
				cidr: status.cluster?.cidr ?? null,
				address: status.cluster?.address ?? null,
				listenPort: status.cluster?.listenPort ?? null,
				interfaceUp: status.cluster?.interfaceUp ?? false,
				members: status.members.map((member) => ({
					memberId: member.memberId,
					name: member.name,
					kind: member.kind,
					address: member.address,
					state: member.state,
					self: member.memberId === status.memberId,
					labels: member.labels,
					endpoints: member.endpoints.map((endpoint) => ({ kind: endpoint.kind, address: `${endpoint.host}:${String(endpoint.port)}` })),
					link: member.link,
				})),
				doors: status.doors,
				lastGossipAt: status.lastGossipAt,
				lastError: status.lastError,
			};
		} catch (error) {
			return {
				available: false,
				clusterId: null,
				cidr: null,
				address: null,
				listenPort: null,
				interfaceUp: false,
				members: [],
				doors: [],
				lastGossipAt: null,
				lastError: error instanceof Error ? error.message : String(error),
			};
		}
	}
}
