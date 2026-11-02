import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

const docker = vi.hoisted(() => {
	const client = {
		getContainer: vi.fn(),
		getImage: vi.fn(),
		getNetwork: vi.fn(),
		createContainer: vi.fn(),
		pull: vi.fn(),
		listContainers: vi.fn(),
	};
	// Typed with the option dockerode receives, so the assertion below can read it.
	return { client, constructor: vi.fn((_options?: unknown) => client) };
});

// dockerode is constructed with `new`; the fake records the options and hands back the recorded client.
vi.mock("dockerode", () => ({
	default: function DockerMock(options: unknown) {
		docker.constructor(options);
		return docker.client;
	},
}));

const { SocketDockerEngine } = await import("./docker-engine");

const engine = () => SocketDockerEngine.live("/var/run/docker.sock");
const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);

/** dockerode rejects with an `Error` carrying the engine's status and JSON body. */
const refusal = (statusCode: number, message: string) =>
	Object.assign(new Error(message), { statusCode, json: { message } });

describe("SocketDockerEngine", () => {
	it("opens the engine through dockerode on the socket it is given", () => {
		engine();

		expect(docker.constructor).toHaveBeenCalledWith({ socketPath: "/var/run/docker.sock" });
	});

	it("maps an inspected container onto the summary the converger reads", async () => {
		const inspect = vi.fn().mockResolvedValue({
			Id: "abc",
			State: { Running: true },
			Config: { Labels: { "deployer.role": "door" } },
			NetworkSettings: {
				Networks: { bridge: {}, deployer_mesh: {} },
				Ports: { "80/tcp": [{ HostPort: "8080" }], "443/tcp": null },
			},
		});
		docker.client.getContainer.mockReturnValue({ inspect });

		await expect(run(engine().inspectContainer("door"))).resolves.toEqual({
			id: "abc",
			running: true,
			labels: { "deployer.role": "door" },
			networks: ["bridge", "deployer_mesh"],
			publishedPorts: ["80/tcp"],
		});
		expect(docker.client.getContainer).toHaveBeenCalledWith("door");
	});

	it("answers null, not a failure, when the container does not exist", async () => {
		docker.client.getContainer.mockReturnValue({ inspect: vi.fn().mockRejectedValue(refusal(404, "No such container")) });

		await expect(run(engine().inspectContainer("gone"))).resolves.toBeNull();
	});

	it("keeps the engine's own message and status on a real refusal", async () => {
		docker.client.getContainer.mockReturnValue({ inspect: vi.fn().mockRejectedValue(refusal(500, "engine exploded")) });

		await expect(run(engine().inspectContainer("door"))).rejects.toMatchObject({ status: 500, message: "engine exploded" });
	});

	it("creates a container with the name dockerode expects and answers its id", async () => {
		docker.client.createContainer.mockResolvedValue({ id: "new-id" });

		await expect(
			run(engine().createContainer("door", { Image: "nginx:alpine", HostConfig: { NetworkMode: "host" } })),
		).resolves.toBe("new-id");
		expect(docker.client.createContainer).toHaveBeenCalledWith({
			Image: "nginx:alpine",
			HostConfig: { NetworkMode: "host" },
			name: "door",
		});
	});

	it("treats an already-running start and an already-removed container as done", async () => {
		docker.client.getContainer.mockReturnValue({
			start: vi.fn().mockRejectedValue(refusal(304, "container already started")),
			remove: vi.fn().mockRejectedValue(refusal(404, "No such container")),
		});

		await expect(run(engine().startContainer("abc"))).resolves.toBeUndefined();
		await expect(run(engine().removeContainer("abc"))).resolves.toBeUndefined();
		expect(docker.client.getContainer().remove).toHaveBeenCalledWith({ force: true });
	});

	it("answers existence from the engine, and false on a 404", async () => {
		docker.client.getImage.mockReturnValueOnce({ inspect: vi.fn().mockResolvedValue({}) });
		docker.client.getImage.mockReturnValueOnce({ inspect: vi.fn().mockRejectedValue(refusal(404, "no such image")) });
		docker.client.getNetwork.mockReturnValue({ inspect: vi.fn().mockRejectedValue(refusal(404, "no such network")) });

		await expect(run(engine().imageExists("nginx:alpine"))).resolves.toBe(true);
		await expect(run(engine().imageExists("missing:tag"))).resolves.toBe(false);
		await expect(run(engine().networkExists("deployer_mesh"))).resolves.toBe(false);
	});

	it("watches the pull stream: it resolves on end and fails on the engine's error line", async () => {
		const events = (chunks: readonly string[]) => {
			const handlers: Record<string, (value: unknown) => void> = {};
			const stream = {
				on: (event: string, handler: (value: unknown) => void) => {
					handlers[event] = handler;
					if (event === "end") queueMicrotask(() => { handler(undefined); });
					for (const chunk of chunks) queueMicrotask(() => handlers.data?.(Buffer.from(chunk)));
					return stream;
				},
			};
			return stream;
		};
		docker.client.pull.mockImplementationOnce((_image: string, callback: (error: null, stream: unknown) => void) => { callback(null, events(['{"status":"Pulling"}\n'])); });
		await expect(run(engine().pullImage("nginx:alpine"))).resolves.toBeUndefined();
		expect(docker.client.pull).toHaveBeenCalledWith("nginx:alpine", expect.any(Function));

		docker.client.pull.mockImplementationOnce((_image: string, callback: (error: null, stream: unknown) => void) => { callback(null, events(['{"error":"manifest unknown"}\n'])); },
		);
		await expect(run(engine().pullImage("nginx:missing"))).rejects.toMatchObject({ status: 500 });
	});

	it("names the container publishing a host port", async () => {
		docker.client.listContainers.mockResolvedValue([
			{ Names: ["/other"], Ports: [{ Type: "tcp", PublicPort: 8080, IP: "127.0.0.1" }] },
			{ Names: ["/door"], Ports: [{ Type: "tcp", PublicPort: 8080, IP: "0.0.0.0" }] },
		]);

		await expect(run(engine().findPortHolder("10.0.0.5", 8080))).resolves.toBe("door");
	});
});
