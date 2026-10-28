import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { defaultIngressLanes } from "@deployer/contracts-entities/entities/ingress/index";
import type { DockerEngineShape } from "@deployer/docker";
import { SupervisorOrchestratorService } from "@deployer/nest-effect/supervision";

import type { EnvService } from "../../../../config/env/env.module";
import type { EdgeConnectorSpec } from "../../edge/edge-provider";
import type { IngressLanesService } from "../../platform-ingress/services/ingress-lanes.service";
import type { PublicEdgeService } from "../../reachability/services/public-edge.service";
import { EDGE_CONNECTOR_SUPERVISOR_ID, EdgeConnectorSupervisorService } from "./edge-connector-supervisor.service";

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
		connector: vi.fn(() => (options.connectorFails === true ? Promise.reject(new Error("provider down")) : Promise.resolve(options.desired ?? null))),
		ingressTarget: () => "http://deployer-traefik:8002",
	} as unknown as PublicEdgeService;
	const lanes = { getLanes: vi.fn(() => Promise.resolve(defaultIngressLanes())) } as unknown as IngressLanesService;
	const supervisor = new EdgeConnectorSupervisorService(
		engine as unknown as DockerEngineShape,
		{ get: vi.fn(() => "") } as unknown as EnvService,
		lanes,
		edge,
	);
	const orchestrator = new SupervisorOrchestratorService();
	(supervisor as unknown as { orchestrator: SupervisorOrchestratorService }).orchestrator = orchestrator;
	return { supervisor, orchestrator, reconciled, edge, lanes };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("EdgeConnectorSupervisorService (host)", () => {
	it("asks the provider with the current lanes, then runs its connector", async () => {
		const { supervisor, reconciled, edge, lanes } = make({ desired: { providerId: "some-tunnel", spec: connector } });
		expect(await supervisor.ensureDesiredState()).toBe("converged");
		expect(lanes.getLanes).toHaveBeenCalled();
		expect(edge.connector).toHaveBeenCalledWith(defaultIngressLanes());
		expect(reconciled[0]).toMatchObject({ image: "tunnel:1", name: "deployer-edge-connector" });
	});

	it("registers once the provider's answer is primed", async () => {
		const { supervisor, orchestrator } = make({ desired: { providerId: "some-tunnel", spec: connector } });
		supervisor.onModuleInit();
		await settle();
		expect(orchestrator.has(EDGE_CONNECTOR_SUPERVISOR_ID)).toBe(true);
	});

	it("still registers when the provider cannot be asked at boot", async () => {
		const { supervisor, orchestrator } = make({ connectorFails: true });
		supervisor.onModuleInit();
		await settle();
		expect(orchestrator.has(EDGE_CONNECTOR_SUPERVISOR_ID)).toBe(true);
	});

	it("is `managed` and healthy when the edge needs no connector", async () => {
		const { supervisor } = make({ desired: null });
		await supervisor.ensureDesiredState();
		expect(await supervisor.getHealth()).toMatchObject({ healthy: true, payload: { runtime: "managed", provider: null } });
	});
});
