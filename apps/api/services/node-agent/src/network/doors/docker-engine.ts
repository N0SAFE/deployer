/**
 * The handful of Docker Engine calls the agent needs, through dockerode.
 *
 * One SDK, always: the engine speaks more than these eight endpoints and dockerode already knows the transport (unix
 * socket or TCP), the API prefix, the per-call status codes and the JSON shapes. A hand-rolled `fetch({ unix })` client
 * re-implemented that — and drifted, because nothing checks a raw path against the engine's API.
 *
 * This stays a port (`DockerEngineShape`), so every test runs against an in-memory engine and every failure is a typed
 * `DockerEngineError` instead of a thrown exception.
 */

import Docker from "dockerode";
import { Context, Data, Effect } from "effect";

export type ContainerSummary = {
	readonly id: string;
	readonly running: boolean;
	readonly labels: Record<string, string>;
	/** Networks the container is currently attached to. */
	readonly networks: string[];
	/** Container ports (`80/tcp`) the engine currently publishes on the host. */
	readonly publishedPorts: string[];
};

/** The engine refused a call (`status`), or the socket itself failed (`status` 0). */
export class DockerEngineError extends Data.TaggedError("DockerEngineError")<{
	readonly status: number;
	readonly message: string;
}> {}

export type DockerEngineShape = {
	readonly inspectContainer: (name: string) => Effect.Effect<ContainerSummary | null, DockerEngineError>;
	readonly createContainer: (name: string, spec: Record<string, unknown>) => Effect.Effect<string, DockerEngineError>;
	readonly startContainer: (id: string) => Effect.Effect<void, DockerEngineError>;
	readonly removeContainer: (id: string) => Effect.Effect<void, DockerEngineError>;
	readonly imageExists: (image: string) => Effect.Effect<boolean, DockerEngineError>;
	readonly pullImage: (image: string) => Effect.Effect<void, DockerEngineError>;
	readonly networkExists: (name: string) => Effect.Effect<boolean, DockerEngineError>;
	/** Name of a RUNNING container publishing `address:port` on the host, or null. */
	readonly findPortHolder: (address: string, port: number) => Effect.Effect<string | null, DockerEngineError>;
};

/** Where the engine listens. Defaults to the unix socket every engine mounts; a dev proxy can override it. */
export class DockerSocket extends Context.Service<DockerSocket, { readonly socketPath: string }>()("node-agent/DockerSocket") {
	static readonly live = class DockerSocketImpl { socketPath = process.env.NODE_AGENT_DOCKER_SOCKET ?? "/var/run/docker.sock" };
}

/** The engine the converger talks to; the module binds it to the socket. */
export class DockerEngine extends Context.Service<DockerEngine, DockerEngineShape>()("node-agent/DockerEngine") {}

/** dockerode's rejection: an HTTP status plus the engine's own JSON `message` when it sent one. */
type EngineFailure = Error & { readonly statusCode?: number; readonly json?: { readonly message?: string } };

const toEngineError = (error: unknown): DockerEngineError => {
	const failure = error as EngineFailure;
	const message = failure.json?.message ?? failure.message;
	return new DockerEngineError({ status: failure.statusCode ?? 0, message });
};

/** A call that may legitimately answer `not found` (the engine's 404) instead of failing. */
const attempt = <A>(call: () => Promise<A>) => Effect.tryPromise({ try: call, catch: toEngineError });

const optional = <A>(call: () => Promise<A>, status: number): Effect.Effect<A | null, DockerEngineError> =>
	Effect.catchIf(attempt(call), (error) => error.status === status, () => Effect.succeed(null));

/** Engine client over the socket dockerode opens. */
export const SocketDockerEngine = {
	/** Build the engine for one socket path; the module reads it from `DockerSocket`. */
	live: (socketPath: string): DockerEngineShape => {
		const client = new Docker({ socketPath });

		return {
			inspectContainer: (name) =>
				Effect.map(
					optional(() => client.getContainer(name).inspect(), 404),
					(body): ContainerSummary | null =>
						body === null
							? null
							: {
									id: body.Id,
									/* eslint-disable @typescript-eslint/no-unnecessary-condition --
									   dockerode types these as always present; the ENGINE answers `null` for an exposed-but-unpublished
									   port (`"80/tcp": null`) and for a container without labels, so each guard is load-bearing. */
									running: body.State?.Running,
									labels: body.Config?.Labels ?? {},
									networks: Object.keys(body.NetworkSettings?.Networks ?? {}),
									publishedPorts: Object.entries(body.NetworkSettings?.Ports ?? {})
										.filter(([, bindings]) => (bindings ?? []).length > 0)
										.map(([port]) => port),
									/* eslint-enable @typescript-eslint/no-unnecessary-condition */
								},
				),

			createContainer: (name, spec) =>
				Effect.map(attempt(() => client.createContainer({ ...spec, name })), (created) => created.id),

			startContainer: (id) =>
				// 304 is "already running", which is what was asked for.
				Effect.asVoid(optional(() => client.getContainer(id).start(), 304)),

			removeContainer: (id) =>
				// 404 is "already gone", which is what was asked for.
				Effect.asVoid(optional(() => client.getContainer(id).remove({ force: true }), 404)),

			imageExists: (image) => Effect.map(optional(() => client.getImage(image).inspect(), 404), (image) => image !== null),

			pullImage: (image) =>
				attempt(
					() =>
						new Promise<void>((resolve, reject) => {
							void client.pull(image, (error, stream) => {
								if (error !== null) {
									reject(error);
									return;
								}
								// The engine streams progress; the pull is only finished when the stream is, and a failed layer
								// arrives as a `{"error":…}` line on that same stream.
								stream.on("data", (chunk: Buffer) => {
									const line = chunk.toString("utf8");
									if (!line.includes('"error"')) return;
									// The engine reports a failed layer as a line on the progress stream, not as an HTTP status.
									const failure = new Error(`pull ${image}: ${line.trim()}`) as Error & { statusCode: number };
									failure.statusCode = 500;
									reject(failure);
								});
								stream.on("end", () => {
									resolve();
								});
								stream.on("error", (streamError: unknown) => {
									reject(streamError);
								});
							});
						}),
				),

			networkExists: (name) => Effect.map(optional(() => client.getNetwork(name).inspect(), 404), (network) => network !== null),

			findPortHolder: (address, port) =>
				Effect.map(attempt(() => client.listContainers()), (containers) => {
					const wildcard = new Set(["", "0.0.0.0", "::"]);
					for (const container of containers) {
						const holds = container.Ports.some(
							(published) =>
								published.Type === "tcp" &&
								published.PublicPort === port &&
								(wildcard.has(published.IP) || wildcard.has(address) || published.IP === address),
						);
						if (holds) return (container.Names[0] ?? "unknown").replace(/^\//, "");
					}
					return null;
				}),
		};
	},
};
