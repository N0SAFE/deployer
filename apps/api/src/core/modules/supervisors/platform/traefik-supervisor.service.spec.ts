import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { PlatformNetwork, TraefikSupervisorService, type EntrypointProbe } from "./traefik-supervisor.service";
import { EnvHostnameService } from "../../platform-ingress/services/hostname.service";
import type { PlatformIngressSettingsService } from "../../platform-ingress/services/platform-ingress-settings.service";
import type { DockerService } from "@/core/modules/docker/services/docker.service";
import type { EnvService } from "@/config/env/env.service";

type InspectResult = { Id: string; State: { Running: boolean; ExitCode?: number }; Labels?: Record<string, string> };
/** Mirror of dockerode API errors carrying an HTTP-style statusCode. */
type DockerodeError = Error & { statusCode?: number };

function makeDockerClient() {
	const containers = new Map<string, InspectResult>();
	const client = {
		getContainer: vi.fn((name: string) => ({
			inspect: vi.fn(async () => {
				// Resolve by name OR by container id (the code reads entry-port
				// labels via the id returned from inspectContainer).
				const state =
					containers.get(name) ??
					[...containers.values()].find((c) => c.Id === name);
				if (state === undefined) {
					const err = new Error("not found") as DockerodeError;
					err.statusCode = 404;
					throw err;
				}
				// Full dockerode inspect shape: Config.Labels + HostConfig.PortBindings.
				return {
					Id: state.Id,
					State: state.State,
					Config: { Labels: state.Labels ?? {} },
					HostConfig: { PortBindings: {} },
				};
			}),
			start: vi.fn(async () => {
				const state = containers.get(name);
				if (state !== undefined) state.State.Running = true;
			}),
			remove: vi.fn(async () => {
				containers.delete(name);
			}),
		})),
		createContainer: vi.fn(async (opts: { name: string; Labels?: Record<string, string> }) => {
			const state: InspectResult = { Id: `id-${opts.name}`, State: { Running: false, ExitCode: 0 }, Labels: opts.Labels ?? {} };
			containers.set(opts.name, state);
			return {
				id: state.Id,
				start: vi.fn(async () => {
					state.State.Running = true;
				}),
				inspect: vi.fn(async () => state),
			};
		}),
		getNetwork: vi.fn((name: string) => ({
			inspect: vi.fn(async () => ({ Id: `net-${name}` })),
			connect: vi.fn(async () => undefined),
		})),
		getVolume: vi.fn((name: string) => ({
			inspect: vi.fn(async () => {
				throw Object.assign(new Error("not found"), { statusCode: 404 });
			}),
		})),
		createVolume: vi.fn(async () => ({ name: "created" })),
		pull: vi.fn((_image: string, cb: (err: Error | null, stream: NodeJS.ReadableStream | null) => void) => {
			const stream = new PassThrough();
			cb(null, stream);
			// Pull completes when the progress stream ends (base drains via resume).
			queueMicrotask(() => stream.end());
		}),
	};
	return { client, containers };
}

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): EnvService {
	const values: Record<string, unknown> = {
		DEPLOYER_PREFIX: "",
		DEPLOYER_TRAEFIK_IMAGE: "traefik:v3.3",
		DEPLOYER_TRAEFIK_HTTP_PORT: 80,
		DOCKER_HOST: undefined,
		NODE_ENV: "development",
		API_PORT: 3005,
		TRAEFIK_CONFIG_BASE_PATH: "/tmp/deployer-test-traefik-configs",
		...overrides,
	};
	return { get: vi.fn((key: string) => values[key]) } as unknown as EnvService;
}

async function makeConfigDir(): Promise<string> {
	// node:os is globally mocked in this suite — use TMPDIR directly.
	const base = process.env.TMPDIR ?? "/tmp";
	return await mkdtemp(join(base, "platform-traefik-"));
}

function makeSupervisor(envOverrides: Partial<Record<string, unknown>> = {}, entryPort: number | null = null) {
	const { client, containers } = makeDockerClient();
	const dockerService = { getDockerClient: () => client } as unknown as DockerService;
	const env = makeEnv(envOverrides);
	const hostnameService = new EnvHostnameService(makeEnv(envOverrides));
	// Settings stub: entry port from local DB (null → env default 80).
	const settings = {
		getPlatformEntry: vi.fn(async () => ({
			port: entryPort ?? 80,
			isDefault80: (entryPort ?? 80) === 80,
			sourcedFrom: (entryPort === null ? "default" : "local-db") as "default" | "local-db",
		})),
		getEntryPort: vi.fn(async () => entryPort ?? 80),
		setEntryPort: vi.fn(),
		clearEntryPort: vi.fn(),
	} as unknown as PlatformIngressSettingsService & {
		getPlatformEntry: ReturnType<typeof vi.fn>;
	};
	const supervisor = new TraefikSupervisorService(
		dockerService,
		hostnameService,
		env,
		settings,
	);
	return { supervisor, client, containers, env, settings };
}

/** Bypass the private HTTP entrypoint probe — liveness semantics are covered via inspect fallback paths. */
function stubProbe(supervisor: TraefikSupervisorService): void {
	vi.spyOn(
		supervisor as unknown as { probeEntrypoint(candidates: string[], port?: number): Promise<EntrypointProbe> },
		"probeEntrypoint",
	).mockResolvedValue({ reachable: true, host: "deployer-traefik", port: 80, statusCode: 200, latencyMs: 1 });
}

/** Extracts HostConfig.Binds from raw create args without casts at call sites. */
function hostBindsOf(createArgs: Record<string, unknown>): string[] {
	const hostConfig = createArgs.HostConfig as { Binds?: string[] };
	return hostConfig.Binds ?? [];
}

describe("PlatformNetwork", () => {
	it("names the network without prefix segment when prefix empty", () => {
		expect(PlatformNetwork.name("")).toBe("deployer-platform");
	});

	it("isolates networks per prefix", () => {
		expect(PlatformNetwork.name("acme")).toBe("deployer-platform-acme");
	});
});

describe("TraefikSupervisorService", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("exposes a stable identity for registry + health reporting", () => {
		const { supervisor } = makeSupervisor();
		expect(supervisor.supervisorId).toBe("platform-ingress-traefik");
		expect(supervisor.description.length).toBeGreaterThan(0);
	});

	it("converges by creating and starting the container when missing", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, client } = makeSupervisor({ TRAEFIK_CONFIG_BASE_PATH: configDir });
		stubProbe(supervisor);

		const state = await supervisor.ensureDesiredState();

		expect(state).toBe("converged");
		expect(client.createContainer).toHaveBeenCalledTimes(1);
		const createArgs = vi.mocked(client.createContainer).mock.calls[0]?.[0] as Record<string, unknown>;
		expect(createArgs.name).toBe("deployer-traefik");
		expect((createArgs.Labels as Record<string, string>)["deployer.platform.role"]).toBe("ingress");
		// Config files are NOT written by the supervisor — the traefik CORE
		// module owns them (TraefikPlatformConfigService) and the file provider
		// reloads them (watch=true). The supervisor only ensures the process.
	});

	it("does not recreate when a healthy container already runs", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, client, containers } = makeSupervisor({ TRAEFIK_CONFIG_BASE_PATH: configDir });
		containers.set("deployer-traefik", { Id: "existing", State: { Running: true, ExitCode: 0 } });
		stubProbe(supervisor);

		const state = await supervisor.ensureDesiredState();

		expect(state).toBe("converged");
		expect(client.createContainer).not.toHaveBeenCalled();
	});

	it("mounts the config dir read-only and enables the file provider", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, client } = makeSupervisor({ TRAEFIK_CONFIG_BASE_PATH: configDir });
		stubProbe(supervisor);

		await supervisor.ensureDesiredState();

		const createArgs = vi.mocked(client.createContainer).mock.calls[0]?.[0] as Record<string, unknown>;
		const cmd = createArgs.Cmd as string[];
		expect(cmd).toContain("--providers.file.directory=/config");
		expect(cmd).toContain("--providers.file.watch=true");
		// Config shared via the named volume — same volume the file provider
		// mounts (and the API writes to under TRAEFIK_CONFIG_BASE_PATH).
		expect(hostBindsOf(createArgs)).toContain("deployer-traefik-config:/config:ro");
	});

	it("derives prefixed container name from DEPLOYER_PREFIX", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, client } = makeSupervisor({ DEPLOYER_PREFIX: "acme", TRAEFIK_CONFIG_BASE_PATH: configDir });
		stubProbe(supervisor);

		await supervisor.ensureDesiredState();

		const createArgs = vi.mocked(client.createContainer).mock.calls[0]?.[0] as Record<string, unknown>;
		expect(createArgs.name).toBe("deployer-traefik-acme");
	});

	it("adds the websecure entrypoint + HTTP→HTTPS redirect when TLS is enabled (W5)", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, client } = makeSupervisor({
			DEPLOYER_TRAEFIK_TLS_ENABLED: true,
			TRAEFIK_CONFIG_BASE_PATH: configDir,
		});
		stubProbe(supervisor);

		await supervisor.ensureDesiredState();

		const createArgs = vi.mocked(client.createContainer).mock.calls[0]?.[0] as Record<string, unknown>;
		const cmd = createArgs.Cmd as string[];
		expect(cmd).toContain("--entrypoints.websecure.address=:443");
		expect(cmd).toContain("--entrypoints.web.http.redirections.entrypoint.to=websecure");
		expect(cmd).toContain("--entrypoints.web.http.redirections.entrypoint.scheme=https");
		const hostConfig = createArgs.HostConfig as Record<string, unknown>;
		expect(hostConfig.PortBindings).toEqual({
			"80/tcp": [{ HostPort: "80" }],
			"443/tcp": [{ HostPort: "443" }],
		});
	});

	it("suppresses host port bindings in production and mounts the socket read-only", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, client } = makeSupervisor({ NODE_ENV: "production", TRAEFIK_CONFIG_BASE_PATH: configDir });

		// Headless convergence includes a settle-window delay — collapse it for
		// determinism (same pattern as the degraded-path test).
		vi.spyOn(supervisor as unknown as { delay(ms: number): Promise<void> }, "delay").mockResolvedValue();

		await supervisor.ensureDesiredState();

		const createArgs = vi.mocked(client.createContainer).mock.calls[0]?.[0] as Record<string, unknown>;
		const hostConfig = createArgs.HostConfig as Record<string, unknown>;
		expect(hostConfig.PortBindings).toBeUndefined();
		// The config is shared via the NAMED volume (not a container path).
		expect(hostBindsOf(createArgs)).toEqual([
			"/var/run/docker.sock:/var/run/docker.sock:ro",
			"deployer-traefik-config:/config:ro",
		]);
	});

	it("marks Traefik DEGRADED when the entry port is unavailable (no silent fallback)", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, client, containers } = makeSupervisor({ TRAEFIK_CONFIG_BASE_PATH: configDir });
		stubProbe(supervisor);
		vi.spyOn(supervisor as unknown as { delay(ms: number): Promise<void> }, "delay").mockResolvedValue();

		// First create attempt: container is created but START fails with the
		// Docker bind error (host port taken by another process).
		client.createContainer.mockImplementationOnce(async (opts: { name: string }) => {
			const state: InspectResult = { Id: `id-${opts.name}`, State: { Running: false, ExitCode: 0 } };
			containers.set(opts.name, state);
			return {
				id: state.Id,
				start: vi.fn(async () => {
					throw new Error(
						"failed to program external connectivity on endpoint deployer-traefik: failed to bind host port 0.0.0.0:80/tcp: address already in use",
					);
				}),
				inspect: vi.fn(async () => state),
			};
		});

		const state = await supervisor.ensureDesiredState();

		// NO headless fallback — the entry-port conflict surfaces as an ERROR
		// the web can see and remediate (set a different entry port).
		expect(state).toBe("degraded");
		expect(supervisor.getStateSnapshot().detail).toContain("entry port 80 is already in use");
		// It did NOT silently recreate a headless container.
		expect(client.createContainer).toHaveBeenCalledTimes(1);
	});

	it("recreates Traefik when the entry port is changed (web-configured port)", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, client, containers, settings } = makeSupervisor({ TRAEFIK_CONFIG_BASE_PATH: configDir }, 8080);
		stubProbe(supervisor);

		await supervisor.ensureDesiredState();

		// First create publishes the settings port (8080) and records it.
		expect(client.createContainer).toHaveBeenCalledTimes(1);
		const firstArgs = vi.mocked(client.createContainer).mock.calls[0]?.[0] as Record<string, unknown>;
		expect((firstArgs.HostConfig as Record<string, unknown>).PortBindings).toEqual({ "80/tcp": [{ HostPort: "8080" }] });
		expect((firstArgs.Labels as Record<string, string>)[TraefikSupervisorService.ENTRY_PORT_LABEL]).toBe("8080");

		// The web sets a NEW entry port (8443) → the container already exists
		// with the OLD label → the reconcile recreates on the new port.
		settings.getPlatformEntry.mockResolvedValue({ port: 8443, isDefault80: false, sourcedFrom: "local-db" });

		await supervisor.ensureDesiredState();

		expect(client.createContainer).toHaveBeenCalledTimes(2);
		const secondArgs = vi.mocked(client.createContainer).mock.calls[1]?.[0] as Record<string, unknown>;
		expect((secondArgs.HostConfig as Record<string, unknown>).PortBindings).toEqual({ "80/tcp": [{ HostPort: "8443" }] });
		expect((secondArgs.Labels as Record<string, string>)[TraefikSupervisorService.ENTRY_PORT_LABEL]).toBe("8443");
	});

	it("reports the entire ingress process info (docker process + entry + urls)", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, containers } = makeSupervisor({ TRAEFIK_CONFIG_BASE_PATH: configDir });
		containers.set("deployer-traefik", { Id: "id-existing", State: { Running: true, ExitCode: 0 } });
		stubProbe(supervisor);

		const info = await supervisor.getProcessInfo();

		expect(info.supervisorId).toBe("platform-ingress-traefik");
		expect(info.process.kind).toBe("docker");
		expect(info.process.desired.name).toBe("deployer-traefik");
		expect(info.process.desired.image).toBe("traefik:v3.3");
		// Dev default entry port 80 → published spec.
		expect(info.process.desired.hostPorts).toEqual([{ containerPort: 80, hostPort: 80 }]);
		expect(info.process.live.running).toBe(true);
		expect(info.entry).toEqual({ port: 80, isDefault80: true, source: "default" });
		expect(info.urls.entryUrl).toBe("http://localhost:80");
		expect(info.urls.apiUrl).toBe("http://api.deployer.localhost");
		expect(info.config.dynamicApiFile).toContain("dynamic-api.yml");
	});

	it("reports the web-configured entry port (local-db source) in process info", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, containers } = makeSupervisor({ TRAEFIK_CONFIG_BASE_PATH: configDir }, 8080);
		containers.set("deployer-traefik", { Id: "id-existing", State: { Running: true, ExitCode: 0 } });
		stubProbe(supervisor);

		const info = await supervisor.getProcessInfo();

		expect(info.entry).toEqual({ port: 8080, isDefault80: false, source: "local-db" });
		expect(info.process.desired.hostPorts).toEqual([{ containerPort: 80, hostPort: 8080 }]);
		expect(info.urls.entryUrl).toBe("http://localhost:8080");
	});

	it("degrades instead of throwing when convergence keeps failing", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, client } = makeSupervisor({ TRAEFIK_CONFIG_BASE_PATH: configDir });
		client.pull.mockImplementation(
			(_image: string, cb: (err: Error | null, _stream: NodeJS.ReadableStream | null) => void) =>
				cb(new Error("pull failed"), null),
		);
		vi.spyOn(supervisor as unknown as { delay(ms: number): Promise<void> }, "delay").mockResolvedValue();

		const state = await supervisor.ensureDesiredState();

		expect(state).toBe("degraded");
		expect(supervisor.getStateSnapshot().detail).toContain("pull failed");
	});

	it("probes the platform-network host first when running inside Docker", async () => {
		const configDir = await makeConfigDir();
		const { supervisor } = makeSupervisor({ TRAEFIK_CONFIG_BASE_PATH: configDir });
		const probeSpy = vi.spyOn(
			supervisor as unknown as { probeEntrypoint(candidates: string[], port?: number): Promise<EntrypointProbe> },
			"probeEntrypoint",
		).mockResolvedValue({ reachable: true, host: "deployer-traefik", port: 80, statusCode: 200, latencyMs: 1 });

		const prevHostname = process.env.HOSTNAME;
		process.env.HOSTNAME = "0123456789abcdef"; // container-id shaped
		try {
			await supervisor.ensureDesiredState();
			// Inside Docker, the container name (docker embedded DNS) is first;
			// host.docker.internal + gateway + loopback follow as fallbacks.
			const candidates = probeSpy.mock.calls[0]?.[0] ?? [];
			expect(candidates[0]).toBe("deployer-traefik");
			expect(candidates).toContain("host.docker.internal");
		} finally {
			if (prevHostname === undefined) delete process.env.HOSTNAME;
			else process.env.HOSTNAME = prevHostname;
		}
	});

	it("probes host gateway addresses when not running inside Docker (bare metal)", async () => {
		const configDir = await makeConfigDir();
		const { supervisor } = makeSupervisor({ TRAEFIK_CONFIG_BASE_PATH: configDir });
		const probeSpy = vi.spyOn(
			supervisor as unknown as { probeEntrypoint(candidates: string[], port?: number): Promise<EntrypointProbe> },
			"probeEntrypoint",
		).mockResolvedValue({ reachable: true, host: "127.0.0.1", port: 80, statusCode: 200, latencyMs: 1 });

		const prevHostname = process.env.HOSTNAME;
		process.env.HOSTNAME = "workstation"; // non-hex: outside a container
		try {
			await supervisor.ensureDesiredState();
			const candidates = probeSpy.mock.calls[0]?.[0] ?? [];
			// No container-name candidate outside Docker; loopback is present.
			expect(candidates).not.toContain("deployer-traefik");
			expect(candidates).toContain("127.0.0.1");
		} finally {
			if (prevHostname === undefined) delete process.env.HOSTNAME;
			else process.env.HOSTNAME = prevHostname;
		}
	});

	it("reports healthy after successful convergence with reachable entrypoint", async () => {
		const configDir = await makeConfigDir();
		const { supervisor } = makeSupervisor({ TRAEFIK_CONFIG_BASE_PATH: configDir });
		stubProbe(supervisor);
		await supervisor.ensureDesiredState();

		const health = await supervisor.getHealth();

		expect(health.supervisorId).toBe("platform-ingress-traefik");
		expect(health.healthy).toBe(true);
		expect(health.state).toBe("converged");
		expect(health.detail).toContain("api.deployer.localhost");
		// Rich payload present + Zod-validated.
		expect(health.payload.container).not.toBeNull();
		expect(health.payload.entrypoint?.reachable).toBe(true);
		expect(health.payload.latencyMs).toBeGreaterThanOrEqual(0);
	});

	it("reports unhealthy when the entrypoint probe reports unreachable after convergence", async () => {
		const configDir = await makeConfigDir();
		const { supervisor } = makeSupervisor({ TRAEFIK_CONFIG_BASE_PATH: configDir });
		const probeSpy = vi.spyOn(
			supervisor as unknown as { probeEntrypoint(candidates: string[], port?: number): Promise<EntrypointProbe> },
			"probeEntrypoint",
		);
		// Reconcile-time verification succeeds…
		probeSpy.mockResolvedValueOnce({ reachable: true, host: "deployer-traefik", port: 80, statusCode: 200, latencyMs: 1 });
		await supervisor.ensureDesiredState();
		// …the later health probe finds the entrypoint unreachable.
		probeSpy.mockResolvedValue({ reachable: false, host: "deployer-traefik", port: 80, statusCode: null, latencyMs: null });

		const health = await supervisor.getHealth();

		expect(health.healthy).toBe(false);
		expect(health.detail).toContain("unreachable");
		expect(health.payload.entrypoint?.reachable).toBe(false);
	});
});
