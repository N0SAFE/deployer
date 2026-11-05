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

import { Context, Effect } from "effect";

import { MANAGED_WEB_CONTAINER_BASE_NAME } from "./platform-names";

import type { PlatformConfigServiceShape } from "./platform-config.service";

export type PlatformWebTargetServiceShape = {
	/** The web container name on the platform network, or null when no web should be served (no route / no forward). */
	readonly resolveWebTarget: () => Effect.Effect<string | null>;
};

type Ports = {
	readonly platformConfig: Pick<PlatformConfigServiceShape, "isManagedWebAppEnabled">;
	/** The environment values the resolution reads. */
	readonly env: {
		readonly webTarget: () => string | undefined;
		readonly managedWebExternal: () => boolean;
		readonly prefix: () => string;
	};
};

export function makePlatformWebTargetService({ platformConfig, env }: Ports): PlatformWebTargetServiceShape {
	return {
		resolveWebTarget: () =>
			Effect.gen(function* () {
				const explicit = env.webTarget()?.trim();
				if (explicit !== undefined && explicit !== "") return explicit;

				// The API-supervised managed web owns the surface unless an external web (compose side-by-side / BYO) is declared.
				if (env.managedWebExternal()) return null;
				if (!(yield* platformConfig.isManagedWebAppEnabled())) return null;

				const prefix = env.prefix();
				return prefix === "" ? MANAGED_WEB_CONTAINER_BASE_NAME : `${MANAGED_WEB_CONTAINER_BASE_NAME}-${prefix}`;
			}),
	};
}

export class PlatformWebTargetService extends Context.Service<PlatformWebTargetService, PlatformWebTargetServiceShape>()(
	"shared/PlatformWebTargetService",
) {}
