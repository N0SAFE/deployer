import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { DockerNotFound, type DockerEngineShape } from "@deployer/docker";
import { isNodeAgentSwarmMode } from "@deployer/node-agent-container";
import type { SupervisorOrchestratorShape } from "@deployer/supervision";

import type { EnvService } from "../../../../config/env/env.module";
import { harness, testBus } from "../supervisor-test-harness";
import { makeNodeAgentSwarmRegistration } from "./node-agent.supervisor";

type ReconciledSpec = { name: string; mode: string; image: string; networks: { target: string }[]; capabilitiesAdd?: string[] };

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): EnvService {
	const values: Record<string, unknown> = {
		DEPLOYER_PREFIX: "",
		NODE_AGENT_IMAGE: "agent:test",
		NODE_AGENT_SWARM_MODE: false,
		...overrides,
	};
	return { get: vi.fn((key: string) => values[key]) } as unknown as EnvService;
}

function setup(envOverrides: Partial<Record<string, unknown>> = {}) {
	const reconciled: ReconciledSpec[] = [];
	const removeIfExists = vi.fn(() => Effect.void);
	const hostContainer = vi.fn(() => Effect.fail(new DockerNotFound({ resource: "deployer-node-agent" })));
	const engine = {
		swarmCluster: { isActive: () => Effect.succeed(true), info: () => Effect.succeed({ NodeID: "n1" }) },
		swarmServices: {
			reconcile: (spec: ReconciledSpec) =>
				Effect.sync(() => {
					reconciled.push(spec);
				}),
			inspect: (name: string) => Effect.succeed({ ID: `svc-${name}`, Spec: { Name: name } }),
			listTasks: () => Effect.succeed([{ NodeID: "n1", Status: { State: "running" } }]),
		},
		containers: { inspect: hostContainer, removeIfExists },
	} as unknown as DockerEngineShape;

	const orchestrator = { register: vi.fn(() => Effect.void) } as unknown as SupervisorOrchestratorShape;
	const { registration } = makeNodeAgentSwarmRegistration({ engine, env: makeEnv(envOverrides), bus: testBus() });
	return { supervisor: harness(registration), orchestrator, reconciled, removeIfExists, hostContainer };
}

describe("mesh agent swarm registration", () => {
	it("registers only with NODE_AGENT_SWARM_MODE=true", async () => {
		const off = setup();
		expect(await off.supervisor.register(off.orchestrator)).toBe(false);
		expect(off.orchestrator.register).not.toHaveBeenCalled();

		const on = setup({ NODE_AGENT_SWARM_MODE: true });
		expect(await on.supervisor.register(on.orchestrator)).toBe(true);
		expect(on.orchestrator.register).toHaveBeenCalledOnce();
	});

	it("converges one global, host-network task per node", async () => {
		const { supervisor, reconciled } = setup({ NODE_AGENT_SWARM_MODE: true });
		expect(await supervisor.ensureDesiredState()).toBe("converged");
		expect(reconciled[0]).toMatchObject({
			name: "deployer-node-agent-swarm",
			mode: "global",
			image: "agent:test",
			networks: [{ target: "host" }],
			capabilitiesAdd: ["NET_ADMIN"],
		});
	});

	it("removes the platform-managed host container it replaces", async () => {
		const { supervisor, hostContainer, removeIfExists } = setup({ NODE_AGENT_SWARM_MODE: true });
		hostContainer.mockReturnValue(Effect.succeed({ Config: { Labels: { "deployer.platform.role": "node-agent" } } }) as never);
		await supervisor.ensureDesiredState();
		expect(removeIfExists).toHaveBeenCalledWith("deployer-node-agent");
	});

	it("reports this node's task as its health", async () => {
		const { supervisor } = setup({ NODE_AGENT_SWARM_MODE: true });
		await supervisor.ensureDesiredState();
		expect(await supervisor.getHealth()).toMatchObject({ healthy: true, payload: { runtime: "swarm-global", taskState: "running" } });
	});
});

describe("isNodeAgentSwarmMode", () => {
	it("reads the parsed boolean and the raw spellings a compose file produces", () => {
		for (const on of [true, "true", "1"]) expect(isNodeAgentSwarmMode(on)).toBe(true);
		for (const off of [false, "false", "0", "", undefined, null]) expect(isNodeAgentSwarmMode(off)).toBe(false);
	});
});
