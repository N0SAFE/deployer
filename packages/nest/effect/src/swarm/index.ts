/** The Nest host for `@deployer/swarm`: the module and the Promise faces the Nest callers inject. */
export { SwarmModule } from "./swarm.module";
export type { SwarmModuleAsyncOptions } from "./swarm.module";
export { SwarmHost } from "./swarm.host";
export type { SwarmModuleOptions } from "./swarm.host";
export {
	SwarmBootstrapService,
	SwarmClusterService,
	SwarmFleetService,
	SwarmJoinGrantService,
	SwarmLeadershipService,
	SwarmParticipationService,
} from "./swarm-services";
