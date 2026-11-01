/**
 * IngressLanesService — the stack's lanes, stored in the MESH.
 *
 * The lanes are a cluster-wide fact, so they live in the replicated cluster
 * settings (`ingress.lanes`) rather than in one node's SQLite: the API is a
 * replicated swarm service that can be rescheduled to any node, and a setting that
 * lives on the node it happened to start on is lost the moment it moves.
 *
 * When there is no cluster store yet (a node mid-onboarding, before setup started
 * its agent) the lanes read as the install default — local only — which is the one
 * answer that can never expose the machine. Writes fail loudly instead: an
 * operator's choice must never be silently dropped.
 *
 * This service stores lanes; it does not judge them. Checking a public lane
 * against its edge provider is the registry's job (`EdgeProviderRegistry.normalize`),
 * done by whoever accepts the operator's input.
 */

import { Injectable, Logger } from "@nestjs/common";

import { defaultIngressLanes, ingressLanesSchema, type IngressLanes } from "@deployer/contracts-entities/entities/ingress/index";

import { EnvService } from "../../../../config/env/env.module";
import { ClusterSettings } from "../../mesh-node/cluster-settings";

export const INGRESS_LANES_SETTING = "ingress.lanes";

@Injectable()
export class IngressLanesService {
	private readonly logger = new Logger(IngressLanesService.name);

	constructor(
		private readonly settings: ClusterSettings,
		private readonly env: EnvService,
	) {}

	/** The lanes in effect: the replicated setting, else local-only. */
	async getLanes(): Promise<IngressLanes> {
		return await this.settings.read(
			INGRESS_LANES_SETTING,
			ingressLanesSchema,
			defaultIngressLanes(this.env.get("DEPLOYER_TRAEFIK_HTTP_PORT")),
		);
	}


	async setLanes(next: IngressLanes): Promise<IngressLanes> {
		await this.settings.write(INGRESS_LANES_SETTING, next);
		this.logger.log(
			`Ingress lanes set — local${next.private.enabled ? ` + private (${next.private.domain})` : ""}${
				next.public === null ? "" : ` + public via ${next.public.provider} (${next.public.domain})`
			}`,
		);
		return next;
	}
}
