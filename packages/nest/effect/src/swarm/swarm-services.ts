import type {
	ClusterSnapshot,
	DockerodeNodeSummary,
	DockerodeServiceSummary,
	MeshSwarmJoinGrant,
	SwarmConfigView,
	SwarmInitOptions,
	SwarmNodePolicy,
	SwarmNodeResources,
	SwarmParticipationConfig,
	SwarmParticipationInput,
	SwarmServiceRuntime,
	SwarmTaskRuntime,
} from "@deployer/contracts-entities";
import { decideRole, type SwarmJoinGrantShape } from "@deployer/swarm";
import { runSyncUnwrapped } from "@deployer/effect-core";
import { Injectable, type OnModuleInit } from "@nestjs/common";

import { runUnwrapped } from "../supervision/run";
import { SwarmHost } from "./swarm.host";

/**
 * Promise faces of the Effect services in `@deployer/swarm`, for the Nest callers that are not on
 * Effect yet. Each method runs the Effect and throws its original typed failure; the faces hold no logic.
 */
@Injectable()
export class SwarmClusterService {
	constructor(private readonly host: SwarmHost) {}
	assertClusterReady(): Promise<void> {
		return runUnwrapped(this.host.cluster.assertClusterReady());
	}
	ensureCluster(options: SwarmInitOptions): Promise<ClusterSnapshot> {
		return runUnwrapped(this.host.cluster.ensureCluster(options));
	}
	joinCluster(options: { joinToken: string; remoteAddrs: string[]; meshAddress?: string | null }): Promise<ClusterSnapshot> {
		return runUnwrapped(this.host.cluster.joinCluster(options));
	}
	reanchorLoneCluster(meshAddress: string): Promise<void> {
		return runUnwrapped(this.host.cluster.reanchorLoneCluster(meshAddress));
	}
	managerAddresses(): Promise<string[]> {
		return runUnwrapped(this.host.cluster.managerAddresses());
	}
	getLocalClusterSnapshot(): Promise<ClusterSnapshot> {
		return runUnwrapped(this.host.cluster.getLocalClusterSnapshot());
	}
	getJoinTokens(): Promise<{ worker: string; manager: string } | null> {
		return runUnwrapped(this.host.cluster.getJoinTokens());
	}
	listSwarmServicesForDeployment(deploymentId: string): Promise<DockerodeServiceSummary[]> {
		return runUnwrapped(this.host.cluster.listSwarmServicesForDeployment(deploymentId));
	}
	listSwarmNodes(): Promise<DockerodeNodeSummary[]> {
		return runUnwrapped(this.host.cluster.listSwarmNodes());
	}
	inspectSwarmNode(nodeId: string): Promise<DockerodeNodeSummary> {
		return runUnwrapped(this.host.cluster.inspectSwarmNode(nodeId));
	}
	updateSwarmNodeLabels(nodeId: string, version: number, labels: Record<string, string>): Promise<void> {
		return runUnwrapped(this.host.cluster.updateSwarmNodeLabels(nodeId, version, labels));
	}
	waitForActiveCluster(): Promise<ClusterSnapshot> {
		return runUnwrapped(this.host.cluster.waitForActiveCluster());
	}
}

@Injectable()
export class SwarmFleetService {
	constructor(private readonly host: SwarmHost) {}
	listServices(): Promise<SwarmServiceRuntime[]> {
		return runUnwrapped(this.host.fleet.listServices());
	}
	listTasks(filter: { serviceId?: string; nodeId?: string } = {}): Promise<SwarmTaskRuntime[]> {
		return runUnwrapped(this.host.fleet.listTasks(filter));
	}
	getNodeResources(nodeId: string): Promise<SwarmNodeResources> {
		return runUnwrapped(this.host.fleet.getNodeResources(nodeId));
	}
}

@Injectable()
export class SwarmParticipationService {
	constructor(private readonly host: SwarmHost) {}
	effectiveConfig(): SwarmParticipationConfig {
		return runSyncUnwrapped(this.host.participation.effectiveConfig());
	}
	setupDone(): boolean {
		return runSyncUnwrapped(this.host.participation.setupDone());
	}
	converge(): Promise<ClusterSnapshot> {
		return runUnwrapped(this.host.participation.converge());
	}
	meshAddress(): Promise<string | null> {
		return runUnwrapped(this.host.participation.meshAddress());
	}
	applyConfig(input: SwarmParticipationInput): Promise<SwarmConfigView> {
		return runUnwrapped(this.host.participation.applyConfig(input));
	}
	view(): Promise<SwarmConfigView> {
		return runUnwrapped(this.host.participation.view());
	}
}

@Injectable()
export class SwarmJoinGrantService {
	constructor(private readonly host: SwarmHost) {}
	buildGrant(requested: SwarmNodePolicy | undefined): Promise<MeshSwarmJoinGrant | null> {
		return runUnwrapped(this.host.joinGrant.buildGrant(requested));
	}
	decideRole(input: Parameters<SwarmJoinGrantShape["decideRole"]>[0]): ReturnType<typeof decideRole> {
		return decideRole(input);
	}
}

@Injectable()
export class SwarmBootstrapService implements OnModuleInit {
	constructor(private readonly host: SwarmHost) {}
	async onModuleInit(): Promise<void> {
		await runUnwrapped(this.host.bootstrap.onBoot);
	}
	converge(trigger: "boot" | "setup"): Promise<void> {
		return runUnwrapped(this.host.bootstrap.converge(trigger));
	}
}

@Injectable()
export class SwarmLeadershipService implements OnModuleInit {
	constructor(private readonly host: SwarmHost) {}
	onModuleInit(): void {
		this.host.startElection();
	}
	evaluateNow(): Promise<void> {
		return runUnwrapped(this.host.leadership.evaluateNow());
	}
}
