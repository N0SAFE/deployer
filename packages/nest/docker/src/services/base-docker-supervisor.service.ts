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
import { NotFoundException } from "@nestjs/common";

import { DockerService } from "./docker.service";
import {
	BaseSupervisorService,
	baseSupervisorPayloadSchema,
} from "@repo/nest-supervisor-core/base-supervisor.service";
import { type DockerProcessInfo, type SwarmProcessInfo } from "@repo/nest-supervisor-core/supervisor-process-info";
import { baseSupervisorProcessInfoSchema } from "@repo/nest-supervisor-core/supervisor-process-info";
import {
	platformOverlayNetworkName,
	type DockerSupervisorRuntime,
} from "./docker-supervisor-runtime";
import type { SwarmServiceSpecInput } from "@repo/contracts-entities";
import { toDockerServiceSpec } from "./swarm-spec.mapper";

/** Dockerode API errors carry an HTTP-style statusCode (404 = not found). */
type DockerodeError = Error & { statusCode?: number };

/** How many times a version-conflicted swarm update is re-read and retried. */
const SWARM_UPDATE_MAX_ATTEMPTS = 5;

/**
 * True when the engine rejected a swarm update because the version index it
 * carried was already superseded by a concurrent update (`update out of
 * sequence`). That is a LOST RACE, not a real failure: re-inspecting the service
 * and retrying with the fresh index is the correct response.
 *
 * Exported for its regression test: the detection is what makes the retry
 * possible, and a looser match would silently retry genuine failures.
 */
export function isSwarmVersionConflict(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /update out of sequence/i.test(message);
}

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

	/**
	 * True when the local engine is an ACTIVE swarm member. Drives runtime
	 * resolution: a supervisor runs its process as a swarm service when the
	 * engine is active, and as a plain container otherwise (pre-setup or
	 * swarm participation disabled). Cheap `GET /info` probe — never throws.
	 */
	protected async isSwarmActive(): Promise<boolean> {
		try {
			const info = await this.dockerService.getSwarmInfo();
			return info.LocalNodeState === "active";
		} catch {
			return false;
		}
	}

	/**
	 * Whether this supervisor's resource can ONLY exist on a swarm. Defaults to
	 * true because the container fallback was removed repo-wide: every docker
	 * supervisor either schedules a swarm service or a `managed` (compose/
	 * operator-owned) process. A supervisor that can still be driven WITHOUT an
	 * active swarm overrides this to false.
	 */
	protected isSwarmOnly(): boolean {
		return true;
	}

	/**
	 * Whether the DEPLOYMENT owns this service right now (compose / operator).
	 *
	 * Base: false. Subclasses that read `MANAGED_<SERVICE>_ENABLED` override this
	 * — `splitManagedEnv(env).<service>.enabled` is the single source of truth.
	 */
	protected isDeploymentManaged(): boolean {
		return false;
	}

	/**
	 * Defer every docker supervisor until its resource can actually exist.
	 *
	 * On a node that is not yet a swarm manager, a swarm converge cannot
	 * succeed — it fails with `This node is not a swarm manager`, burns the
	 * retry budget and reports DEGRADED for what is really "the cluster does
	 * not exist yet". The cluster is created BY SETUP, so before setup the
	 * honest answer is `pending`: deferred, not failed.
	 *
	 * ── COMPOSE-MANAGED RESOURCES ARE EXEMPT, AND THAT EXEMPTION IS AUTOMATIC ───
	 * A `managed` resource (compose/operator-owned) exists independently of the
	 * local engine's swarm state: on the plain `dev` profile NOTHING fronts a
	 * swarm by design, so deferring those supervisors would leave a fully working
	 * compose stack reporting `pending` forever and never wiring its overlays.
	 *
	 * This used to be DOCUMENTED as an exemption while the code deferred
	 * everything — `isSwarmOnly()` defaulted to `true` and no compose-managed
	 * supervisor overrode it, so the exemption never applied. Checking the
	 * deployment-owned flag first is what makes it real.
	 */
	protected override async convergenceBlocker(): Promise<string | null> {
		if (this.isDeploymentManaged()) return null;
		if (!this.isSwarmOnly()) return null;
		if (await this.isSwarmActive()) return null;
		return "deferred until an active swarm exists — the cluster entry mode (create vs join) is decided during setup";
	}

	/**
	 * The container spec this supervisor converges towards when it uses the
	 * (legacy, retained for compatibility) container path. Swarm-backed
	 * supervisors do NOT implement this — they declare `buildSwarmSpec()` and
	 * call `reconcileSwarmService` instead. Every docker supervisor must
	 * implement exactly ONE of the two.
	 */
	protected buildContainerSpec(): DockerSupervisorContainerSpec {
		throw new Error(
			`${this.constructor.name} is swarm-backed — buildContainerSpec() (legacy container path) is not implemented. Declare buildSwarmSpec() instead.`,
		);
	}

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
			const statusCode = (error as DockerodeError).statusCode;
			// "no such container" (or a 404 status) means nothing to remove.
			// A 409 "removal ... already in progress" means a previous
			// convergence pass is already removing it — the desired end state
			// (absent) is guaranteed, so treat it like 404 instead of racing.
			if (
				msg.includes("no such container") ||
				statusCode === 404 ||
				statusCode === 409 ||
				msg.includes("already in progress")
			) {
				return;
			}
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

	// ─── Swarm-aware reconciliation ──────────────────────────────────────────
	//
	// When a docker supervisor converges to a SWARM SERVICE instead of a bare
	// container (swarm-global for node-local infra, swarm-replicated for
	// mesh-wide), the base provides the shared idempotent create/update and the
	// process-info view. Concrete supervisors keep declaring their desired spec
	// (now a SwarmServiceSpecInput) and call these helpers.

	/**
	 * Ensure the attachable OVERLAY network for a platform bridge network.
	 * Compose declares the bridge (e.g. deployer-platform); the overlay is the
	 * swarm-scoped counterpart that both swarm services AND (via external
	 * wiring) compose-managed containers attach to, giving one DNS namespace.
	 * Returns the overlay network name.
	 */
	protected async ensureSwarmNetwork(baseNetworkName: string): Promise<string> {
		const overlay = platformOverlayNetworkName(baseNetworkName);
		await this.dockerService.ensureOverlayNetwork({
			name: overlay,
			driver: "overlay",
			attachable: true,
			ingress: false,
			enableIpv6: false,
			labels: { "deployer.managed": "true", "deployer.platform": "true" },
		});
		return overlay;
	}

	/**
	 * Desired config + LIVE runtime view of the SWARM SERVICE described by a
	 * swarm spec — the process-info shape for swarm-backed supervisors.
	 * `desired` mirrors the spec exactly; `live` is a fresh inspect / task
	 * count (all-null when the service doesn't exist).
	 */
	protected async describeSwarmProcess(spec: SwarmServiceSpecInput): Promise<SwarmProcessInfo> {
		let live: SwarmProcessInfo["live"] = {
			serviceId: null,
			exists: false,
			createdAt: null,
			updatedAt: null,
			serviceName: null,
			runningTasks: null,
			totalTasks: null,
		};
		try {
			const svc = await this.dockerService.inspectSwarmService(spec.name);
			const tasks = await this.dockerService.listSwarmServiceTasks(spec.name).catch(() => []);
			const running = (tasks as Array<{ Status?: { State?: string } }>).filter(
				(t) => t.Status?.State === "running",
			).length;
			live = {
				serviceId: svc.ID ?? null,
				exists: true,
				createdAt: svc.CreatedAt ?? null,
				updatedAt: svc.UpdatedAt ?? null,
				serviceName: svc.Spec.Name ?? null,
				runningTasks: running,
				totalTasks: tasks.length,
			};
		} catch (error: unknown) {
			if (!(error instanceof NotFoundException)) throw error;
		}

		return {
			kind: "swarm",
			runtime: spec.mode === "global" ? "swarm-global" : "swarm-replicated",
			desired: {
				name: spec.name,
				image: spec.image,
				command: spec.command,
				labels: spec.labels,
				networkName: spec.networks[0]?.target ?? null,
				mode: spec.mode,
				replicas: spec.replicas,
			},
			live,
		};
	}

	/**
	 * Attach a swarm service to the platform overlay, registering the given
	 * ALIASES on it. Consumers address platform services by their stable alias
	 * (`global-db`, `redis`, `traefik`, `db-<instance>`) — which is exactly how
	 * the persisted connection URLs point at them — so the alias must be
	 * declared on the network attachment, not merely implied by the service
	 * name (a prefixed deployment's service name differs from its alias).
	 */
	protected attachOverlay(
		spec: SwarmServiceSpecInput,
		overlay: string,
		aliases: readonly string[] = [],
	): SwarmServiceSpecInput {
		spec.networks = [{ target: overlay, aliases: [...aliases] }];
		return spec;
	}

	/**
	 * Idempotently converge one platform SWARM service to the given spec.
	 * Creates when missing, updates (by latest version index) when present.
	 * Used by swarm-backed supervisors for their desired state.
	 *
	 * ── WHY THE UPDATE RETRIES ──────────────────────────────────────────────────
	 * A swarm update must carry the version index it was based on, and the engine
	 * REJECTS an update whose index is stale:
	 *
	 *   rpc error: code = Unknown desc = update out of sequence
	 *
	 * Two reconciles that inspect the SAME index collide — a startup convergence
	 * and an interval tick, or two supervisors sharing a service. Treating that
	 * as fatal was a silent, permanent failure: the exception propagated, the
	 * service kept its OLD spec, and every later fix (a new env, a changed
	 * command) was discarded while the supervisor still reported success. So the
	 * version is re-read and the update retried; only a non-conflict error is
	 * allowed to propagate.
	 */
	protected async reconcileSwarmService(spec: SwarmServiceSpecInput): Promise<void> {
		const dockerSpec = toDockerServiceSpec(spec);
		for (let attempt = 1; ; attempt += 1) {
			try {
				const existing = await this.dockerService.inspectSwarmService(spec.name);
				await this.dockerService.updateSwarmService(
					spec.name,
					existing.Version.Index,
					dockerSpec,
					false,
				);
				return;
			} catch (error: unknown) {
				if (error instanceof NotFoundException) {
					await this.dockerService.createSwarmService(dockerSpec);
					return;
				}
				if (attempt >= SWARM_UPDATE_MAX_ATTEMPTS || !isSwarmVersionConflict(error)) {
					throw error;
				}
			}
		}
	}

	/**
	 * Remove a platform swarm service if it exists.
	 *
	 * Idempotent by delegation: `DockerService.removeSwarmService` already
	 * treats "already gone" (404) and "engine not a swarm manager/part of a
	 * swarm" (403/503 — the pre-setup / swarm-deferred phase) as no-ops, so
	 * this is a thin pass-through kept for supervisor readability.
	 */
	protected async removeSwarmServiceIfExists(name: string): Promise<void> {
		await this.dockerService.removeSwarmService(name);
	}

	/**
	 * For a MANAGED (compose/operator-owned) service: ensure the attachable
	 * overlay exists AND attach the API container to it. The API container is
	 * the bridge head between compose-managed (bridge) and swarm (overlay)
	 * networks, so compose services can reach/be reached from swarm networks.
	 * Returns the overlay name, or `null` when there is no swarm to bridge.
	 *
	 * ── WHY IT CAN DECLINE ──────────────────────────────────────────────────────
	 * An overlay network is a SWARM construct: creating one on an engine that is
	 * not a swarm member fails with
	 *
	 *   Failed to create overlay network deployer-platform-overlay:
	 *   (HTTP code 403) This node is not a swarm manager
	 *
	 * and on the plain `dev` profile there is no swarm BY DESIGN — every service
	 * is compose-managed, so there is nothing to bridge TO either. Attempting it
	 * anyway reported a healthy compose stack as DEGRADED:
	 *
	 *   [RedisSupervisorService] Convergence failed: Failed to create overlay
	 *   network deployer-platform-overlay … not a swarm manager
	 *
	 * A managed service needs no overlay when no swarm exists, so this returns
	 * `null` and the caller reports the compose network it actually uses.
	 */
	protected async wireExternalToSwarm(
		baseNetworkName: string,
		hostContainerName: string,
	): Promise<string | null> {
		if (!(await this.isSwarmActive())) return null;

		const overlay = await this.ensureSwarmNetwork(baseNetworkName);
		// Attach the API container to the overlay too — it bridges the
		// compose-managed (bridge) and swarm (overlay) networks. Uses the
		// network-level connect API (POST /networks/{id}/connect).
		await this.client
			.getNetwork(overlay)
			.connect({ Container: hostContainerName })
			.catch(() => undefined);
		return overlay;
	}
}
