import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { DockerContainersOrchestratorService } from "./docker-containers-orchestrator.service";

/**
 * CLUSTER-004: the dashboard must not be able to take a platform service down.
 *
 * The supervisor owns each platform container, so a `stop`/`kill`/`remove` from the UI succeeds silently from the
 * caller's point of view and leaves the platform without ingress, database or agent. Starting and unpausing stay
 * allowed — recovery is exactly when an operator needs them.
 */
const orchestratorOver = (labels: Record<string, string>, calls: Map<string, unknown[]>) => {
	const record =
		(name: string) =>
		(...args: unknown[]) =>
			Effect.sync(() => {
				calls.set(name, args);
			});

	return new DockerContainersOrchestratorService({} as never, {
		containers: {
			inspect: () => Effect.succeed({ Config: { Labels: labels } }),
			start: record("start"),
			unpause: record("unpause"),
			stop: record("stop"),
			restart: record("restart"),
			pause: record("pause"),
			kill: record("kill"),
			remove: record("remove"),
		},
	} as never);
};

describe("DockerContainersOrchestratorService.runContainerAction", () => {
	it.each(["stop", "restart", "pause", "kill", "remove"] as const)(
		"refuses %s on a platform-managed container",
		async (action) => {
			const calls = new Map<string, unknown[]>();
			const orchestrator = orchestratorOver({ "deployer.platform.role": "traefik" }, calls);

			await expect(orchestrator.runContainerAction({ containerId: "traefik", action } as never)).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
			expect(calls.has(action)).toBe(false);
		},
	);

	it("still allows starting a platform container: that is recovery, not destruction", async () => {
		const calls = new Map<string, unknown[]>();
		const orchestrator = orchestratorOver({ "deployer.platform.role": "traefik" }, calls);

		await expect(orchestrator.runContainerAction({ containerId: "traefik", action: "start" } as never)).resolves.toMatchObject({
			ok: true,
			action: "start",
		});
		expect(calls.get("start")).toEqual(["traefik"]);
	});

	it("leaves a container the platform does not own alone", async () => {
		const calls = new Map<string, unknown[]>();
		const orchestrator = orchestratorOver({ "com.example.app": "shop" }, calls);

		await expect(orchestrator.runContainerAction({ containerId: "shop", action: "kill" } as never)).resolves.toMatchObject({
			ok: true,
			action: "kill",
		});
		expect(calls.get("kill")).toEqual(["shop"]);
	});
});
