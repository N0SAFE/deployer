import { Cause, Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";

import { makeDockerEngine } from "./docker-engine";
import { DockerConflict, DockerInvalid, DockerNotFound } from "../errors/errors";

/** Run an Effect and reject with the ORIGINAL failure, so assertions read the real error. */
async function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
	const exit = await Effect.runPromiseExit(effect);
	if (Exit.isSuccess(exit)) return exit.value;
	throw Cause.squash(exit.cause);
}

const notFound = () => Object.assign(new Error("no such thing"), { statusCode: 404 });

function fakeClient(overrides: Record<string, unknown> = {}) {
	const container = {
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		remove: vi.fn().mockResolvedValue(undefined),
		pause: vi.fn().mockResolvedValue(undefined),
		inspect: vi.fn().mockResolvedValue({ State: { Status: "running" } }),
	};
	const client = {
		getContainer: vi.fn(() => container),
		getImage: vi.fn(() => ({ inspect: vi.fn().mockResolvedValue({}) })),
		createContainer: vi.fn().mockResolvedValue({ id: "container-1" }),
		listContainers: vi.fn().mockResolvedValue([]),
		pull: vi.fn().mockResolvedValue({}),
		modem: {
			followProgress: vi.fn((_s: unknown, done: (e: Error | null) => void) => {
				done(null);
			}),
		},
		getNetwork: vi.fn(),
		createNetwork: vi.fn().mockResolvedValue({}),
		getService: vi.fn(),
		...overrides,
	};
	return { client, container, engine: makeDockerEngine(client as never) };
}

describe("DockerEngine.containers", () => {
	it("creates a container without pulling when the image is present, dropping non-engine options", async () => {
		const { client, engine } = fakeClient();

		const created = await run(
			engine.containers.create({ Image: "nginx:alpine", name: "web", imagePullPolicy: "IfNotPresent" }),
		);

		expect(created).toEqual({ id: "container-1" });
		expect(client.pull).not.toHaveBeenCalled();
		expect(client.createContainer).toHaveBeenCalledWith({ Image: "nginx:alpine", name: "web" });
	});

	it("pulls a missing image before creating", async () => {
		const { client, engine } = fakeClient({
			getImage: vi.fn(() => ({ inspect: vi.fn().mockRejectedValue(notFound()) })),
		});

		await run(engine.containers.create({ Image: "app:1" }));

		expect(client.pull).toHaveBeenCalledWith("app:1", expect.objectContaining({ abortSignal: expect.any(AbortSignal) }));
		expect(client.createContainer).toHaveBeenCalledTimes(1);
	});

	it("refuses to pull under the Never policy", async () => {
		const { client, engine } = fakeClient({
			getImage: vi.fn(() => ({ inspect: vi.fn().mockRejectedValue(notFound()) })),
		});

		await expect(run(engine.containers.create({ Image: "app:1", imagePullPolicy: "Never" }))).rejects.toBeInstanceOf(
			DockerInvalid,
		);
		expect(client.createContainer).not.toHaveBeenCalled();
	});

	it("treats starting a running container as started", async () => {
		const { container, engine } = fakeClient();
		container.start.mockRejectedValue(Object.assign(new Error("(HTTP code 304) container already started"), { statusCode: 304 }));

		await expect(run(engine.containers.start("c1"))).resolves.toBeUndefined();
	});

	it("treats removing a missing container as removed", async () => {
		const { container, engine } = fakeClient();
		container.inspect.mockRejectedValue(notFound());

		await expect(run(engine.containers.remove("gone"))).resolves.toBeUndefined();
		expect(container.remove).not.toHaveBeenCalled();
	});

	it("stops a running container before removing it", async () => {
		const { container, engine } = fakeClient();

		await run(engine.containers.remove("c1"));

		expect(container.stop).toHaveBeenCalledWith({ t: 10 });
		expect(container.remove).toHaveBeenCalledWith({ force: true, v: true });
	});

	it("reports healthy once the container runs, and unhealthy when the probes run out", async () => {
		const { container, engine } = fakeClient();
		expect(await run(engine.containers.waitForHealth("c1", { maxRetries: 2, retryIntervalMs: 1 }))).toBe(true);

		container.inspect.mockResolvedValue({ State: { Status: "exited" } });
		expect(await run(engine.containers.waitForHealth("c1", { maxRetries: 2, retryIntervalMs: 1 }))).toBe(false);
	});
});

describe("DockerEngine.swarmServices", () => {
	it("fails with DockerNotFound when the service is missing", async () => {
		const { engine } = fakeClient({ getService: vi.fn(() => ({ inspect: vi.fn().mockRejectedValue(notFound()) })) });

		await expect(run(engine.swarmServices.inspect("web"))).rejects.toBeInstanceOf(DockerNotFound);
	});

	it("treats removing a missing service as removed", async () => {
		const { engine } = fakeClient({ getService: vi.fn(() => ({ remove: vi.fn().mockRejectedValue(notFound()) })) });

		await expect(run(engine.swarmServices.remove("web"))).resolves.toBeUndefined();
	});
});

describe("DockerEngine.networks", () => {
	const request = {
		name: "deployer-p1",
		driver: "overlay",
		attachable: true,
		ingress: false,
		labels: {},
		enableIpv6: false,
	} as never;

	it("creates the overlay when none exists", async () => {
		const { client, engine } = fakeClient({
			getNetwork: vi.fn(() => ({ inspect: vi.fn().mockRejectedValue(notFound()) })),
		});

		await run(engine.networks.ensureOverlay(request));

		expect(client.createNetwork).toHaveBeenCalledWith(expect.objectContaining({ Name: "deployer-p1", Driver: "overlay" }));
	});

	it("reuses an existing overlay", async () => {
		const { client, engine } = fakeClient({
			getNetwork: vi.fn(() => ({ inspect: vi.fn().mockResolvedValue({ Driver: "overlay" }) })),
		});

		await run(engine.networks.ensureOverlay(request));

		expect(client.createNetwork).not.toHaveBeenCalled();
	});

	it("refuses a same-named network that is not an overlay", async () => {
		const { engine } = fakeClient({
			getNetwork: vi.fn(() => ({ inspect: vi.fn().mockResolvedValue({ Driver: "bridge" }) })),
		});

		await expect(run(engine.networks.ensureOverlay(request))).rejects.toBeInstanceOf(DockerConflict);
	});
});

describe("DockerEngine.containers (state changes)", () => {
	it("treats pausing a paused container as paused", async () => {
		const { container, engine } = fakeClient();
		container.pause.mockRejectedValue(new Error("Container is already paused"));

		await expect(run(engine.containers.pause("c1"))).resolves.toBeUndefined();
	});

	it("fails stopping a container the engine cannot find", async () => {
		const { container, engine } = fakeClient();
		container.stop.mockRejectedValue(notFound());

		await expect(run(engine.containers.stop("c1"))).rejects.toBeInstanceOf(DockerNotFound);
	});

	it("reports health from the engine's healthcheck", async () => {
		const { container, engine } = fakeClient();
		container.inspect.mockResolvedValue({ State: { Status: "running", Health: { Status: "unhealthy" } } });
		expect(await run(engine.containers.isHealthy("c1"))).toBe(false);

		container.inspect.mockResolvedValue({ State: { Status: "running" } });
		expect(await run(engine.containers.isHealthy("c1"))).toBe(true);
	});

	it("reports an unreadable container as unknown instead of failing", async () => {
		const { container, engine } = fakeClient();
		container.inspect.mockRejectedValue(new Error("boom"));

		expect((await run(engine.containers.health("c1"))).status).toBe("unknown");
	});
});

describe("DockerEngine.networks.recreateOverlay", () => {
	it("picks a VXLAN id above every one in use or poisoned", async () => {
		const network = {
			inspect: vi.fn().mockRejectedValue(notFound()),
			remove: vi.fn(),
			disconnect: vi.fn(),
		};
		const { client, engine } = fakeClient({
			getNetwork: vi.fn(() => network),
			listNetworks: vi.fn().mockResolvedValue([
				{ Options: { "com.docker.network.driver.overlay.vxlanid_list": "4100" } },
			]),
		});

		const result = await run(
			engine.networks.recreateOverlay(
				{ name: "deployer-p1", driver: "overlay", attachable: true, ingress: false, labels: {}, enableIpv6: false },
				{ avoidVxlanIds: [4200] },
			),
		);

		expect(result.vxlanId).toBe(4201);
		expect(client.createNetwork).toHaveBeenCalledWith(
			expect.objectContaining({ Options: { "com.docker.network.driver.overlay.vxlanid_list": "4201" } }),
		);
	});
});

describe("DockerEngine.swarmSecrets", () => {
	it("sends the data base64-encoded", async () => {
		const createSecret = vi.fn().mockResolvedValue({ ID: "s1" });
		const { engine } = fakeClient({ createSecret });

		await run(engine.swarmSecrets.create({ name: "db", data: "hunter2" })).catch(() => undefined);

		expect(createSecret).toHaveBeenCalledWith({ Name: "db", Data: Buffer.from("hunter2").toString("base64"), Labels: {} });
	});
});

describe("DockerEngine.exec", () => {
	function execClient(options: { raw: unknown; exitCode: number }) {
		const exec = {
			start: vi.fn().mockResolvedValue(options.raw),
			inspect: vi.fn().mockResolvedValue({ ExitCode: options.exitCode }),
		};
		const container = { exec: vi.fn().mockResolvedValue(exec) };
		return makeDockerEngine({ getContainer: () => container, modem: { demuxStream: vi.fn() } } as never);
	}

	it("returns the output of a command that succeeds", async () => {
		const engine = execClient({ raw: "done\n", exitCode: 0 });

		expect(await run(engine.exec.run("c1", ["echo", "done"]))).toEqual({ exitCode: 0, output: "done\n" });
	});

	it("fails run, but not capture, on a non-zero exit", async () => {
		const engine = execClient({ raw: "found 3 vulnerabilities", exitCode: 1 });

		await expect(run(engine.exec.run("c1", ["grype"]))).rejects.toThrow(/exit code 1/);
		expect(await run(engine.exec.capture("c1", ["grype"]))).toEqual({ exitCode: 1, output: "found 3 vulnerabilities" });
	});

	it("reports a command that could not start as exit -1 from capture", async () => {
		const container = { exec: vi.fn().mockRejectedValue(new Error("no such container")) };
		const engine = makeDockerEngine({ getContainer: () => container } as never);

		expect(await run(engine.exec.capture("c1", ["ls"]))).toEqual({ exitCode: -1, output: expect.stringContaining("no such container") });
	});
});
