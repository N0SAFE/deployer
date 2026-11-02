import { Logger } from "@nestjs/common";
import { Effect } from "effect";

import type { DockerEngineShape } from "@deployer/docker";
import {
	makeManagedWebSupervisor,
	
	
	PLATFORM_MANAGED_WEB_SUPERVISOR_ID,
	
} from "@deployer/platform-supervisors";

import { EnvService } from "../../../../config/env/env.module";
import { AppInstanceService } from "../../platform-ingress/services/app-instance.service";
import { HostnameService } from "../../platform-ingress/services/hostname.service";
import { PlatformConfigService } from "../../platform-ingress/services/platform-config.service";
import { MANAGED_WEB_CONTAINER_BASE_NAME, platformTraefikContainerName } from "../../platform-ingress/services/platform-names";
import { buildSupervisor, type SupervisorEventBus, type SupervisorRegistration } from "../../supervision/index";

export { PLATFORM_MANAGED_WEB_SUPERVISOR_ID };

export type ManagedWebSupervisorDeps = {
	readonly engine: DockerEngineShape;
	readonly env: EnvService;
	readonly hostnameService: HostnameService;
	readonly platformConfig: PlatformConfigService;
	readonly appInstances: AppInstanceService;
	readonly bus: SupervisorEventBus;
};

/**
 * The managed web (dashboard) supervisor. What it does (run the console as one swarm service while the
 * platform flag is on, check it is routed) is `@deployer/platform-supervisors`; this supplies the engine,
 * the environment, the hostnames, the flag and the app-instance service.
 */
export function makeManagedWebRegistration({ engine, env, hostnameService, platformConfig, appInstances, bus }: ManagedWebSupervisorDeps): SupervisorRegistration {
	const managedWeb = makeManagedWebSupervisor({
		engine,
		config: {
			serviceName: () => {
				const prefix = env.get("DEPLOYER_PREFIX");
				return prefix === "" ? MANAGED_WEB_CONTAINER_BASE_NAME : `${MANAGED_WEB_CONTAINER_BASE_NAME}-${prefix}`;
			},
			prefix: () => env.get("DEPLOYER_PREFIX") ?? "",
			image: () => env.get("MANAGED_WEB_APP_IMAGE"),
			authSecret: () => env.get("AUTH_SECRET"),
			apiPort: () => env.get("API_PORT"),
			ingressHost: () => platformTraefikContainerName(env.get("DEPLOYER_PREFIX")),
			runtimeOverride: () => process.env.SUPERVISOR_RUNTIME,
			external: () => Boolean(env.get("MANAGED_WEB_APP_EXTERNAL")),
			hostnames: {
				webHostname: () => hostnameService.webHostname(),
				webOrigin: () => hostnameService.webOrigin(),
				apiOrigin: () => hostnameService.apiOrigin(),
			},
			flagEnabled: Effect.tryPromise(() => platformConfig.isManagedWebAppEnabled()),
			appInstances: {
				mint: (label) => Effect.tryPromise(() => appInstances.create({ label, kind: "managed" })),
				revokeManaged: Effect.tryPromise(async () => {
					// Teardown kills trust immediately; a lookup that fails means there is nothing to revoke.
					const managed = await appInstances.findManaged().catch(() => null);
					if (managed !== null) await appInstances.revoke(managed.id);
				}),
			},
		},
	});
	return { supervisor: buildSupervisor(managedWeb.spec, bus, "ManagedWebSupervisor"), activate: Effect.succeed({}) };
}
