/**
 * LocalIngressForwarderService — the ADDRESS-SCOPED ingress lane.
 *
 * ── WHY THIS IS A CONTAINER AND NOT A SWARM SERVICE ─────────────────────────
 * `local` and `wireguard` both need the same thing: bind a port on ONE address
 * (loopback, or this node's mesh overlay), never on every interface.
 *
 * Swarm CANNOT express that. Its port spec is
 * `{ TargetPort, PublishedPort, Protocol, PublishMode }` — there is no host-IP
 * field, so a swarm publish always binds 0.0.0.0 whichever mode it uses. A
 * `local` install realized as a swarm publish would therefore be listening on
 * the public interface, which is the exact outcome this provider exists to
 * prevent; and a `wireguard` install would be publicly reachable rather than
 * mesh-only.
 *
 * A plain container CAN express it: `HostConfig.PortBindings["80/tcp"] =
 * [{ HostIp: "127.0.0.1", HostPort: "80" }]`. So the address-scoped bindings are
 * realized here, and the swarm service stays HEADLESS (it still routes for the
 * whole cluster; it just publishes nothing).
 *
 * ── WHAT IT FORWARDS TO ─────────────────────────────────────────────────────
 * The Traefik service by NAME over the platform overlay, so the forwarder is a
 * dumb address-scoped door in front of the real ingress. Traefik keeps owning
 * every routing decision (which app a Host header belongs to); this only
 * decides WHO may knock. That split is why adding an app never touches this
 * file.
 *
 * It removes itself the moment the binding stops being address-scoped, so a
 * switch to `direct` or `tunnel` cannot leave a stale loopback listener behind
 * — a leftover that would keep answering on 127.0.0.1 while the operator
 * believes nothing is on the machine.
 */

import { Injectable, Logger } from "@nestjs/common";
import * as tar from "tar-stream";
import type Docker from "dockerode";

import { DockerService } from "@repo/nest-docker/services/docker.service";
import { platformOverlayForPrefix } from "@repo/nest-docker/services/docker-supervisor-runtime";
import { EnvService } from "@/config/env/env.module";
import { HostnameService } from "./hostname.service";
import { PlatformIngressSettingsService } from "./platform-ingress-settings.service";
import {
	LOOPBACK_ADDRESS,
	requiresContainerPath,
	type IngressBinding,
} from "./ingress-binding";

/** Container name — stable, and distinct from the swarm service's name. */
export const LOCAL_INGRESS_FORWARDER_NAME = "deployer-ingress-forwarder";

/** Mount point of the generated nginx config inside the forwarder. */
export const LOCAL_INGRESS_CONFIG_MOUNT = "/etc/nginx/local-ingress";

/** Ownership marker, matching the platform's one naming scheme. */
const PLATFORM_ROLE_LABEL = "deployer.platform.role";
const LOCAL_INGRESS_ROLE = "ingress-forwarder";

/** The swarm ingress service's DNS name on the overlay (the forward target). */
function traefikUpstream(prefix: string): string {
	return prefix === "" ? "deployer-traefik:80" : `deployer-traefik-${prefix}:80`;
}

@Injectable()
export class LocalIngressForwarderService {
	private readonly logger = new Logger(LocalIngressForwarderService.name);

	/**
	 * Serialises `converge()` — the fix for the create/conflict storm.
	 *
	 * ── THE FAILURE THIS PREVENTS (observed in the logs) ──────────────────────
	 * `converge()` has several concurrent callers: the supervisor's own backoff
	 * loop, its periodic sweep, and every swarm `service update` event (the API
	 * updating `deployer-traefik` emits one, which re-triggers the supervisor).
	 * Each pass REMOVES the container and RECREATES it, so four passes landing
	 * together produced, in one second,
	 *
	 *   8:17:33  Removed deployer-ingress-forwarder   ×4
	 *   8:17:37  ERROR 409 Conflict. The container name
	 *            "/deployer-ingress-forwarder" is already in use by container "417f23c…"
	 *
	 * — they were racing EACH OTHER, not a stale container. That is why awaiting
	 * the removal's completion did not help: whichever pass finished first had
	 * its freshly created container stolen from it by the next pass's remove.
	 *
	 * Promise chaining rather than a boolean "in progress" flag: a flag would
	 * make late callers SKIP the converge and leave the last desired state
	 * unapplied, whereas chaining makes them run AFTER it against the then-current
	 * state. `catch` on the chain (not on the returned promise) keeps one
	 * caller's failure from rejecting every queued caller.
	 */
	private convergeChain: Promise<void> = Promise.resolve();

	constructor(
		private readonly dockerService: DockerService,
		private readonly env: EnvService,
		private readonly hostnames: HostnameService,
		private readonly settings: PlatformIngressSettingsService,
	) {}

	/**
	 * Bring the forwarder into line with `binding`.
	 *
	 * A no-op for bindings Swarm CAN express (`direct`, `tunnel`) — those are
	 * the swarm service's job. For the address-scoped ones it converges the
	 * container; for anything else it removes a previously-created forwarder so
	 * a mode change never leaves the old lane listening.
	 *
	 * SERIALISED: see `convergeChain`. Callers may fire without awaiting each
	 * other, and the order they run in is the order they arrived.
	 */
	async converge(binding: IngressBinding | null): Promise<void> {
		const run = this.convergeChain.then(() => this.convergeOnce(binding));
		// The CHAIN must survive a rejection so later callers still run; the
		// caller still sees the rejection through `run` below.
		this.convergeChain = run.catch(() => undefined);
		return await run;
	}

	/** The convergence body, run under `convergeChain`'s mutual exclusion. */
	private async convergeOnce(binding: IngressBinding | null): Promise<void> {
		const prefix = this.env.get("DEPLOYER_PREFIX");

		// `null` means the binding could not be resolved (e.g. `wireguard` with no
		// overlay address). Remove any existing forwarder rather than leaving one
		// bound to an address we can no longer justify.
		if (binding === null || !requiresContainerPath(binding)) {
			await this.remove();
			return;
		}

		const entry = await this.settings.getPlatformEntry();
		const targets = this.buildServers(entry.port);
		// The image must exist BEFORE the create, or the first converge on a machine
		// that has never run the proxy fails with `No such image: nginx:alpine` —
		// and since `local` binds NOTHING on the swarm service, the platform would
		// then be reachable from nowhere. Checked rather than pulled unconditionally,
		// so a present image generates no registry traffic (see `ensureImagePresent`).
		await this.ensureImagePresent(this.env.get("DEPLOYER_DIRECT_PROXY_IMAGE"));
		await this.reconcileContainer(binding, prefix, targets);
	}

	/**
	 * Remove the forwarder and WAIT until the name is actually free.
	 *
	 * ── WHY `force: false` + POLL, NOT `force: true` ─────────────────────────
	 * `remove({ force: true })` sends SIGKILL, which is itself asynchronous: the
	 * call resolves while the engine is still tearing the container down, so the
	 * NAME remains taken for a moment afterwards. The recreate that follows then
	 * failed with
	 *
	 *   (HTTP code 409) Conflict. The container name
	 *   "/deployer-ingress-forwarder" is already in use by container "cdae110e…"
	 *
	 * and because the supervisor retries convergence, that produced a create /
	 * conflict / retry loop. Stopping gracefully and then polling for the name to
	 * disappear is what makes the recreate deterministic.
	 *
	 * `stop` is best-effort: a container that already exited has nothing to stop,
	 * and that is not an error.
	 */
	async remove(): Promise<void> {
		const container = this.dockerService.getDockerClient().getContainer(LOCAL_INGRESS_FORWARDER_NAME);

		await container.stop({ t: 5 }).catch(() => undefined);

		// ── `remove()` WITHOUT `force`, THEN `wait()` ───────────────────────────
		// The removal is ASYNCHRONOUS and its NAME is released only when it
		// finishes. Polling `inspect()` cannot observe that window — inspect starts
		// failing as soon as the container is gone, while the name is still held —
		// so the recreate raced it and lost with
		//
		//   (HTTP code 409) Conflict. The container name
		//   "/deployer-ingress-forwarder" is already in use by container "139dc75…"
		//
		// four times in a single boot. `wait()` is the engine's own completion
		// signal for exactly this, so awaiting it closes the window instead of
		// estimating it.
		//
		// `force: false` is deliberate here: with `force: true` the daemon
		// SIGKILLs and the call resolves without a waitable status, so a following
		// `wait()` can observe a stale exit and return immediately — the same race
		// in a different disguise. The container is already stopped above, so a
		// graceful remove is instantaneous anyway.
		await container.remove().catch(() => undefined);
		await container.wait().catch(() => undefined);

		this.logger.log(`Removed ${LOCAL_INGRESS_FORWARDER_NAME} before recreating it`);
	}

	/**
	 * Ensure the forwarder image is present, WITHOUT re-pulling it every converge.
	 *
	 * ── WHY THE PRESENCE CHECK MATTERS ───────────────────────────────────────
	 * This used to call `pullImage()` unconditionally on every `converge()`, and
	 * `converge()` runs on every reconcile pass (including the ones triggered by
	 * unrelated swarm events). On a machine with a slow or blocked registry that
	 * turned each pass into `pullImage`'s full retry ladder — 3 attempts with
	 * exponential backoff — so the logs carried
	 *
	 *   Attempting to pull image nginx:alpine (retries=3)
	 *   Pull attempt 1 failed … Waiting 2000ms before next pull attempt
	 *
	 * on repeat, while the image was already on disk and the ingress was healthy.
	 * A REGISTRY outage is not an ingress outage, and it must not read like one.
	 *
	 * `createContainer` already pulls on `IfNotPresent`, so an absent image is
	 * still handled on the create path. This check exists to keep a PRESENT image
	 * from generating registry traffic at all.
	 */
	private async ensureImagePresent(image: string): Promise<void> {
		const present = await this.dockerService
			.getDockerClient()
			.getImage(image)
			.inspect()
			.then(() => true)
			.catch(() => false);
		if (present) return;
		await this.dockerService.pullImage(image);
	}

	/**
	 * The nginx server blocks, one per hostname the ingress serves.
	 *
	 * ── WHY nginx LISTENS ON 0.0.0.0 EVEN THOUGH THE BINDING IS LOOPBACK ──────
	 * Docker publishes a port by connecting to the CONTAINER's address on the
	 * container network — never its loopback. So a server block bound to
	 * `127.0.0.1` inside the container is unreachable from the published port and
	 * every request through it fails, however correct the host-side `HostIp` is.
	 *
	 * The EXPOSURE is decided by `HostConfig.PortBindings[].HostIp`, which is the
	 * host-side half of the publish: `127.0.0.1` there means the host port is
	 * reachable from this machine only. nginx's own listen address is IN the
	 * container and changes nothing about who can reach the host port, so it is
	 * deliberately `0.0.0.0`.
	 *
	 * Host-routed rather than a blind catch-all so the forwarder behaves exactly
	 * like the real ingress for the names a local client types. A catch-all would
	 * also answer for arbitrary Host headers, which is a wider surface than the
	 * binding promised.
	 */
	private buildServers(entryPort: number): string {
		const listen = `0.0.0.0:${String(entryPort)}`;
		const upstream = traefikUpstream(this.env.get("DEPLOYER_PREFIX"));

		// Both the API and the web console, since both are served through this one
		// address on a single-machine install. Anything else the platform serves is
		// reached by its own hostname through the same upstream, so a single
		// catch-all is correct for every OTHER name — Traefik decides where it
		// goes. The explicit names are kept only to document the two entry points.
		const names = [this.hostnames.apiHostname(), this.hostnames.webHostname()];
		return names
			.map(
				(serverName) => `  server {
    listen ${listen};
    server_name ${serverName};
    location / {
      proxy_pass http://${upstream};
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
    }
  }`,
			)
			.join("\n");
	}

	/**
	 * Copy the generated nginx.conf into a created-but-not-started container.
	 *
	 * Uses the archive endpoint (`putArchive`) rather than a `docker cp` subprocess:
	 * the API talks to the engine over the socket it already holds, so no CLI
	 * binary is required in the image and there is no process to supervise.
	 *
	 * The entry is written at `/etc/nginx/local-ingress/nginx.conf`, which is the
	 * path `Cmd` points nginx at.
	 */
	private async copyConfigInto(container: Docker.Container, servers: string): Promise<void> {
		const conf = `events {}\nhttp {\n  include /etc/nginx/mime.types;\n${servers}\n}\n`;
		// The archive carries the SUBDIRECTORY in its entry name and is extracted at
		// `/etc/nginx` (which exists in the image), so tar creates
		// `/etc/nginx/local-ingress/` as part of the extraction.
		//
		// Copying straight to the subdirectory does NOT work: `putArchive` writes
		// INTO a path and will not create it, and it failed with
		//
		//   Could not find the file /etc/nginx/local-ingress
		//
		// — a bind mount used to create that directory implicitly, which is why
		// this only surfaced once the config stopped being mounted.
		const archive = await tarSingleFile("local-ingress/nginx.conf", conf);
		await container.putArchive(archive, { path: "/etc/nginx" });
	}

	/**
	 * Whether a RUNNING forwarder already binds exactly `hostIp` on `ports`.
	 *
	 * Compared against the container's own `HostConfig.PortBindings`, which is
	 * the authoritative record of what it is bound to — reading it back means the
	 * decision cannot drift from what the engine actually did.
	 *
	 * A container that is present but NOT running does not count: it may be
	 * mid-restart or crash-looping, and both are cases the recreate path should
	 * handle rather than silently accept.
	 */
	private async isForwarderCurrent(hostIp: string, ports: readonly number[]): Promise<boolean> {
		try {
			const info = await this.dockerService.getDockerClient().getContainer(LOCAL_INGRESS_FORWARDER_NAME).inspect();
			if (!info.State.Running) return false;
			// `HostConfig.PortBindings` is `any` in the engine's types, so it is
			// narrowed to the shape we actually wrote and validated at runtime —
			// never dereferenced unchecked.
			const bindings = (info.HostConfig.PortBindings ?? {}) as Record<string, { HostIp?: string; HostPort?: string }[]>;
			for (const port of ports) {
				const entry = bindings[`${String(port)}/tcp`]?.[0];
				// `HostIp` may be absent in the engine's echo of an all-interfaces
				// publish; treat absent as NOT matching a specific address, so the
				// recreate path still runs and applies the bind we asked for.
				if (entry?.HostIp !== hostIp || entry.HostPort !== String(port)) return false;
			}
			// A stale forwarder bound to EXTRA ports must also be recreated: the
			// binding narrowed, and leaving the old listener up would keep serving
			// an address the current provider does not justify.
			const expected = new Set(ports.map((port) => `${String(port)}/tcp`));
			if (Object.keys(bindings).some((key) => !expected.has(key))) return false;
			return true;
		} catch {
			return false; // absent or unreadable → converge it
		}
	}

	/**
	 * Write the nginx config INTO the container, then (re)start it.
	 *
	 * ── WHY THE CONFIG IS COPIED IN RATHER THAN MOUNTED ─────────────────────
	 * The neighbouring `DirectPortProxySupervisorService` writes its config to a
	 * directory that COMPOSE mounts from a shared named volume. That works there
	 * because compose declares the mount on the API service.
	 *
	 * The API does not run under compose in the supervised/prod profiles — it is a
	 * SWARM service, and its spec declares no such mount. So the file this used to
	 * write at `/app/local-ingress-config/nginx.conf` landed on the task's own
	 * ephemeral filesystem, and the volume handed to the forwarder was empty:
	 *
	 *   [emerg] open() "/etc/nginx/local-ingress/nginx.conf" failed
	 *   (2: No such file or directory)
	 *
	 * Copying the file in removes the requirement that two different containers
	 * share a mount, so the lane works identically under compose and swarm. The
	 * cost is one `docker cp` per converge, which is noise next to starting a
	 * container.
	 */
	private async reconcileContainer(binding: IngressBinding, prefix: string, servers: string): Promise<void> {
		const client: Docker = this.dockerService.getDockerClient();
		const overlay = platformOverlayForPrefix(prefix);

		// The HostIp is the whole point: it is what makes this a loopback (or
		// overlay) listener instead of a public one.
		const hostIp = binding.bindAddress ?? LOOPBACK_ADDRESS;
		const portBindings: Record<string, { HostIp: string; HostPort: string }[]> = {};
		for (const port of binding.ports) {
			portBindings[`${String(port)}/tcp`] = [{ HostIp: hostIp, HostPort: String(port) }];
		}

		// ── IDEMPOTENCE: A RUNNING CONTAINER WITH THE DESIRED BINDING IS LEFT ALONE
		// The port bindings and the bind address are creation-time inputs, so
		// "desired state already holds" cannot be reconciled in place — but it CAN
		// be detected, and recreating anyway is what made a routine converge tear
		// down a working listener. Only a change in the BIND ADDRESS or the PORT
		// SET justifies the churn; everything else (a retry, a redundant sweep)
		// finds the container already correct and returns.
		if (await this.isForwarderCurrent(hostIp, binding.ports)) {
			return;
		}

		await this.remove();

		try {
			const created = await client.createContainer({
				name: LOCAL_INGRESS_FORWARDER_NAME,
				Image: this.env.get("DEPLOYER_DIRECT_PROXY_IMAGE"),
				Cmd: ["nginx", "-c", `${LOCAL_INGRESS_CONFIG_MOUNT}/nginx.conf`, "-g", "daemon off;"],
				Labels: {
					[PLATFORM_ROLE_LABEL]: LOCAL_INGRESS_ROLE,
					"deployer.managed": "true",
					"deployer.ingress.bindScope": binding.scope,
					"deployer.ingress.bindAddress": hostIp,
				},
				HostConfig: {
					PortBindings: portBindings,
					RestartPolicy: { Name: "unless-stopped" },
					// Joined to the overlay so `deployer-traefik` resolves by name —
					// the forwarder must reach the ingress the same way any other
					// platform service does.
					NetworkMode: overlay,
				},
			});

			// The config goes in BEFORE the first start, so nginx finds it on its
			// initial read instead of crash-looping on a missing file.
			await this.copyConfigInto(created, servers);
			await created.start();
			this.logger.log(
				`${LOCAL_INGRESS_FORWARDER_NAME} started — bound on ${hostIp} only (${binding.scope})`,
			);
		} catch (error) {
			this.logger.error(
				`Failed to start ${LOCAL_INGRESS_FORWARDER_NAME} on ${hostIp}: ${error instanceof Error ? error.message : String(error)}`,
			);
			throw error;
		}
	}
}

/**
 * Build a single-file tar archive in memory.
 *
 * The engine's `putArchive` takes an ARCHIVE, not a bare file — this is the
 * smallest thing that satisfies it. `tar-stream` is already an `apps/api`
 * dependency (the git service extracts with it), so this adds no new one.
 */
async function tarSingleFile(name: string, contents: string): Promise<Buffer> {
	const pack = tar.pack();
	const chunks: Buffer[] = [];
	const collected = new Promise<Buffer>((resolve, reject) => {
		pack.on("data", (chunk) => {
			// `tar-stream` types the event payload as `unknown`; the pack stream
			// only ever emits Buffer chunks, so narrow rather than cast.
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
		});
		pack.on("end", () => {
			resolve(Buffer.concat(chunks));
		});
		pack.on("error", reject);
	});
	const body = Buffer.from(contents, "utf8");
	pack.entry({ name, size: body.length }, body);
	pack.finalize();
	return await collected;
}
