import { describe, expect, it } from "vitest";

import {
	NODE_AGENT_DATA_DIR,
	NODE_AGENT_DOCKER_SOCKET,
	NODE_AGENT_WIREGUARD_PORT,
} from "@deployer/node-agent-container";

import { nodeAgentSwarmServiceName, nodeAgentSwarmSpec } from "./node-agent-swarm-spec";

const spec = () => nodeAgentSwarmSpec({ name: "deployer-node-agent-swarm", image: "agent:t", advertiseUrl: "ws://10.0.0.5:3106/mesh/ws" });

describe("nodeAgentSwarmSpec", () => {
	it("schedules one task per node from the image it is given", () => {
		expect(spec()).toMatchObject({ name: "deployer-node-agent-swarm", image: "agent:t", mode: "global" });
	});

	it("runs in the host network namespace with NET_ADMIN (the interface must be the HOST's)", () => {
		expect(spec().networks).toEqual([{ target: "host", aliases: [] }]);
		expect(spec().capabilitiesAdd).toEqual(["NET_ADMIN"]);
	});

	it("mounts the agent's volumes and the Docker socket", () => {
		expect(spec().mounts).toEqual([
			{ type: "volume", source: "deployer-node-agent-data", target: NODE_AGENT_DATA_DIR, readOnly: false },
			{ type: "volume", source: "deployer-node-agent-run", target: "/run/deployer-node", readOnly: false },
			{ type: "volume", source: "deployer-node-agent-admin", target: "/run/deployer-node-admin", readOnly: false },
			{ type: "bind", source: NODE_AGENT_DOCKER_SOCKET, target: NODE_AGENT_DOCKER_SOCKET, readOnly: false },
		]);
	});

	it("carries the agent's env, from the same builder the host container uses", () => {
		expect(spec().env).toEqual([
			`NODE_AGENT_DATA_DIR=${NODE_AGENT_DATA_DIR}`,
			"NODE_AGENT_SOCKET=/run/deployer-node/agent.sock",
			"NODE_AGENT_ADMIN_SOCKET=/run/deployer-node-admin/admin.sock",
			"NODE_AGENT_SOCKET_UID=1001",
			"NODE_AGENT_SOCKET_GID=1001",
			"MESH_ADVERTISE_URL=ws://10.0.0.5:3106/mesh/ws",
			"MESH_WIREGUARD_ENABLED=true",
			`MESH_WIREGUARD_PORT=${String(NODE_AGENT_WIREGUARD_PORT)}`,
			"NODE_AGENT_DOOR_IMAGE=nginx:alpine",
		]);
	});

	it("names the service apart from the host container, with the deployment prefix", () => {
		expect(nodeAgentSwarmServiceName(undefined)).toBe("deployer-node-agent-swarm");
		expect(nodeAgentSwarmServiceName("")).toBe("deployer-node-agent-swarm");
		expect(nodeAgentSwarmServiceName("eu")).toBe("deployer-node-agent-swarm-eu");
	});
});
