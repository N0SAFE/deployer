/**
 * BaseDockerSupervisorService — docker-flavored supervisor base.
 *
 * Extends the generic supervisor framework with reusable dockerode plumbing:
 * null-safe container inspection, network ensure, image pull, and container
 * creation from a declarative spec. Concrete supervisors (e.g. the platform
 * Traefik ingress) only describe their desired container spec plus their
 * reconcile/probe specifics.
 */

import type Docker from "dockerode";
import type { Container } from "dockerode";
import z from "zod/v4";

import { DockerService } from "./docker.service";
import {
	BaseSupervisorService,
	baseSupervisorPayloadSchema,
} from "@/core/modules/supervisors/base-supervisor.service";
import { type DockerProcessInfo } from "@/core/modules/supervisors/supervisor-process-info";
import { baseSupervisorProcessInfoSchema } from "@/core/modules/supervisors/supervisor-process-info";

/** Dockerode API errors carry an HTTP-style statusCode (404 = not found). */
type DockerodeError = Error & { statusCode?: number };

/** Declarative description of the container a supervisor wants running. */
export interface DockerSupervisorContainerSpec {
	name: string;
	image: string;
	command?: string[];
	env?: string[];
	labels: Record<string, string>;
	/** Network to join; created on demand when missing. */
	networkName?: string;
	/** Host bind mounts, e.g. "/var/run/docker.sock:/var/run/docker.sock:ro". */
	binds?: string[];
	/** Host port bindings, e.g. { "80/tcp": [{ HostPort: "80" }] }. */
	portBindings?: Record<string, { HostPort: string }[]>;
	/** Extra /etc/hosts entries, e.g. ["host.docker.internal:host-gateway"]. */
	extraHosts?: string[];
	restartPolicy?: "no" | "always" | "unless-stopped" | "on-failure";
}

export abstract class BaseDockerSupervisorService<
	TSchema extends z.ZodTypeAny = typeof baseSupervisorPayloadSchema,
	TProcessSchema extends z.ZodType = typeof baseSupervisorProcessInfoSchema,
> extends BaseSupervisorService<TSchema, TProcessSchema> {
	constructor(protected readonly dockerService: DockerService) {
		super();
	}

	/** The shared dockerode client for all supervisor operations. */
	protected get client(): Docker {
		return this.dockerService.getDockerClient();
	}

	/** The container spec this supervisor converges towards. */
	protected abstract buildContainerSpec(): DockerSupervisorContainerSpec;

	/** Inspect a container by name; returns null when it does not exist. */
	protected async inspectContainer(
		name: string,
	): Promise<{
		Id: string;
		State: { Running: boolean; ExitCode?: number; StartedAt?: string };
		RestartCount?: number;
	} | null> {
		return await this.client
			.getContainer(name)
			.inspect()
			.catch((error: DockerodeError) => {
				if (error.statusCode === 404) return null;
				throw error;
			});
	}

	/** Ensure a docker network exists; resolves its id either way. Race-safe. */
	protected async ensureNetwork(name: string): Promise<string> {
		const existing = await this.client
			.getNetwork(name)
			.inspect()
			.catch((error: DockerodeError) => {
				if (error.statusCode === 404) return null;
				throw error;
			});
		if (existing !== null) return existing.Id;

		try {
			const created = await this.client.createNetwork({ Name: name, CheckDuplicate: true });
			return created.id;
		} catch (error) {
			// Concurrent creation race — re-inspect and reuse the winner's network.
			const raced = await this.client
				.getNetwork(name)
				.inspect()
				.catch(() => null);
			if (raced !== null) return raced.Id;
			throw error;
		}
	}

	/** Ensure a named docker volume exists (config sharing). Resolves the
	 *  volume name either way. Race-safe (create vs exists). */
	protected async ensureVolume(name: string): Promise<void> {
		const existing = await this.client
			.getVolume(name)
			.inspect()
			.catch((error: DockerodeError) => {
				if (error.statusCode === 404) return null;
				throw error;
			});
		if (existing !== null) return;
		await this.client.createVolume({ Name: name }).catch(() => undefined);
	}

	/** Pull an image, draining the progress stream. Throws on pull failure. */
	protected async pullImage(image: string): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			this.client.pull(image, (error: Error | null, stream: NodeJS.ReadableStream | null) => {
				if (error !== null) {
					reject(error);
					return;
				}
				if (stream === null) {
					reject(new Error(`null pull stream for image "${image}"`));
					return;
				}
				stream.once("end", () => resolve());
				stream.once("error", reject);
				stream.resume();
			});
		});
	}

	/**
	 * Create a container from the given spec. Does NOT start it — callers
	 * decide when (create-then-start keeps inspect/start separable in tests).
	 */
	protected async createContainer(spec: DockerSupervisorContainerSpec, networkId?: string): Promise<Container> {
		const hostConfig: Record<string, unknown> = {
			Binds: spec.binds ?? [],
			RestartPolicy: { Name: spec.restartPolicy ?? "unless-stopped" },
		};
		if (networkId !== undefined) hostConfig.NetworkMode = networkId;
		if (spec.portBindings !== undefined) hostConfig.PortBindings = spec.portBindings;
		if (spec.extraHosts !== undefined && spec.extraHosts.length > 0) hostConfig.ExtraHosts = spec.extraHosts;

		return await this.client.createContainer({
			name: spec.name,
			Image: spec.image,
			Cmd: spec.command,
			Labels: spec.labels,
			HostConfig: hostConfig,
		});
	}

	/** Force-remove a container by name, tolerating already-gone (no throw). */
	protected async removeContainerIfExists(name: string): Promise<void> {
		try {
			await this.client.getContainer(name).remove({ force: true });
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : String(error);
			// "no such container" (or a 404 status) means nothing to remove.
			if (msg.includes("no such container") || (error as DockerodeError).statusCode === 404) return;
			throw error;
		}
	}

	/**
	 * Desired config + LIVE runtime view of the container described by a spec
	 * — the shared docker process-info shape every docker-backed supervisor
	 * reports through `getProcessInfo()`. `desired` mirrors the spec exactly;
	 * `live` is a fresh inspect (all-null when the container doesn't exist).
	 */
	protected async describeDockerProcess(spec: DockerSupervisorContainerSpec): Promise<DockerProcessInfo> {
		const live = await this.inspectContainer(spec.name);
		const hostPorts = Object.entries(spec.portBindings ?? {})
			.flatMap(([containerPort, bindings]) =>
				bindings.map((binding) => ({
					containerPort: Number(containerPort.split("/")[0]),
					hostPort: Number(binding.HostPort),
				})),
			)
			.filter((p) => p.hostPort >= 1 && Number.isInteger(p.containerPort) && Number.isInteger(p.hostPort));
		return {
			kind: "docker",
			desired: {
				name: spec.name,
				image: spec.image,
				command: spec.command ?? null,
				labels: spec.labels,
				networkName: spec.networkName ?? null,
				binds: spec.binds ?? null,
				hostPorts: hostPorts.length > 0 ? hostPorts : null,
				restartPolicy: spec.restartPolicy ?? "no",
			},
			live: {
				containerId: live?.Id ?? null,
				running: live?.State.Running ?? null,
				startedAt: live?.State.StartedAt ?? null,
				exitCode: live?.State.ExitCode ?? null,
				restartCount: live?.RestartCount ?? null,
			},
		};
	}
}
