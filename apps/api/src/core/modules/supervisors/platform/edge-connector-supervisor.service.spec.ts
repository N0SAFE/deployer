import { describe, expect, it, vi } from "vitest";
import { defaultIngressLanes } from "@deployer/contracts-entities/entities/ingress/index";
import type { DockerService } from "@deployer/nest-docker/services/docker.service";

import type { EnvService } from "@/config/env/env.module";
import type { EdgeConnectorSpec } from "@/core/modules/edge/edge-provider";
import type { IngressLanesService } from "@/core/modules/platform-ingress/services/ingress-lanes.service";
import type { PublicEdgeService } from "@/core/modules/reachability/services/public-edge.service";

import { EdgeConnectorSupervisorService } from "./edge-connector-supervisor.service";

const connector: EdgeConnectorSpec = { image: "tunnel:1", env: ["TOKEN=secret"], command: ["tunnel"], args: ["run"], replicas: 2 };

function make(desired: { providerId: string; spec: EdgeConnectorSpec } | null) {
	const docker = {
		inspectSwarmService: vi.fn(() => Promise.resolve({ ID: "svc", Spec: { Name: "deployer-edge-connector" } })),
		listSwarmServiceTasks: vi.fn(() => Promise.resolve([])),
		removeSwarmService: vi.fn(() => Promise.resolve()),
	} as unknown as DockerService;
	const env = { get: vi.fn(() => "") } as unknown as EnvService;
	const lanes = { getLanes: vi.fn(() => Promise.resolve(defaultIngressLanes())) } as unknown as IngressLanesService;
	const edge = {
		connector: vi.fn(() => Promise.resolve(desired)),
		ingressTarget: () => "http://deployer-traefik:8002",
	} as unknown as PublicEdgeService;
	const supervisor = new EdgeConnectorSupervisorService(docker, env, lanes, edge);
	const internals = supervisor as unknown as {
		buildSwarmSpec(): { image: string; env: string[]; command: string[]; args: string[]; replicas: number; endpointPorts: unknown[]; placementMaxReplicasPerNode: number; labels: Record<string, string> };
		effectiveRuntime(): string;
		removeSwarmServiceIfExists(name: string): Promise<void>;
		reconcile(): Promise<void>;
	};
	return { supervisor, internals, docker };
}

describe("EdgeConnectorSupervisorService", () => {
	it("runs the provider's connector replicated, at most one per node, and publishes nothing", async () => {
		const { supervisor, internals } = make({ providerId: "some-tunnel", spec: connector });
		await supervisor.loadDesired();
		expect(internals.effectiveRuntime()).toBe("swarm-replicated");
		const spec = internals.buildSwarmSpec();
		expect(spec).toMatchObject({ image: "tunnel:1", env: ["TOKEN=secret"], command: ["tunnel"], args: ["run"], replicas: 2, placementMaxReplicasPerNode: 1 });
		expect(spec.endpointPorts).toEqual([]);
		expect(spec.labels["deployer.edge.provider"]).toBe("some-tunnel");
	});

	it("is `managed` with nothing to run, and removes a connector left from a previous edge", async () => {
		const { internals } = make(null);
		const remove = vi.spyOn(internals, "removeSwarmServiceIfExists").mockResolvedValue();
		await internals.reconcile();
		expect(internals.effectiveRuntime()).toBe("managed");
		expect(remove).toHaveBeenCalledWith("deployer-edge-connector");
	});
});
