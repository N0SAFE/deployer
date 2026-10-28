/**
 * BaseDockerSupervisorService — docker-flavored supervisor base.
 *
 * Extends the generic supervisor framework with reusable dockerode plumbing:
 * null-safe container inspection and swarm service reconciliation. Concrete
 * supervisors (e.g. the platform Traefik ingress) only describe their desired
 * swarm spec plus their reconcile/probe specifics.
 */

import type Docker from "dockerode";
import z from "zod/v4";
import { NotFoundException } from "@nestjs/common";
import { Effect } from "effect";
import { runPromiseUnwrapped } from "@deployer/effect-core";

import { DockerService } from "./docker.service";
import { BaseSupervisorService } from "../supervision";
import { baseSupervisorPayloadSchema } from "@deployer/supervision";
import { type SwarmProcessInfo } from "@deployer/supervision";
import { baseSupervisorProcessInfoSchema } from "@deployer/supervision";
import { platformOverlayNetworkName, type DockerEngineShape } from "@deployer/docker";
import type { SwarmServiceSpecInput } from "@deployer/contracts-entities";
import { isSwarmVersionConflict, toDockerServiceSpec } from "@deployer/docker";

/** How many times a version-conflicted swarm update is re-read and retried. */
const SWARM_UPDATE_MAX_ATTEMPTS = 5;

export abstract class BaseDockerSupervisorService<
	TSchema extends z.ZodTypeAny = typeof baseSupervisorPayloadSchema,
	TProcessSchema extends z.ZodType = typeof baseSupervisorProcessInfoSchema,
> extends BaseSupervisorService<TSchema, TProcessSchema> {
	constructor(protected readonly dockerService: DockerService) {
		super();
	}

	/** The Effect engine behind every supervisor operation; run its Effects with `runPromiseUnwrapped`. */
	protected get engine(): DockerEngineShape {
		return this.dockerService.getEngine();
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


	/** Inspect a container by name; returns null when it does not exist. */
	protected async inspectContainer(name: string): Promise<Docker.ContainerInspectInfo | null> {
		return await runPromiseUnwrapped(
			this.engine.containers.inspect(name).pipe(Effect.catchTag("DockerNotFound", () => Effect.succeed(null))),
		);
	}

	/** Ensure a named docker volume exists (config sharing). Race-safe (create vs exists). */
	protected async ensureVolume(name: string): Promise<void> {
		await runPromiseUnwrapped(this.engine.volumes.ensure(name));
	}

	/** Force-remove a container by name, tolerating already-gone or already-being-removed. */
	protected async removeContainerIfExists(name: string): Promise<void> {
		await runPromiseUnwrapped(this.engine.containers.removeIfExists(name));
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
			const running = (tasks as { Status?: { State?: string } }[]).filter(
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
		await runPromiseUnwrapped(this.engine.networks.connectContainer(overlay, hostContainerName));
		return overlay;
	}
}
