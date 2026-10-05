import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { BootstrapIngressService } from "./bootstrap-ingress.service";
import type { EnvService } from "@/config/env/env.module";
import type { DockerService } from "@repo/nest-docker/services/docker.service";

/**
 * `releaseEntryPort` is the handover of the host port from setup's bootstrap
 * container to the swarm-managed ingress. The interesting case is not the happy
 * path — it is what happens when the promotion does not happen.
 *
 * The verdict is read from the SERVICE, not from the port. Polling the port
 * asked the wrong question: ownership depends on which process binds first, so
 * after `remove()` the swarm task could lose the race, the poll could time out,
 * and the bootstrap container would be RESTORED — leaving both fighting over :80
 * forever, the swarm task crash-looping with "port is already allocated" while
 * onboarding never completed. Observed exactly that on a restart.
 *
 * The restore is now only the tie-break for a genuinely dead service, and it
 * still decides the verdict: if the restore fails because the port is taken, the
 * swarm won.
 *
 * Observed on a real run before this was handled — setup reported a failed
 * handover while the platform was fully up and serving:
 *
 *   [BootstrapIngressService] The swarm ingress did not claim the entry port...
 *   [HandoverOrchestratorService] Handover failed: (HTTP code 500)
 *     Bind for 0.0.0.0:80 failed: port is already allocated
 */
function makeService(options: { restoreError?: Error; promoted?: boolean } = {}) {
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
	vi.spyOn(
		service as unknown as { waitForSwarmIngressRunning(): Promise<boolean> },
		"waitForSwarmIngressRunning",
	).mockResolvedValue(options.promoted ?? false);
	const create = vi
		.spyOn(service as unknown as { create(): Promise<void> }, "create")
		.mockResolvedValue(undefined);
	if (options.restoreError !== undefined) {
		create.mockRejectedValue(options.restoreError);
	}

	return { service, create };
}

describe("BootstrapIngressService.releaseEntryPort", () => {
	it("reports success when the swarm ingress is running", async () => {
		const { service } = makeService({ promoted: true });

		await expect(service.releaseEntryPort()).resolves.toBe(true);
	});

	it("restores the bootstrap container when the swarm ingress never runs", async () => {
		const { service, create } = makeService({ promoted: false });

		await expect(service.releaseEntryPort()).resolves.toBe(false);
		// The platform must stay reachable while the handover is retryable.
		expect(create).toHaveBeenCalled();
	});

	/**
	 * The race: the service never reported running, but the swarm bound the port
	 * anyway.
	 */
	it("treats a port-taken restore failure as proof the handover succeeded", async () => {
		const { service } = makeService({
			promoted: false,
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
			promoted: false,
			restoreError: new Error("no such image: traefik:v3.6.10"),
		});

		await expect(service.releaseEntryPort()).rejects.toThrow(/no such image/);
	});
});

/**
 * The service-state read itself — the part that replaced the port poll. Driven
 * through the real method, with only the engine call stubbed, because the point
 * of the change is WHICH question is asked.
 */
describe("BootstrapIngressService.waitForSwarmIngressRunning", () => {
	function makeProbe(tasks: unknown[], portAnswers = false) {
		const env = { get: vi.fn(() => "") } as unknown as EnvService;
		const docker = {
			getDockerClient: () => ({}),
			inspectSwarmService: vi.fn().mockResolvedValue({ ID: "svc" }),
			listSwarmServiceTasks: vi.fn().mockResolvedValue(tasks),
		} as unknown as DockerService;
		const service = new BootstrapIngressService(docker, env);
		vi.spyOn(service as unknown as { portAnswers(ms: number): Promise<boolean> }, "portAnswers").mockResolvedValue(
			portAnswers,
		);
		return service;
	}

	it("returns true as soon as a task is running", async () => {
		const service = makeProbe([{ Status: { State: "running" } }]);

		await expect(
			(service as unknown as { waitForSwarmIngressRunning(): Promise<boolean> }).waitForSwarmIngressRunning(),
		).resolves.toBe(true);
	});

	/**
	 * The deadlock this replaced: a crash-looping task is NOT a promotion, and
	 * saying so is what stops the bootstrap container from being restored on top
	 * of a swarm service that still wants the port.
	 */
	it("returns false while the task crashes on the port conflict", async () => {
		const service = makeProbe([
			{
				Status: {
					State: "rejected",
					Err: "Bind for 0.0.0.0:80 failed: port is already allocated",
				},
			},
		]);

		const result = await (
			service as unknown as { waitForSwarmIngressRunning(): Promise<boolean> }
		).waitForSwarmIngressRunning();

		// The budget is 90s; the assertion is that it does NOT report a promotion.
		expect(result).toBe(false);
	}, 120_000);

	/**
	 * The service is created by the API's supervisor AFTER the gate opens, so
	 * "not created yet" is the normal first answer during a handover — not a
	 * fault worth an ERROR log on every run.
	 */
	it("treats a missing service as 'not promoted yet', not as a fault", async () => {
		const env = { get: vi.fn(() => "") } as unknown as EnvService;
		const docker = {
			getDockerClient: () => ({}),
			inspectSwarmService: vi
				.fn()
				.mockRejectedValue(new NotFoundException("Swarm service not found")),
			listSwarmServiceTasks: vi.fn().mockResolvedValue([]),
		} as unknown as DockerService;
		const service = new BootstrapIngressService(docker, env);
		vi.spyOn(service as unknown as { portAnswers(ms: number): Promise<boolean> }, "portAnswers").mockResolvedValue(
			false,
		);

		await expect(
			(service as unknown as { waitForSwarmIngressRunning(): Promise<boolean> }).waitForSwarmIngressRunning(),
		).resolves.toBe(false);
		// The task listing must NOT be reached: that is what logged the 404 as an error.
		expect(docker.listSwarmServiceTasks).not.toHaveBeenCalled();
	}, 120_000);
});
