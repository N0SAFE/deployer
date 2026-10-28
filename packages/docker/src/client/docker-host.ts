import { Context } from "effect";

import { makeDockerEngine, type DockerEngineShape } from "../engine/docker-engine";
import type { ScannerEngineAccess } from "../scanning/scanner-pool";
import { resolveDockerClient, type DockerConnectionConfig } from "./docker-client";

/** The engine this process drives, and how a container it starts would reach that same engine. */
export type DockerHostShape = {
	/** The engine as Effect services. */
	readonly engine: DockerEngineShape;
	/** How the connection was chosen, for the startup log. */
	readonly mode: string;
	/** The unix socket the engine is reached over; `null` over TCP. */
	readonly socketPath: string | null;
	/** `HostConfig.Binds` entry that mounts the socket into a container, or `null` over TCP. */
	readonly socketBind: string | null;
	/** What a scanner container needs to reach this engine: the bind-mounted socket, or the TCP endpoint. */
	readonly scannerAccess: ScannerEngineAccess;
	/** Connection warnings the host logs once. */
	readonly warnings: readonly string[];
};

export class DockerHost extends Context.Service<DockerHost, DockerHostShape>()("docker/DockerHost") {}

/** Resolves the connection from the app's configuration and builds the engine over it. */
export const makeDockerHost = (config: DockerConnectionConfig): DockerHostShape => {
	const { client, mode, socketPath, warnings } = resolveDockerClient(config);
	const socketBind = socketPath === null ? null : `${socketPath}:${socketPath}`;
	const { host, port } = client as unknown as { host?: string; port?: number };
	return {
		engine: makeDockerEngine(client),
		mode,
		socketPath,
		socketBind,
		scannerAccess: { socketBind, ...(host && port ? { tcp: { host, port } } : {}) },
		warnings,
	};
};
