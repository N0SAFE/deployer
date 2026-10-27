/**
 * Converge this node's doors to the plan — idempotent, one pass per tick.
 *
 * A door is only ever recreated when its HASH changes (image, network, bind
 * address, port or config), so a steady tick touches nothing and a live connection
 * through the door is never cut by a no-op reconcile. Containers not labelled as
 * doors are never removed: a foreign container squatting a door's name is reported,
 * not destroyed.
 */

import { doorContainerName, type AgentDoorView, type DoorLane, type NodeDoorsSetting } from "@deployer/mesh-network";

import { DOOR_HASH_LABEL, DOOR_LABEL, doorContainerSpec, planDoors, type DoorPlan } from "./door-config";
import type { ContainerSummary, DockerEngine } from "./docker-engine";

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class DoorConverger {
	constructor(private readonly engine: DockerEngine) {}

	async converge(setting: NodeDoorsSetting | null, meshAddress: string | null, lanAddress: string | null): Promise<AgentDoorView[]> {
		// No plan yet (the API has not published one): leave the node exactly as it is.
		if (setting === null) return [];

		const { desired, absent } = planDoors(setting, meshAddress, lanAddress);
		const views: AgentDoorView[] = [];
		for (const plan of desired) views.push(await this.convergeDoor(plan));
		for (const lane of absent) await this.removeDoor(doorContainerName(setting.namePrefix, lane), lane);
		return views;
	}

	private view(plan: DoorPlan, state: AgentDoorView["state"], detail: string | null): AgentDoorView {
		return { lane: plan.lane, container: plan.name, bindAddress: plan.bindAddress, port: plan.port, state, detail };
	}

	private async convergeDoor(plan: DoorPlan): Promise<AgentDoorView> {
		try {
			const existing = await this.engine.inspectContainer(plan.name);
			if (existing !== null && existing.labels[DOOR_LABEL] === undefined) {
				return this.view(plan, "failed", `a container named ${plan.name} exists and is not a door; remove it to let the agent take over`);
			}
			if (existing !== null && existing.labels[DOOR_HASH_LABEL] === plan.hash && this.isIntact(existing, plan)) {
				if (!existing.running) await this.engine.startContainer(existing.id);
				return this.view(plan, "running", null);
			}

			if (!(await this.engine.networkExists(plan.network))) {
				// The overlay is created by the API's ingress supervisor; until it exists
				// on this node there is no Traefik to forward to.
				return this.view(plan, "absent", `network ${plan.network} is not present on this node yet`);
			}

			// Never START a door onto a port something else holds. The start fails
			// AFTER the container joined the overlay, and the engine's cleanup of that
			// half-joined endpoint leaves the overlay's peer state corrupt: during
			// setup the bootstrap ingress holds the loopback entry port, so retrying
			// every tick cut every other container off the platform network
			// ("no route to host" between traefik, the API and postgres). Wait for the
			// holder to go instead; the next tick re-checks.
			const holder = await this.engine.findPortHolder(plan.bindAddress, plan.port);
			if (holder !== null && holder !== plan.name) {
				return this.view(plan, "absent", `${plan.bindAddress}:${String(plan.port)} is held by ${holder}; waiting for it to release the port`);
			}

			if (!(await this.engine.imageExists(plan.image))) await this.engine.pullImage(plan.image);
			if (existing !== null) await this.engine.removeContainer(existing.id);

			const id = await this.engine.createContainer(plan.name, doorContainerSpec(plan));
			try {
				await this.engine.startContainer(id);
			} catch (error) {
				// A container that cannot bind its port must not linger and squat the
				// name with a stale hash; the next tick retries from scratch.
				await this.engine.removeContainer(id).catch(() => undefined);
				throw error;
			}
			return this.view(plan, "running", null);
		} catch (error) {
			return this.view(plan, "failed", message(error));
		}
	}

	/**
	 * Whether a door whose hash matches is still WIRED as planned.
	 *
	 * The hash covers what the door was built from, not what the engine did with it
	 * since. A door that outlived its network (the swarm was reset, the overlay
	 * removed) keeps running with NO network and NO published port: nothing listens
	 * on the host, every request through the ingress fails, and — because the hash
	 * still matches — it was left alone forever. Such a door is recreated.
	 * A stopped door is only restarted, as before.
	 */
	private isIntact(existing: ContainerSummary, plan: DoorPlan): boolean {
		if (!existing.running) return true;
		return existing.networks.includes(plan.network) && existing.publishedPorts.includes(`${String(plan.port)}/tcp`);
	}

	private async removeDoor(name: string, lane: DoorLane): Promise<void> {
		const existing = await this.engine.inspectContainer(name).catch(() => null);
		if (existing?.labels[DOOR_LABEL] !== lane) return;
		await this.engine.removeContainer(existing.id).catch(() => undefined);
	}
}

