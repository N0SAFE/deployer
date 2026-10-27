/**
 * The endpoint every ingress task polls for its routes (Traefik HTTP provider).
 *
 * Not an oRPC contract: the consumer is Traefik, which expects its own dynamic
 * configuration JSON at a URL. Anonymous at the auth-guard level (Traefik has no
 * session) and authenticated by the derived ingress token instead.
 */

import { Controller, Get, Headers, UnauthorizedException } from "@nestjs/common";
import { ApiOkResponse, ApiUnauthorizedResponse } from "@nestjs/swagger";

import { EnvService } from "../../../../config/env/env.module";
import { AllowAnonymous } from "../../auth/decorators/decorators";
import {
	INGRESS_TOKEN_HEADER,
	ingressTokenMatches,
	requireIngressSecret,
	TRAEFIK_CONFIG_PATH,
} from "../../platform-ingress/services/ingress-provider-token";
import type { LaneTraefikConfig } from "../../platform-ingress/services/lane-traefik-config";
import { TraefikIngressConfigService } from "../services/traefik-ingress-config.service";

@AllowAnonymous()
@Controller()
export class TraefikIngressConfigController {
	constructor(
		private readonly config: TraefikIngressConfigService,
		private readonly env: EnvService,
	) {}

	@Get(TRAEFIK_CONFIG_PATH)
	@ApiOkResponse({ description: "Traefik dynamic configuration, in the HTTP provider's format" })
	@ApiUnauthorizedResponse({ description: "Missing or wrong ingress token" })
	async dynamicConfig(@Headers(INGRESS_TOKEN_HEADER.toLowerCase()) token: string | undefined): Promise<LaneTraefikConfig> {
		if (!ingressTokenMatches(token, requireIngressSecret(this.env.get("AUTH_SECRET"), this.env.get("BETTER_AUTH_SECRET")))) {
			throw new UnauthorizedException("invalid ingress token");
		}
		return this.config.buildDynamicConfig();
	}
}
