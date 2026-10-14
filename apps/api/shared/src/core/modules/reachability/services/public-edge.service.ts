/**
 * PublicEdgeService — the stack's public edge: the registered provider behind the
 * public lane, seen through one context.
 *
 * Every consumer (the Network pages, the connector supervisor, the DNS plane, the
 * domain gate) asks HERE rather than building an `EdgeContext` itself, so the
 * facts a provider sees — the ingress target, the nodes' public addresses, the
 * resource name — are the same whoever asks.
 *
 * A lane naming a provider this API does not have (a plugin removed, a setting
 * written by a newer version) is reported as a DOWN edge with the reason — never
 * as "no public lane", which would hide that the operator asked for one.
 */

import { Injectable, Logger } from "@nestjs/common";
import type {
	EdgeProviderDescriptor,
	EdgeStatus,
	IngressLanes,
	PublicJoinPath,
} from "@repo/contracts-entities/entities/ingress/index";

import { EnvService } from "@/config/env/env.module";
import type { EdgeConnectorSpec, EdgeContext, EdgeDnsRecord, EdgeProvider } from "@/core/modules/edge/edge-provider";
import { EdgeProviderRegistry } from "@/core/modules/edge/edge-provider.registry";
import { LANE_ENTRYPOINTS } from "@/core/modules/platform-ingress/services/lane-traefik-config";
import { platformTraefikContainerName } from "@/core/modules/platform-ingress/services/platform-names";

import { NodeNetworkConfigRepository } from "../repositories/node-network-config.repository";
import { toNodeNetworkConfigData } from "./node-network-config.mapper";

/**
 * Name of the stack's resources on a provider account. Stack-scoped, so a retry
 * adopts the resource it created before instead of creating a second one.
 */
export function stackResourceName(prefix: string | undefined): string {
	const clean = (prefix ?? "").trim();
	return clean === "" ? "deployer-stack" : `deployer-stack-${clean}`;
}

export interface PublicEdgeView {
	provider: EdgeProviderDescriptor | null;
	/** The provider id the lane names, even when it is not registered. */
	providerId: string;
	status: EdgeStatus;
}

@Injectable()
export class PublicEdgeService {
	private readonly logger = new Logger(PublicEdgeService.name);

	constructor(
		private readonly registry: EdgeProviderRegistry,
		private readonly nodeConfigs: NodeNetworkConfigRepository,
		private readonly env: EnvService,
	) {}

	/** Traefik's `public` entrypoint on the platform overlay — the one target every edge forwards to. */
	ingressTarget(): string {
		return `http://${platformTraefikContainerName(this.env.get("DEPLOYER_PREFIX"))}:${String(LANE_ENTRYPOINTS.public.port)}`;
	}

	/** The provider and context for the lanes' public lane, or null when there is none / it is not registered. */
	async resolve(lanes: IngressLanes): Promise<{ provider: EdgeProvider; ctx: EdgeContext } | null> {
		if (lanes.public === null) return null;
		const provider = this.registry.find(lanes.public.provider);
		if (provider === null) return null;
		const rows = await this.nodeConfigs.list().catch((error: unknown): Awaited<ReturnType<NodeNetworkConfigRepository["list"]>> => {
			this.logger.warn(`Node addresses unavailable: ${error instanceof Error ? error.message : String(error)}`);
			return [];
		});
		return {
			provider,
			ctx: {
				lane: lanes.public,
				ingressTarget: this.ingressTarget(),
				nodes: rows.map((row) => toNodeNetworkConfigData(row.nodeId, row)),
				resourceName: stackResourceName(this.env.get("DEPLOYER_PREFIX")),
			},
		};
	}

	/** The public edge as the UI shows it, or null when there is no public lane. */
	async view(lanes: IngressLanes): Promise<PublicEdgeView | null> {
		if (lanes.public === null) return null;
		const resolved = await this.resolve(lanes);
		if (resolved === null) {
			return {
				provider: null,
				providerId: lanes.public.provider,
				status: {
					provisioned: false,
					health: "down",
					detail: `The public lane uses '${lanes.public.provider}', which is not available on this API. Pick another edge provider.`,
					facts: [],
					resources: [],
				},
			};
		}
		return { provider: resolved.provider.descriptor, providerId: resolved.provider.descriptor.id, status: await this.statusOf(resolved) };
	}

	/** The provider's own status — a provider that throws reads as an unknown edge, not as an error page. */
	private async statusOf({ provider, ctx }: { provider: EdgeProvider; ctx: EdgeContext }): Promise<EdgeStatus> {
		try {
			return await provider.status(ctx);
		} catch (error) {
			return {
				provisioned: false,
				health: "unknown",
				detail: `${provider.descriptor.label} status unavailable: ${error instanceof Error ? error.message : String(error)}`,
				facts: [],
					resources: [],
			};
		}
	}

	/** How a stranger joins through the public lane, or null when there is none. */
	async joinPath(lanes: IngressLanes): Promise<PublicJoinPath | null> {
		const resolved = await this.resolve(lanes);
		if (resolved === null) return null;
		return resolved.provider.joinPath(resolved.ctx, await this.statusOf(resolved));
	}

	/** Records the public lane needs. Empty when there is no public lane. */
	async dnsRecords(lanes: IngressLanes): Promise<EdgeDnsRecord[]> {
		const resolved = await this.resolve(lanes);
		return resolved === null ? [] : await resolved.provider.dnsRecords(resolved.ctx);
	}

	/** The process the cluster must run for the edge, labelled with its provider. */
	async connector(lanes: IngressLanes): Promise<{ providerId: string; spec: EdgeConnectorSpec } | null> {
		const resolved = await this.resolve(lanes);
		if (resolved === null) return null;
		const spec = await resolved.provider.connector(resolved.ctx);
		return spec === null ? null : { providerId: resolved.provider.descriptor.id, spec };
	}
}
