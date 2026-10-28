import { Injectable, Inject } from "@nestjs/common";
import { DockerEngine, type DockerEngineShape } from "@deployer/docker";
import { SupervisorHost } from "../../supervision/index";
import {
	makeManagedWebSupervisor,
	managedWebProcessInfoSchema,
	managedWebSupervisorPayloadSchema,
	PLATFORM_MANAGED_WEB_SUPERVISOR_ID,
	type ManagedWebSupervisor,
} from "@deployer/platform-supervisors";
import { Effect } from "effect";

import { EnvService } from "../../../../config/env/env.module";
import { AppInstanceService } from "../../platform-ingress/services/app-instance.service";
import { HostnameService } from "../../platform-ingress/services/hostname.service";
import { MANAGED_WEB_CONTAINER_BASE_NAME, platformTraefikContainerName } from "../../platform-ingress/services/platform-names";
import { PlatformConfigService } from "../../platform-ingress/services/platform-config.service";

export { PLATFORM_MANAGED_WEB_SUPERVISOR_ID };

/**
 * The Nest host of the managed web (dashboard) supervisor. What it does (run the console as one swarm
 * service while the platform flag is on, check it is routed) is `@deployer/platform-supervisors`; this
 * class supplies the engine, the environment, the hostnames, the flag and the app-instance service.
 */
@Injectable()
export class ManagedWebSupervisorService extends SupervisorHost<
	typeof managedWebSupervisorPayloadSchema,
	typeof managedWebProcessInfoSchema
> {
	static readonly identifier = PLATFORM_MANAGED_WEB_SUPERVISOR_ID;

	readonly payloadSchema = managedWebSupervisorPayloadSchema;
	readonly processInfoSchema = managedWebProcessInfoSchema;
	readonly description: string;

	private readonly managedWeb: ManagedWebSupervisor;

	constructor(
		@Inject(DockerEngine) dockerService: DockerEngineShape,
		hostnameService: HostnameService,
		env: EnvService,
		platformConfig: PlatformConfigService,
		appInstances: AppInstanceService,
	) {
		super();
		this.managedWeb = makeManagedWebSupervisor({
			engine: dockerService,
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
		this.description = this.managedWeb.spec.description;
	}

	protected buildSpec(): ManagedWebSupervisor["spec"] {
		return this.managedWeb.spec;
	}
}
