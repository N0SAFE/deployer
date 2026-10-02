import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DockerRuntimeEvent } from "@repo/contracts-entities";
import type { DockerService } from "@repo/nest-docker/services/docker.service";

import { SwarmActivityEnricherService } from "./swarm-activity-enricher.service";

/**
 * The enricher exists because of a MEASURED engine behaviour, so the tests pin
 * the behaviour rather than an implementation detail:
 *
 * Docker emits swarm events with no state, and emits NO task events at all
 * (verified against the raw /events socket on engine 29.8.1 with a
 * crash-looping and a Pending service present). The failure reason therefore has
 * to be READ from live task state — which is what this service does.
 */
function task(state: string, err: string | null) {
	return {
		ID: `task-${state}`,
		ServiceID: "svc-1",
		NodeID: "node-1",
		Slot: 1,
		DesiredState: "running",
		Status: { State: state, Err: err },
	};
}

function makeDockerService() {
	const listAllSwarmTasks = vi.fn(async () => [task("running", null)]);
	const listSwarmServices = vi.fn(async () => [
		{
			ID: "svc-1",
			Spec: {
				Name: "deployer-api",
				Mode: { Replicated: { Replicas: 2 } },
				TaskTemplate: { ContainerSpec: { Image: "deployer-api:dev" } },
			},
			UpdateStatus: { Message: null },
		},
	]);
	return {
		dockerService: { listAllSwarmTasks, listSwarmServices } as unknown as DockerService,
		listAllSwarmTasks,
		listSwarmServices,
	};
}

function serviceEvent(): DockerRuntimeEvent {
	return {
		type: "docker_event",
		source: "service",
		action: "update",
		actorId: "svc-1",
		actorAttributes: { name: "deployer-api" },
		scope: "swarm",
		from: null,
		eventId: null,
		nodeId: null,
		timestamp: "2026-10-02T12:00:00.000Z",
		timestampNano: null,
		raw: {},
		payload: { serviceId: "svc-1", serviceName: "deployer-api" },
	};
}

function containerEvent(): DockerRuntimeEvent {
	return {
		type: "docker_event",
		source: "container",
		action: "start",
		actorId: "abc123",
		actorAttributes: { name: "web-dev" },
		scope: "local",
		from: null,
		eventId: null,
		nodeId: null,
		timestamp: "2026-10-02T12:00:00.000Z",
		timestampNano: null,
		raw: {},
		payload: {
			containerId: "abc123",
			containerName: "web-dev",
			image: "web:dev",
			exitCode: null,
			signal: null,
		},
	};
}

describe("SwarmActivityEnricherService", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("reads live task state for a swarm event (the only place the reason exists)", async () => {
		const { dockerService, listAllSwarmTasks } = makeDockerService();
		const enricher = new SwarmActivityEnricherService(dockerService);

		const result = await enricher.enrichEvent(serviceEvent());

		expect(listAllSwarmTasks).toHaveBeenCalled();
		expect(result.tasks).toHaveLength(1);
		expect(result.service?.serviceName).toBe("deployer-api");
		expect(result.service?.runningTasks).toBe(1);
		expect(result.service?.desiredTasks).toBe(2);
	});

	it("surfaces the task error that the event stream never carries", async () => {
		const { dockerService } = makeDockerService();
		const enricher = new SwarmActivityEnricherService(dockerService);
		// The exact reason from the ingress incident.
		const portError = "no suitable node (host-mode port already in use on 1 node)";
		dockerService.listAllSwarmTasks = vi.fn(async () => [task("pending", portError)]) as never;

		const result = await enricher.enrichEvent(serviceEvent());

		expect(result.tasks[0]?.error).toBe(portError);
	});

	it("does NOT touch the engine for a non-swarm event", async () => {
		const { dockerService, listAllSwarmTasks, listSwarmServices } = makeDockerService();
		const enricher = new SwarmActivityEnricherService(dockerService);

		const result = await enricher.enrichEvent(containerEvent());

		// The container path must keep its existing cost — no extra reads.
		expect(listAllSwarmTasks).not.toHaveBeenCalled();
		expect(listSwarmServices).not.toHaveBeenCalled();
		expect(result.tasks).toEqual([]);
		expect(result.service).toBe(null);
	});

	it("still yields the event when the swarm read fails", async () => {
		const { dockerService } = makeDockerService();
		// A non-swarm node throws `This node is not a swarm manager` rather than
		// returning empty — that must not swallow the event itself.
		dockerService.listAllSwarmTasks = vi.fn(async () => {
			throw new Error("This node is not a swarm manager");
		}) as never;
		const enricher = new SwarmActivityEnricherService(dockerService);

		const result = await enricher.enrichEvent(serviceEvent());

		expect(result.event.source).toBe("service");
		expect(result.tasks).toEqual([]);
	});

	it("classifies swarm sources, including task", () => {
		const { dockerService } = makeDockerService();
		const enricher = new SwarmActivityEnricherService(dockerService);

		expect(enricher.isSwarmEvent(serviceEvent())).toBe(true);
		expect(enricher.isSwarmEvent(containerEvent())).toBe(false);
		// `task` is included even though engine 29.8.1 emits none: the server
		// synthesizes task-shaped activities, and a future engine may emit them.
		// Built as its own literal — spreading the service event would widen the
		// discriminated union and lose the `source: "task"` narrowing.
		const taskEvent: DockerRuntimeEvent = {
			type: "docker_event",
			source: "task",
			action: "update",
			actorId: "task-1",
			actorAttributes: {},
			scope: "swarm",
			from: null,
			eventId: null,
			nodeId: null,
			timestamp: "2026-10-02T12:00:00.000Z",
			timestampNano: null,
			raw: {},
			payload: {
				taskId: "task-1",
				serviceId: "svc-1",
				serviceName: "deployer-api",
				slot: 1,
				nodeId: null,
				state: "failed",
				desiredState: "running",
				error: "task: non-zero exit (1)",
			},
		};
		expect(enricher.isSwarmEvent(taskEvent)).toBe(true);
	});
});
