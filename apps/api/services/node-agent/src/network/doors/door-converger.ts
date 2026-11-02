/**
 * Converge this node's doors to the plan — idempotent, one pass per tick.
 *
 * A door is only ever recreated when its HASH changes (image, network, bind address, port or config), so a steady tick
 * touches nothing and a live connection through the door is never cut by a no-op reconcile. Containers not labelled as
 * doors are never removed: a foreign container squatting a door's name is reported, not destroyed.
 */

import { Context, Effect } from "effect";

import { type ContainerSummary, DockerEngine, type DockerEngineShape } from "./docker-engine";
import { type DoorPlan, doorContainerSpec, planDoors } from "./door-config";
import {
	DOOR_HASH_LABEL,
	DOOR_LABEL,
	type AgentDoorView,
	type DoorLane,
	type NodeDoorsSetting,
	doorContainerName,
} from "./doors.types";

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const view = (plan: DoorPlan, state: AgentDoorView["state"], detail: string | null): AgentDoorView => ({
	lane: plan.lane,
	container: plan.name,
	bindAddress: plan.bindAddress,
	port: plan.port,
	state,
	detail,
});

/**
 * Whether a door whose hash matches is still WIRED as planned.
 *
 * The hash covers what the door was built from, not what the engine did with it since. A door that outlived its
 * network (the swarm was reset, the overlay removed) keeps running with NO network and NO published port: nothing
 * listens on the host, every request through the ingress fails, and — because the hash still matches — it was left
 * alone forever. Such a door is recreated. A stopped door is only restarted, as before.
 */
const isIntact = (existing: ContainerSummary, plan: DoorPlan): boolean => {
	if (!existing.running) return true;
	return existing.networks.includes(plan.network) && existing.publishedPorts.includes(`${String(plan.port)}/tcp`);
};

const convergeDoor = (engine: DockerEngineShape, plan: DoorPlan): Effect.Effect<AgentDoorView> =>
	Effect.gen(function* () {
		const existing = yield* engine.inspectContainer(plan.name);
		if (existing !== null && existing.labels[DOOR_LABEL] === undefined) {
			return view(plan, "failed", `a container named ${plan.name} exists and is not a door; remove it to let the agent take over`);
		}
		if (existing !== null && existing.labels[DOOR_HASH_LABEL] === plan.hash && isIntact(existing, plan)) {
			if (!existing.running) yield* engine.startContainer(existing.id);
			return view(plan, "running", null);
		}

		if (!(yield* engine.networkExists(plan.network))) {
			// The overlay is created by the API's ingress supervisor; until it exists on this node there is no Traefik
			// to forward to.
			return view(plan, "absent", `network ${plan.network} is not present on this node yet`);
		}

		// Never START a door onto a port something else holds. The start fails AFTER the container joined the overlay,
		// and the engine's cleanup of that half-joined endpoint leaves the overlay's peer state corrupt: during setup
		// the bootstrap ingress holds the loopback entry port, so retrying every tick cut every other container off the
		// platform network ("no route to host" between traefik, the API and postgres). Wait for the holder to go
		// instead; the next tick re-checks.
		const holder = yield* engine.findPortHolder(plan.bindAddress, plan.port);
		if (holder !== null && holder !== plan.name) {
			return view(plan, "absent", `${plan.bindAddress}:${String(plan.port)} is held by ${holder}; waiting for it to release the port`);
		}

		if (!(yield* engine.imageExists(plan.image))) yield* engine.pullImage(plan.image);
		if (existing !== null) yield* engine.removeContainer(existing.id);

		const id = yield* engine.createContainer(plan.name, doorContainerSpec(plan));
		yield* engine.startContainer(id).pipe(
			Effect.catchTag("DockerEngineError", (error) =>
				// A container that cannot bind its port must not linger and squat the name with a stale hash; the next
				// tick retries from scratch.
				Effect.flatMap(engine.removeContainer(id).pipe(Effect.ignore), () => Effect.fail(error)),
			),
		);
		return view(plan, "running", null);
	}).pipe(Effect.catchTag("DockerEngineError", (error) => Effect.succeed(view(plan, "failed", message(error)))));

const removeDoor = (engine: DockerEngineShape, name: string, lane: DoorLane): Effect.Effect<void> =>
	Effect.gen(function* () {
		const existing = yield* engine.inspectContainer(name).pipe(Effect.catchTag("DockerEngineError", () => Effect.succeed(null)));
		if (existing?.labels[DOOR_LABEL] !== lane) return;
		yield* engine.removeContainer(existing.id).pipe(Effect.ignore);
	});

export type DoorConvergerShape = {
	readonly converge: (
		setting: NodeDoorsSetting | null,
		meshAddress: string | null,
		lanAddress: string | null,
	) => Effect.Effect<AgentDoorView[], never, DockerEngine>;
};

/** One pass over this node's doors; a failure is reported per door, never thrown. */
export class DoorConverger extends Context.Service<DoorConverger, DoorConvergerShape>()("node-agent/DoorConverger") {
	static readonly live = class DoorConvergerImpl implements DoorConvergerShape {
		converge = (setting, meshAddress, lanAddress) =>
			Effect.gen(function* () {
				const views: AgentDoorView[] = [];
				// No plan yet (the API has not published one): leave the node exactly as it is.
				if (setting === null) return views;

				const engine = yield* DockerEngine;
				const { desired, absent } = planDoors(setting, meshAddress, lanAddress);
				for (const plan of desired) views.push(yield* convergeDoor(engine, plan));
				for (const lane of absent) yield* removeDoor(engine, doorContainerName(setting.namePrefix, lane), lane);
				return views;
			})
	};
}
