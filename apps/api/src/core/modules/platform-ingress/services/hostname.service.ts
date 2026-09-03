/**
 * HostnameService — single source of truth for the platform hostname grammar.
 *
 * Grammar (api-centric-deployment-architecture):
 *   DEPLOYER_PREFIX=""      → api.deployer.localhost   / web.deployer.localhost
 *   DEPLOYER_PREFIX="acme"  → api.acme.deployer.localhost / web.acme.deployer.localhost
 *
 * Nothing else in the codebase may construct these hostnames/origins.
 */

import { Injectable } from "@nestjs/common";
import { EnvService } from "@/config/env/env.service";

export const DEPLOYER_BASE_HOST = "deployer.localhost";

export abstract class HostnameService {
	/** Hostname of the API as routed by the platform Traefik. */
	abstract apiHostname(): string;
	/** Hostname of the managed web app as routed by the platform Traefik. */
	abstract webHostname(): string;
	/** Full origin for the API, scheme configurable for non-loopback deployments. */
	abstract apiOrigin(scheme?: "http" | "https"): string;
	/** Full origin for the managed web app. */
	abstract webOrigin(scheme?: "http" | "https"): string;
}

@Injectable()
export class EnvHostnameService extends HostnameService {
	constructor(private readonly env: EnvService) {
		super();
	}

	private prefixedHost(service: "api" | "web"): string {
		const prefix = this.env.get("DEPLOYER_PREFIX");
		return prefix === "" ? `${service}.${DEPLOYER_BASE_HOST}` : `${service}.${prefix}.${DEPLOYER_BASE_HOST}`;
	}

	apiHostname(): string {
		return this.prefixedHost("api");
	}

	webHostname(): string {
		return this.prefixedHost("web");
	}

	private origin(hostname: string, scheme?: "http" | "https"): string {
		const resolvedScheme = scheme ?? "http";
		if (resolvedScheme === "http") return `http://${hostname}`;
		return `https://${hostname}`;
	}

	apiOrigin(scheme?: "http" | "https"): string {
		return this.origin(this.apiHostname(), scheme);
	}

	webOrigin(scheme?: "http" | "https"): string {
		return this.origin(this.webHostname(), scheme);
	}
}
