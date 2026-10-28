import { DockerService } from "@deployer/nest-docker/services/docker.service";
import {
	makeSwarmBootstrap,
	makeSwarmCluster,
	makeSwarmFleet,
	makeSwarmJoinGrant,
	makeSwarmLeadership,
	makeSwarmParticipation,
	type MasterCandidateMetrics,
	type MasterChangedEvent,
	type SwarmBootstrapShape,
	type SwarmClusterShape,
	type SwarmElectionConfig,
	type SwarmFleetShape,
	type SwarmJoinConfig,
	type SwarmJoinGrantShape,
	type SwarmParticipationDefaults,
	type SwarmParticipationShape,
} from "@deployer/swarm";
import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Effect, Fiber } from "effect";

import { ClusterNodeRepository, NodeConfigRepository } from "../node-state/repositories";

export const SWARM_OPTIONS_TOKEN = "SWARM_OPTIONS" as const;

/**
 * What the app supplies. The shapes are Promise-friendly because app code supplies them: the mesh
 * address and the metrics provider may await, and the event sink is fire-and-forget.
 */
export type SwarmModuleOptions = {
	/** The election's cadence and thresholds. The package has no defaults: the right cadence depends on the fleet. */
	election: SwarmElectionConfig;
	join: SwarmJoinConfig;
	/** First-run participation defaults; the persisted `node_config` choice always wins. */
	participation?: Omit<SwarmParticipationDefaults, "meshAddress"> & { meshAddress?: () => Promise<string | null> };
	/** Whether THIS app converges the engine at boot (the API does; setup founds the cluster from its own flow). Default true. */
	convergeOnBoot?: boolean;
	metricsProvider?: { getCandidateMetrics: () => Promise<MasterCandidateMetrics[]> };
	eventSink?: { notifyMasterChanged: (event: MasterChangedEvent) => void };
};

/**
 * The Nest host of `@deployer/swarm`: builds the Effect services over the docker engine and the node
 * repositories once, and runs the election loop for the life of the Nest context.
 */
@Injectable()
export class SwarmHost implements OnModuleDestroy {
	readonly cluster: SwarmClusterShape;
	readonly fleet: SwarmFleetShape;
	readonly participation: SwarmParticipationShape;
	readonly joinGrant: SwarmJoinGrantShape;
	readonly bootstrap: SwarmBootstrapShape;
	readonly leadership: ReturnType<typeof makeSwarmLeadership>;
	private electionFiber: Fiber.Fiber<void> | null = null;

	constructor(
		@Inject(SWARM_OPTIONS_TOKEN) private readonly options: SwarmModuleOptions,
		dockerService: DockerService,
		nodeConfig: NodeConfigRepository,
		clusterNode: ClusterNodeRepository,
	) {
		const docker = dockerService.getEngine();
		const { meshAddress, ...participationDefaults } = options.participation ?? {};
		const defaults: SwarmParticipationDefaults = {
			...participationDefaults,
			...(meshAddress ? { meshAddress: Effect.tryPromise(() => meshAddress()) } : {}),
		};
		this.cluster = makeSwarmCluster(docker);
		this.fleet = makeSwarmFleet(docker);
		this.participation = makeSwarmParticipation({ defaults, nodeConfig: nodeConfig.effect, clusterNode: clusterNode.effect, cluster: this.cluster, docker });
		this.joinGrant = makeSwarmJoinGrant({ cluster: this.cluster, config: options.join, participation: defaults });
		this.bootstrap = makeSwarmBootstrap(this.participation, options.convergeOnBoot ?? true);
		const metrics = options.metricsProvider;
		const sink = options.eventSink;
		this.leadership = makeSwarmLeadership({
			cluster: this.cluster,
			clusterNode: clusterNode.effect,
			config: options.election,
			metricsProvider: metrics ? { getCandidateMetrics: () => Effect.tryPromise(() => metrics.getCandidateMetrics()) } : null,
			eventSink: sink ? { notifyMasterChanged: (event) => Effect.sync(() => { sink.notifyMasterChanged(event); }) } : null,
		});
	}

	/** Starts the election loop: an immediate pass, then one per cadence. */
	startElection(): void {
		this.electionFiber ??= Effect.runFork(this.leadership.run);
	}

	async onModuleDestroy(): Promise<void> {
		if (this.electionFiber) await Effect.runPromise(Fiber.interrupt(this.electionFiber));
		this.electionFiber = null;
	}
}
