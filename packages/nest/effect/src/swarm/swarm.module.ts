import {
	Global,
	Module,
	type DynamicModule,
	type InjectionToken,
	type ModuleMetadata,
	type OptionalFactoryDependency,
	type Provider,
} from "@nestjs/common";

import {
	SwarmBootstrapService,
	SwarmClusterService,
	SwarmFleetService,
	SwarmJoinGrantService,
	SwarmLeadershipService,
	SwarmParticipationService,
} from "./swarm-services";
import { SWARM_OPTIONS_TOKEN, SwarmHost, type SwarmModuleOptions } from "./swarm.host";

export type SwarmModuleAsyncOptions = {
	imports?: NonNullable<ModuleMetadata["imports"]>;
	inject?: (InjectionToken | OptionalFactoryDependency)[];
	useFactory: (...deps: never[]) => SwarmModuleOptions | Promise<SwarmModuleOptions>;
};

const SERVICES = [
	SwarmClusterService,
	SwarmFleetService,
	SwarmParticipationService,
	SwarmJoinGrantService,
	SwarmLeadershipService,
	SwarmBootstrapService,
] as const;

/**
 * Mounts `@deployer/swarm` in a Nest context. The module is `@Global`: the services are injected without
 * importing it. The docker engine and the node repositories come from the app's own registrations
 * (`DockerService`, `NodesModule`).
 */
@Global()
@Module({})
export class SwarmModule {
	static forRoot(options: SwarmModuleOptions): DynamicModule {
		const providers: Provider[] = [{ provide: SWARM_OPTIONS_TOKEN, useValue: options }, SwarmHost, ...SERVICES];
		return { module: SwarmModule, providers, exports: [...SERVICES, SwarmHost] };
	}

	static forRootAsync(options: SwarmModuleAsyncOptions): DynamicModule {
		const providers: Provider[] = [
			{ provide: SWARM_OPTIONS_TOKEN, useFactory: options.useFactory, inject: options.inject ?? [] },
			SwarmHost,
			...SERVICES,
		];
		return { module: SwarmModule, imports: options.imports ?? [], providers, exports: [...SERVICES, SwarmHost] };
	}
}
