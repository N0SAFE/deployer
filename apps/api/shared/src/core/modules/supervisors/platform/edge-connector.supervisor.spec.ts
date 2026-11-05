import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { defaultIngressLanes } from "@deployer/contracts-entities/entities/ingress/index";
import type { DockerEngineShape } from "@deployer/docker";
import { makeSupervisorOrchestrator } from "@deployer/supervision";

import { harness, testBus } from "../supervisor-test-harness";

import { EDGE_CONNECTOR_SUPERVISOR_ID, makeEdgeConnectorRegistration } from "./edge-connector.supervisor";

import type { EnvService } from "../../../../config/env/env.module";
import type { EdgeConnectorSpec } from "../../edge/edge-provider";
import type { IngressLanesServiceShape } from "../../platform-ingress/services/ingress-lanes.service";
import type { PublicEdgeServiceShape } from "../../reachability/services/public-edge.service";

const connector: EdgeConnectorSpec = { image: "tunnel:1", env: ["TOKEN=secret"], command: ["tunnel"], args: ["run"], replicas: 2 };

/**
 * The host's job is wiring: the lanes, the edge provider's answer and the environment reach the Effect
 * supervisor, and it registers once that answer is primed. The supervisor's own behaviour is tested in
 * `@deployer/platform-supervisors`.
 */
function make(options: { desired?: { providerId: string; spec: EdgeConnectorSpec } | null; connectorFails?: boolean } = {}) {
	const reconciled: { image: string; name: string }[] = [];
	const engine = {
		swarmCluster: { isActive: () => Effect.succeed(true) },
		networks: { ensureOverlay: () => Effect.void },
		swarmServices: {
			reconcile: (spec: { image: string; name: string }) => Effect.sync(() => { reconciled.push(spec); }),
			inspect: (name: string) => Effect.succeed({ ID: "svc", CreatedAt: "", UpdatedAt: "", Spec: { Name: name } }),
			listTasks: () => Effect.succeed([{ Status: { State: "running" } }]),
			remove: () => Effect.void,
		},
	};
	const edge = {
		connector: vi.fn(() => (options.connectorFails === true ? Effect.fail(new Error("provider down")) : Effect.succeed(options.desired ?? null))),
		ingressTarget: () => "http://deployer-traefik:8002",
	} as unknown as PublicEdgeServiceShape;
	const lanes = { getLanes: vi.fn(() => Effect.succeed(defaultIngressLanes())) } as unknown as IngressLanesServiceShape;
	const supervisor = harness(
		makeEdgeConnectorRegistration({
			engine: engine as unknown as DockerEngineShape,
			env: { get: vi.fn(() => "") } as unknown as EnvService,
			lanes,
			edge,
			bus: testBus(),
		}),
	);
	const orchestrator = makeSupervisorOrchestrator();
	return { supervisor, orchestrator, reconciled, edge, lanes };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("edge connector supervisor registration", () => {
	it("asks the provider with the current lanes, then runs its connector", async () => {
		const { supervisor, reconciled, edge, lanes } = make({ desired: { providerId: "some-tunnel", spec: connector } });
		expect(await supervisor.ensureDesiredState()).toBe("converged");
		expect(lanes.getLanes).toHaveBeenCalled();
		expect(edge.connector).toHaveBeenCalledWith(defaultIngressLanes());
		expect(reconciled[0]).toMatchObject({ image: "tunnel:1", name: "deployer-edge-connector" });
	});

	it("registers once the provider's answer is primed", async () => {
		const { supervisor, orchestrator } = make({ desired: { providerId: "some-tunnel", spec: connector } });
		await supervisor.register(orchestrator);
		await settle();
		expect(orchestrator.has(EDGE_CONNECTOR_SUPERVISOR_ID)).toBe(true);
	});

	it("still registers when the provider cannot be asked at boot", async () => {
		const { supervisor, orchestrator } = make({ connectorFails: true });
		await supervisor.register(orchestrator);
		await settle();
		expect(orchestrator.has(EDGE_CONNECTOR_SUPERVISOR_ID)).toBe(true);
	});

	it("is `managed` and healthy when the edge needs no connector", async () => {
		const { supervisor } = make({ desired: null });
		await supervisor.ensureDesiredState();
		expect(await supervisor.getHealth()).toMatchObject({ healthy: true, payload: { runtime: "managed", provider: null } });
	});
});
