import { describe, expect, it, vi } from "vitest";

import { BootstrapIngressService } from "./bootstrap-ingress.service";
import type { EnvService } from "@/config/env/env.module";
import type { DockerService } from "@repo/nest-docker/services/docker.service";

/**
 * `releaseEntryPort` is the handover of the host port from setup's bootstrap
 * container to the swarm-managed ingress. The interesting case is not the happy
 * path — it is what happens when the poll MISSES.
 *
 * The wait is a poll with a budget, so a swarm task that binds the port a second
 * after the budget expires is indistinguishable from one that never binds it.
 * Restoring the bootstrap container is the tie-break, and IT is what decides the
 * verdict: if the restore fails because the port is taken, the swarm won.
 *
 * Observed on a real run before this was handled — setup reported a failed
 * handover while the platform was fully up and serving:
 *
 *   [BootstrapIngressService] The swarm ingress did not claim the entry port...
 *   [HandoverOrchestratorService] Handover failed: (HTTP code 500)
 *     Bind for 0.0.0.0:80 failed: port is already allocated
 */
function makeService(options: { restoreError?: Error; portTaken?: boolean } = {}) {
	const env = {
		get: vi.fn((key: string) =>
			key === "DEPLOYER_PREFIX" ? "" : key === "DEPLOYER_TRAEFIK_HTTP_PORT" ? 80 : undefined,
		),
	} as unknown as EnvService;

	const docker = {
		getDockerClient: () => ({}),
	} as unknown as DockerService;

	const service = new BootstrapIngressService(docker, env);

	// `inspect()` returning a value models "the bootstrap container exists".
	vi.spyOn(service as unknown as { inspect(): Promise<unknown> }, "inspect").mockResolvedValue({
		running: true,
	});
	vi.spyOn(service as unknown as { remove(): Promise<void> }, "remove").mockResolvedValue(undefined);
	vi.spyOn(service as unknown as { waitForPortTaken(): Promise<boolean> }, "waitForPortTaken").mockResolvedValue(
		options.portTaken ?? false,
	);
	const create = vi
		.spyOn(service as unknown as { create(): Promise<void> }, "create")
		.mockResolvedValue(undefined);
	if (options.restoreError !== undefined) {
		create.mockRejectedValue(options.restoreError);
	}

	return { service, create };
}

describe("BootstrapIngressService.releaseEntryPort", () => {
	it("reports success when the swarm claims the port within the poll window", async () => {
		const { service } = makeService({ portTaken: true });

		await expect(service.releaseEntryPort()).resolves.toBe(true);
	});

	it("restores the bootstrap container when nothing takes the port", async () => {
		const { service, create } = makeService({ portTaken: false });

		await expect(service.releaseEntryPort()).resolves.toBe(false);
		// The platform must stay reachable while the handover is retryable.
		expect(create).toHaveBeenCalled();
	});

	/**
	 * The race: the poll expired, but the swarm bound the port anyway.
	 */
	it("treats a port-taken restore failure as proof the handover succeeded", async () => {
		const { service } = makeService({
			portTaken: false,
			restoreError: new Error(
				"failed to set up container networking: driver failed programming external " +
					"connectivity on endpoint deployer-traefik: Bind for 0.0.0.0:80 failed: " +
					"port is already allocated",
			),
		});

		// Success, NOT a failed handover — the swarm owns the port, which is the
		// outcome the handover was trying to achieve.
		await expect(service.releaseEntryPort()).resolves.toBe(true);
	});

	it("still propagates an unrelated restore failure", async () => {
		// A genuine fault must not be silently reinterpreted as success.
		const { service } = makeService({
			portTaken: false,
			restoreError: new Error("no such image: traefik:v3.6.10"),
		});

		await expect(service.releaseEntryPort()).rejects.toThrow(/no such image/);
	});
});
