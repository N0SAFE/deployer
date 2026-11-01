import { DockerEngine } from "@deployer/docker";
import type { DockerContainer } from "@deployer/contracts-entities";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { RuntimeDb, RuntimeDatabasePort } from "../../../../../core/database/runtime-db";
import { DockerContainerLinks } from "../../../repositories/containers/links/docker-container-links";
import { DockerContainerLinksLookup } from "../../../repositories/containers/links/docker-container-links-lookup.repository";
import { ContainersLocalPort, ContainersMeshPort, DockerContainerResolution } from "./docker-container-resolution";
import { DockerContainersOrchestratorService } from "./docker-containers-orchestrator.service";

/**
 * CLUSTER-004: the dashboard must not be able to take a platform service down.
 *
 * The supervisor owns each platform container, so a `stop`/`kill`/`remove` from the UI succeeds silently from the
 * caller's point of view and leaves the platform without ingress, database or agent. Starting and unpausing stay
 * allowed — recovery is exactly when an operator needs them.
 *
 * No app runtime is constructed: the fake engine arrives as a service in the Effect context.
 */
const engineOver = (labels: Record<string, string>, calls: Map<string, unknown[]>) => {
	const record =
		(name: string) =>
		(...args: unknown[]) =>
			Effect.sync(() => {
				calls.set(name, args);
			});

	return {
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
	} as never;
};

const runAction = (action: string, engine: never, containerId = "traefik") =>
	Effect.runPromise(
		DockerContainersOrchestratorService.live
			.runContainerAction({ containerId, action } as never)
			.pipe(Effect.provideService(DockerEngine, engine)),
	);

describe("DockerContainersOrchestratorService.runContainerAction", () => {
	it.each(["stop", "restart", "pause", "kill", "remove"] as const)(
		"refuses %s on a platform-managed container",
		async (action) => {
			const calls = new Map<string, unknown[]>();
			const engine = engineOver({ "deployer.platform.role": "traefik" }, calls);

			await expect(runAction(action, engine)).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
			expect(calls.has(action)).toBe(false);
		},
	);

	it("still allows starting a platform container: that is recovery, not destruction", async () => {
		const calls = new Map<string, unknown[]>();
		const engine = engineOver({ "deployer.platform.role": "traefik" }, calls);

		await expect(runAction("start", engine)).resolves.toMatchObject({
			ok: true,
			action: "start",
		});
		expect(calls.get("start")).toEqual(["traefik"]);
	});

	it("leaves a container the platform does not own alone", async () => {
		const calls = new Map<string, unknown[]>();
		const engine = engineOver({ "com.example.app": "shop" }, calls);

		await expect(runAction("kill", engine, "shop")).resolves.toMatchObject({
			ok: true,
			action: "kill",
		});
		expect(calls.get("kill")).toEqual(["shop"]);
	});
});

describe("DockerContainersOrchestratorService.listContainersLinked", () => {
	it("resolves containers and attaches links with no app runtime in the construction", async () => {
		const containers = [{ id: "ctr-1", name: "shop" }] as unknown as DockerContainer[];
		const meta = { total: 1, limit: 10, offset: 0, hasMore: false };
		const attach = vi.fn((rows: readonly DockerContainer[]) => Effect.succeed(rows));

		const effect = DockerContainersOrchestratorService.live
			.listContainersLinked({ limit: 10, offset: 0, maxDepth: 1 } as never, "admin")
			.pipe(
				Effect.provideService(
					DockerContainerResolution,
					{ listContainers: () => Effect.succeed({ data: containers, meta }) } as never,
				),
				Effect.provideService(DockerContainerLinks, { attach } as never),
				// The resolution and links tags carry their port types in `R`; the fakes above are what actually run, so
				// these ports are never touched. Providing them keeps the program honest about its type without a runtime.
				Effect.provideService(ContainersMeshPort, {} as never),
				Effect.provideService(ContainersLocalPort, {} as never),
				Effect.provideService(DockerContainerLinksLookup, {} as never),
				Effect.provideService(RuntimeDb, {} as never),
				Effect.provideService(RuntimeDatabasePort, {} as never),
			);

		const result = await Effect.runPromise(effect);

		expect(result.meta).toEqual(meta);
		expect(result.data).toEqual(containers);
		expect(attach).toHaveBeenCalledWith(containers, [], "admin");
	});
});
