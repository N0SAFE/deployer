/**
 * Cloudflare Tunnel — the public lane carried by connectors that dial OUT.
 *
 * ONE tunnel per stack, with a single wildcard rule `*.<domain> → Traefik public`:
 * onboarding an app never touches Cloudflare, because Traefik decides which
 * service a Host belongs to. High availability comes from connector REPLICAS
 * (Cloudflare balances up to 25 connectors on one tunnel), not from more tunnels —
 * so the Cloudflare side stays fixed as the fleet grows.
 *
 * No node opens a port and no node needs a public address: the connectors are
 * clients. Cloudflare terminates TLS.
 *
 * State (`edge.cloudflare-tunnel`): the tunnel id, the DNS account it lives on and
 * the connector token. The token replicates to every member (any node may run a
 * connector) and never reaches a client.
 */

import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import type {
	EdgeProviderDescriptor,
	EdgeStatus,
	PublicJoinPath,
	PublicLane,
} from "@deployer/contracts-entities/entities/ingress/index";
import z from "zod/v4";

import { EnvService } from "@deployer/shared/config/env/env.module";
import type {
	EdgeConnectorSpec,
	EdgeContext,
	EdgeDnsRecord,
	EdgeIngressPlan,
	EdgeProvider,
} from "@deployer/shared/core/modules/edge/edge-provider";
import { EdgeProviderRegistry } from "@deployer/shared/core/modules/edge/edge-provider.registry";
import { EdgeStateStore } from "@deployer/shared/core/modules/edge/edge-state.store";

import { CloudflareTunnelService } from "../../dns/cloudflare/services/cloudflare-tunnel.service";

export const CLOUDFLARE_TUNNEL_EDGE_ID = "cloudflare-tunnel";

/** The lane option naming the Cloudflare account (a DNS provider app) the tunnel lives on. */
const ACCOUNT_OPTION = "account";

const DESCRIPTOR: EdgeProviderDescriptor = {
	id: CLOUDFLARE_TUNNEL_EDGE_ID,
	label: "Cloudflare Tunnel",
	kind: "tunnel",
	summary: "Connectors dial out to Cloudflare — no inbound port, no public IP.",
	description:
		"One tunnel for the whole stack routes *.<domain> to Traefik. Connector replicas run on the cluster and dial out to Cloudflare, which terminates TLS. No node opens a port or needs a public address; requires a Cloudflare account with tunnel management enabled.",
	opensInboundPorts: false,
	usesProviderAccount: true,
	servesHttps: true,
	options: [
		{
			type: "dns-account",
			key: ACCOUNT_OPTION,
			label: "Cloudflare account",
			description: "The Cloudflare app the tunnel is created on. It needs tunnel management enabled.",
			required: true,
			providerType: "cloudflare",
			requiredFeature: "tunnelManagement",
		},
	],
};

const stateSchema = z.object({
	accountId: z.string(),
	tunnelId: z.string(),
	token: z.string(),
	/** `*.<domain>` the tunnel routes. */
	wildcard: z.string(),
});
type TunnelState = z.output<typeof stateSchema>;

function accountOf(lane: PublicLane): string {
	const value = lane.options[ACCOUNT_OPTION];
	if (typeof value !== "string" || value === "") throw new BadRequestException("Cloudflare Tunnel needs a Cloudflare account");
	return value;
}

@Injectable()
export class CloudflareTunnelEdgeProvider implements EdgeProvider {
	readonly descriptor = DESCRIPTOR;
	private readonly logger = new Logger(CloudflareTunnelEdgeProvider.name);

	constructor(
		registry: EdgeProviderRegistry,
		private readonly tunnels: CloudflareTunnelService,
		private readonly store: EdgeStateStore,
		private readonly env: EnvService,
	) {
		registry.register(this);
	}

	ingress(): EdgeIngressPlan {
		// Connectors reach Traefik over the overlay; Cloudflare serves HTTPS.
		return { publishedPorts: [], tls: "edge" };
	}

	private state(): Promise<TunnelState | null> {
		return this.store.read(CLOUDFLARE_TUNNEL_EDGE_ID, stateSchema);
	}

	/** The state, but only when it belongs to the account the lane names. */
	private async stateFor(lane: PublicLane): Promise<TunnelState | null> {
		const state = await this.state();
		return state !== null && state.accountId === accountOf(lane) ? state : null;
	}

	async provision(ctx: EdgeContext): Promise<void> {
		const accountId = accountOf(ctx.lane);
		const wildcard = `*.${ctx.lane.domain}`;
		let state = await this.state();

		// Moving to another account: the old tunnel would keep its connectors' token
		// valid and route nothing — remove it first.
		if (state !== null && state.accountId !== accountId) await this.teardown();
		state = await this.state();

		if (state === null) {
			this.logger.log(`Creating the stack tunnel on Cloudflare account ${accountId}`);
			// `createTunnel` adopts a tunnel this account already owns under the same
			// name, so a retry after a partial failure does not create a second one.
			const created = await this.tunnels.createTunnel(accountId, { name: ctx.resourceName });
			state = { accountId, tunnelId: created.tunnel.id, token: created.token, wildcard };
		}
		await this.store.write(CLOUDFLARE_TUNNEL_EDGE_ID, stateSchema, { ...state, wildcard });
		// ONE wildcard rule. No DNS here — that is the DNS plane's job (`dnsRecords`).
		await this.tunnels.configureIngress(accountId, state.tunnelId, wildcard, ctx.ingressTarget);
	}

	async teardown(): Promise<void> {
		const state = await this.state();
		if (state === null) return;
		// Provider first: forgetting the id first would orphan a tunnel nobody can name.
		await this.tunnels.deleteTunnel(state.accountId, state.tunnelId);
		await this.store.clear(CLOUDFLARE_TUNNEL_EDGE_ID);
		this.logger.log(`Deleted stack tunnel ${state.tunnelId} (account ${state.accountId})`);
	}

	async connector(ctx: EdgeContext): Promise<EdgeConnectorSpec | null> {
		const state = await this.stateFor(ctx.lane);
		if (state === null) return null;
		return {
			image: this.env.get("DEPLOYER_CLOUDFLARED_IMAGE"),
			// `TUNNEL_TOKEN` is the variable cloudflared reads for exactly this; a token
			// in argv would be readable through `docker inspect`.
			env: [`TUNNEL_TOKEN=${state.token}`],
			command: ["cloudflared"],
			args: ["tunnel", "--no-autoupdate", "run"],
			replicas: this.env.get("DEPLOYER_CLOUDFLARED_REPLICAS"),
		};
	}

	async dnsRecords(ctx: EdgeContext): Promise<EdgeDnsRecord[]> {
		const state = await this.stateFor(ctx.lane);
		if (state === null) return [];
		return [
			{
				name: `*.${ctx.lane.domain}`,
				type: "CNAME",
				contents: [`${state.tunnelId}.cfargotunnel.com`],
				proxied: true,
				preferredAccountId: state.accountId,
			},
		];
	}

	async status(ctx: EdgeContext): Promise<EdgeStatus> {
		const state = await this.stateFor(ctx.lane);
		if (state === null) {
			return {
				provisioned: false,
				health: "down",
				detail: "The tunnel is not created yet. Save the public lane to create it.",
				facts: [],
				resources: [],
			};
		}
		const health = await this.tunnels.getTunnelHealth(state.accountId, state.tunnelId);
		const mapped =
			health.status === "healthy" ? "healthy" : health.status === "degraded" ? "degraded" : health.status === "unknown" ? "unknown" : "down";
		return {
			provisioned: true,
			health: mapped,
			detail:
				health.error ??
				(health.connections === 0 ? "No connector is connected yet — the connector service may still be starting." : null),
			facts: [
				{ label: "Tunnel", value: state.tunnelId },
				{ label: "Routes", value: `${state.wildcard} → ${ctx.ingressTarget}` },
				{ label: "Connections", value: String(health.connections) },
				{ label: "Cloudflare status", value: health.status },
			],
			resources: [{ kind: "tunnel", id: state.tunnelId, accountId: state.accountId }],
		};
	}

	joinPath(ctx: EdgeContext, status: EdgeStatus): PublicJoinPath {
		return {
			via: DESCRIPTOR.label,
			available: status.provisioned,
			target: `https://api.${ctx.lane.domain}`,
			hostHeader: null,
			sources: status.provisioned ? Number(status.facts.find((fact) => fact.label === "Connections")?.value ?? 0) : 0,
			detail: status.provisioned
				? "A node anywhere dials the public domain; a connector carries it in. No node opens a port and the joiner needs no public address."
				: (status.detail ?? "The tunnel is not created yet."),
		};
	}

	// ─── Called by the Cloudflare tunnels page ─────────────────────────────

	/** The wildcard the stack tunnel routes, when `tunnelId` on `accountId` is it. */
	async stackWildcard(accountId: string, tunnelId: string): Promise<string | null> {
		const state = await this.state();
		return state !== null && state.accountId === accountId && state.tunnelId === tunnelId ? state.wildcard : null;
	}

	/** Forget the stack tunnel after it was deleted from the tunnels page. True when it was the stack's. */
	async forgetDeletedTunnel(accountId: string, tunnelId: string): Promise<boolean> {
		if ((await this.stackWildcard(accountId, tunnelId)) === null) return false;
		await this.store.clear(CLOUDFLARE_TUNNEL_EDGE_ID);
		this.logger.log(`Forgot stack tunnel ${tunnelId} (deleted from the tunnels page)`);
		return true;
	}
}
