/**
 * The node's mesh agent as a swarm GLOBAL service — the opt-in shape of the agent's deployment.
 *
 * Everything the agent IS lives in `@deployer/node-agent-container` and `node-agent-swarm-spec.ts`; this
 * supervisor only decides where it runs and keeps it there. It converges the service, removes a
 * platform-managed host container it is replacing (two owners would fight for the run volume's socket and
 * the host's `deployer-mesh` interface), and reports whether THIS node's task is running.
 *
 * The default remains the host container: the agent must exist before Swarm. See
 * `docs/architecture/node-agent-service.md`.
 */
import { Effect } from "effect";

import type { SwarmServiceSpecInput } from "@deployer/contracts-entities";
import {
	resolveSupervisorRuntime,
	type DockerEngineShape,
	type DockerError,
} from "@deployer/docker";
import { NODE_AGENT_CONTAINER_NAME, NODE_AGENT_ROLE, NODE_AGENT_ROLE_LABEL } from "@deployer/node-agent-container";
import { withBackoff, type ProbeResult, type SupervisorSpec } from "@deployer/supervision";

import { SupervisedResourceMissing, SupervisedResourceUnavailable } from "../errors";
import { makeSwarmServiceOps } from "../swarm-service/swarm-service-ops";

import { nodeAgentSwarmSpec } from "./node-agent-swarm-spec";
import {
	NODE_AGENT_SWARM_SUPERVISOR_ID,
	nodeAgentSwarmProcessInfoSchema,
	nodeAgentSwarmSupervisorPayloadSchema,
	type NodeAgentSwarmSupervisorPayload,
} from "./schemas";

export type NodeAgentSwarmConfig = {
	/** The agent's swarm service name (`deployer-node-agent-swarm[-<prefix>]`). */
	readonly serviceName: () => string;
	readonly image: () => string;
	/** The `SUPERVISOR_RUNTIME` override. */
	readonly runtimeOverride: () => string | undefined;
};

export type NodeAgentSwarmDeps = {
	readonly engine: DockerEngineShape;
	readonly config: NodeAgentSwarmConfig;
	readonly logger: { readonly log: (message: string) => void; readonly warn: (message: string) => void };
};

export type NodeAgentSwarmSupervisor = {
	readonly spec: SupervisorSpec<typeof nodeAgentSwarmSupervisorPayloadSchema, typeof nodeAgentSwarmProcessInfoSchema>;
	/** What the supervisor would schedule now; the registration test and the process view read it. */
	readonly desiredSpec: () => SwarmServiceSpecInput;
};

/** This node's task state, or null when the service has no task here (or cannot be listed). */
type LocalTask = { readonly serviceId: string | null; readonly state: string };

export function makeNodeAgentSwarmSupervisor({ engine, config, logger }: NodeAgentSwarmDeps): NodeAgentSwarmSupervisor {
	const ops = makeSwarmServiceOps(engine);
	const desiredSpec = (): SwarmServiceSpecInput => nodeAgentSwarmSpec({ name: config.serviceName(), image: config.image() });

	const payload = (
		startedAt: number,
		fields: Partial<Pick<NodeAgentSwarmSupervisorPayload, "service" | "taskState">> = {},
	): NodeAgentSwarmSupervisorPayload => ({
		checkedAt: new Date().toISOString(),
		latencyMs: Date.now() - startedAt,
		runtime: "swarm-global",
		taskState: fields.taskState ?? null,
		service: fields.service ?? null,
	});

	/**
	 * Removes the host container this service replaces. Only when it carries the agent's role label: a
	 * container squatting the name that the platform did not start is left alone (as the container path
	 * refuses to replace it). Best effort — if it cannot be removed the task reports why instead.
	 */
	const releaseHostContainer: Effect.Effect<void> = Effect.suspend(() =>
		engine.containers.inspect(NODE_AGENT_CONTAINER_NAME).pipe(
			Effect.flatMap((container) =>
				container.Config.Labels?.[NODE_AGENT_ROLE_LABEL] === NODE_AGENT_ROLE
					? engine.containers.removeIfExists(NODE_AGENT_CONTAINER_NAME).pipe(
							Effect.tap(() =>
								Effect.sync(() => {
									logger.log(`Removed the host ${NODE_AGENT_CONTAINER_NAME} container — the swarm service now owns this node's agent`);
								}),
							),
						)
					: Effect.void,
			),
			Effect.catchTag("DockerNotFound", () => Effect.void),
			Effect.catch((error) =>
				Effect.sync(() => {
					logger.warn(`Host mesh agent container not removed (${error instanceof Error ? error.message : String(error)}) — it and the swarm task would fight for the node's interface`);
				}),
			),
		),
	);

	const converge: Effect.Effect<void, unknown> = Effect.gen(function* () {
		const { runtime } = resolveSupervisorRuntime({
			managed: false,
			rawRuntime: config.runtimeOverride(),
			swarmActive: yield* engine.swarmCluster.isActive(),
			scope: "node-local",
		});
		if (runtime === "unavailable") {
			return yield* Effect.fail(
				new SupervisedResourceUnavailable({
					resource: "Mesh agent (swarm)",
					reason: "requires an active swarm engine — NODE_AGENT_SWARM_MODE is for clusters; the host container is the pre-swarm shape",
				}),
			);
		}

		yield* withBackoff(
			"Mesh agent (swarm) convergence",
			Effect.gen(function* () {
				yield* releaseHostContainer;
				const spec = desiredSpec();
				yield* engine.swarmServices.reconcile(spec);
				const service = yield* engine.swarmServices.inspect(spec.name);
				if (service.ID === "") {
					return yield* Effect.fail(new SupervisedResourceMissing({ resource: `mesh agent swarm service '${spec.name}'` }));
				}
			}),
			{ maxAttempts: 5 },
		);
	});

	/** Health: THIS node's task runs. Another node's task being down is not this node's problem. */
	const localTask = (serviceName: string): Effect.Effect<LocalTask | null, DockerError> =>
		Effect.gen(function* () {
			const service = yield* engine.swarmServices.inspect(serviceName);
			const tasks = yield* engine.swarmServices.listTasks(serviceName).pipe(Effect.orElseSucceed(() => []));
			const selfNodeId = yield* engine.swarmCluster
				.info()
				.pipe(Effect.map((info) => (info.NodeID === "" ? null : info.NodeID)), Effect.orElseSucceed(() => null));
			const local = selfNodeId === null ? tasks[0] : tasks.find((task) => task.NodeID === selfNodeId);
			return local === undefined ? null : { serviceId: service.ID ?? null, state: local.Status.State };
		}).pipe(Effect.orElseSucceed(() => null));

	const probe: Effect.Effect<ProbeResult<NodeAgentSwarmSupervisorPayload>, unknown> = Effect.gen(function* () {
		const startedAt = Date.now();
		const serviceName = config.serviceName();
		const task = yield* localTask(serviceName);
		const healthy = task?.state === "running";
		return {
			healthy,
			...(healthy ? {} : { detail: `mesh agent task on this node is ${task?.state ?? "missing"}` }),
			payload: payload(startedAt, {
				taskState: task?.state ?? null,
				service: task === null ? null : { id: task.serviceId ?? "", name: serviceName, runningTasks: healthy ? 1 : 0, exists: true },
			}),
		};
	});

	const spec: SupervisorSpec<typeof nodeAgentSwarmSupervisorPayloadSchema, typeof nodeAgentSwarmProcessInfoSchema> = {
		id: NODE_AGENT_SWARM_SUPERVISOR_ID,
		description: "Mesh agent (one task per node: the node's WireGuard interface, doors and roster)",
		payloadSchema: nodeAgentSwarmSupervisorPayloadSchema,
		processInfoSchema: nodeAgentSwarmProcessInfoSchema,
		converge,
		probe,
		degradedPayload: () => payload(Date.now()),
		processInfo: ops.describeProcess(desiredSpec()).pipe(Effect.map((process) => ({ process }))),
		blocker: engine.swarmCluster.isActive().pipe(Effect.map((active) => (active ? null : "deferred until an active swarm exists — the agent's host container is the pre-swarm shape"))),
	};

	return { spec, desiredSpec };
}
