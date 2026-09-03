/**
 * PlatformWebTargetService — resolves WHICH container serves the web on the
 * platform network, as a single source of truth shared by:
 *
 *   - the Traefik supervisor (writes the `web.deployer.localhost` route
 *     backend in dynamic-web.yml),
 *   - the failover direct-port proxy (default web forward target).
 *
 * Resolution order:
 *   1. explicit `DEPLOYER_WEB_TARGET` (compose/dev side-by-side stacks pass
 *      the compose web container name, e.g. `web-dev`),
 *   2. the API-supervised managed web container (`deployer-managed-web`),
 *      when the managed_web_app.enabled flag is on,
 *   3. null → no web route is written / no web forward (Traefik 404s the
 *      hostname cleanly instead of proxying to a missing container).
 *
 * The returned name is resolved over the PLATFORM network (docker embedded
 * DNS) — the container must be attached to it (compose: join the platform
 * network; managed web: the supervisor spawns it there).
 */

import { Injectable } from "@nestjs/common";

import { EnvService } from "@/config/env/env.service";
import { PlatformConfigService } from "./platform-config.service";
import { MANAGED_WEB_CONTAINER_BASE_NAME } from "./platform-names";

@Injectable()
export class PlatformWebTargetService {
	constructor(
		private readonly env: EnvService,
		private readonly platformConfig: PlatformConfigService,
	) {}

	/** The web container name on the platform network, or null when no web
	 *  should be served (no route / no forward). */
	async resolveWebTarget(): Promise<string | null> {
		const explicit = this.env.get("DEPLOYER_WEB_TARGET")?.trim();
		if (explicit !== undefined && explicit !== "") return explicit;

		// The API-supervised managed web owns the surface unless an external
		// web (compose side-by-side / BYO) is declared.
		if (this.env.get("MANAGED_WEB_APP_EXTERNAL")) return null;
		if (!(await this.platformConfig.isManagedWebAppEnabled())) return null;

		const prefix = this.env.get("DEPLOYER_PREFIX");
		return prefix === "" ? MANAGED_WEB_CONTAINER_BASE_NAME : `${MANAGED_WEB_CONTAINER_BASE_NAME}-${prefix}`;
	}
}