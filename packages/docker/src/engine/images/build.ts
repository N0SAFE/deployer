import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import * as path from "node:path";

import { Effect } from "effect";

import { fromAbortable } from "@deployer/effect-core";

import { DockerNotFound, DockerUnavailable, type DockerError } from "../../errors/errors";
import { engineCall } from "../call";

import { followProgress } from "./progress";

import type Docker from "dockerode";

export type BuildImageOptions = {
	/** Default `Dockerfile`. */
	readonly dockerfileName?: string;
	readonly buildArgs?: Record<string, string>;
	readonly onProgressLine?: (line: string) => void;
};

export type BuildComposeOptions = {
	/** Default `docker-compose.yml`. */
	readonly composeFileName?: string;
	/** Default `deployer-<timestamp>`. */
	readonly projectName?: string;
	readonly serviceNames?: string[];
};

export type BuildShape = {
	/**
	 * Builds an image from the Dockerfile in `sourcePath`. A missing Dockerfile is a
	 * `DockerNotFound`: building from a guessed one would produce an image that is not what was meant.
	 */
	readonly image: (sourcePath: string, imageTag: string, options?: BuildImageOptions) => Effect.Effect<void, DockerError>;
	/** Runs `docker compose build` in `sourcePath` through the docker CLI. */
	readonly compose: (
		sourcePath: string,
		options?: BuildComposeOptions,
	) => Effect.Effect<{ projectName: string; services: string[] }, DockerError>;
};

const exists = (file: string) =>
	access(file).then(
		() => true,
		() => false,
	);

/** Runs the docker CLI without a shell; resolves with its stderr, rejects when it exits non-zero. */
function runDockerCli(args: string[], cwd: string, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn("docker", args, { cwd, stdio: ["ignore", "ignore", "pipe"], signal });
		let stderr = "";
		child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`docker compose failed (${args.join(" ")}): ${stderr.trim() || `exited with code ${String(code)}`}`));
		});
	});
}

export function makeBuild(client: Docker): BuildShape {
	const image: BuildShape["image"] = Effect.fn("DockerBuild.image")(function* (sourcePath, imageTag, options = {}) {
		yield* Effect.logInfo(`Building image ${imageTag} from ${sourcePath}`);
		const dockerfileName = options.dockerfileName ?? "Dockerfile";
		const dockerfilePath = path.join(sourcePath, dockerfileName);
		if (!(yield* Effect.promise(() => exists(dockerfilePath)))) {
			return yield* Effect.fail(
				new DockerNotFound({ resource: `Dockerfile at ${dockerfilePath} (context=${sourcePath}, dockerfile=${dockerfileName})` }),
			);
		}
		yield* engineCall(`build image ${imageTag}`, async (signal) => {
			const stream = await client.buildImage(
				{ context: sourcePath, src: ["."] },
				{ t: imageTag, dockerfile: dockerfileName, ...(options.buildArgs ? { buildargs: options.buildArgs } : {}), abortSignal: signal },
			);
			await followProgress(client, stream, options.onProgressLine);
		});
		yield* Effect.logInfo(`Image ${imageTag} built successfully`);
	});

	const compose: BuildShape["compose"] = Effect.fn("DockerBuild.compose")(function* (sourcePath, options = {}) {
		const composeFilePath = path.join(sourcePath, options.composeFileName ?? "docker-compose.yml");
		if (!(yield* Effect.promise(() => exists(composeFilePath)))) {
			return yield* Effect.fail(new DockerNotFound({ resource: `Docker compose file at ${composeFilePath}` }));
		}
		const projectName = options.projectName ?? `deployer-${String(Date.now())}`;
		const args = ["compose", "-f", composeFilePath, "-p", projectName, "build", ...(options.serviceNames ?? [])];
		yield* fromAbortable(
			(signal) => runDockerCli(args, sourcePath, signal),
			(cause) => new DockerUnavailable({ reason: cause instanceof Error ? cause.message : String(cause), cause }),
		);
		return { projectName, services: options.serviceNames ?? [] };
	});

	return { image, compose };
}
