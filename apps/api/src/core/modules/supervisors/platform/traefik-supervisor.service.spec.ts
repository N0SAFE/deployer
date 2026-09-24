import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { PlatformNetwork, TraefikSupervisorService, type EntrypointProbe } from "./traefik-supervisor.service";
import { EnvHostnameService } from "../../platform-ingress/services/hostname.service";
import type { PlatformIngressSettingsService } from "../../platform-ingress/services/platform-ingress-settings.service";
import type { DockerService } from "@/core/modules/docker/services/docker.service";
import type { EnvService } from "@/config/env/env.module";

/**
 * The ingress is a swarm-GLOBAL service now, so this suite asserts the SWARM
 * contract: service spec shape, host publish mode, alias registration, entry
 * port conflicts, and process-info/probe reporting. There is deliberately no
 * container assertion — the container path was removed, not kept alongside.
 */

/** A swarm service as the engine would report it. */
interface ServiceState {
	ID: string;
	Version: { Index: number };
	Spec: { Name: string };
	CreatedAt: string;
	UpdatedAt: string;
}

interface SwarmTaskState {
	NodeID: string;
	Status: { State: string };
}

/** The dockerode service spec shape this suite inspects. */
interface CapturedSpec {
	Name: string;
	Mode: Record<string, unknown>;
	Labels?: Record<string, string>;
	TaskTemplate: {
		ContainerSpec: {
			Command?: string[];
			Mounts?: Array<{ Source?: string; Target?: string; ReadOnly?: boolean }>;
		};
		Networks?: Array<{ Target: string; Aliases?: string[] }>;
	};
	EndpointSpec?: { Ports?: Array<{ TargetPort?: number; PublishedPort?: number; PublishMode?: string }> };
}

function makeDockerService() {
	/** Services by name — the engine's source of truth in this fixture. */
	const services = new Map<string, ServiceState>();
	/** Tasks by service name — one task per node for a global service. */
	const tasks = new Map<string, SwarmTaskState[]>();

	const inspectSwarmService = vi.fn(async (name: string): Promise<ServiceState> => {
		const found = services.get(name);
		if (found === undefined) throw new NotFoundException(`service ${name} not found`);
		return found;
	});

	const createSwarmService = vi.fn(async (spec: CapturedSpec): Promise<ServiceState> => {
		const state: ServiceState = {
			ID: `svc-${spec.Name}`,
			Version: { Index: 1 },
			Spec: { Name: spec.Name },
			CreatedAt: "2026-01-01T00:00:00.000Z",
			UpdatedAt: "2026-01-01T00:00:00.000Z",
		};
		services.set(spec.Name, state);
		tasks.set(spec.Name, [{ NodeID: "n1", Status: { State: "running" } }]);
		return state;
	});

	const dockerService = {
		getDockerClient: () => ({
			getNetwork: vi.fn((name: string) => ({
				inspect: vi.fn(async () => ({ Id: `net-${name}`, Driver: "overlay", Containers: {} })),
				connect: vi.fn(async () => undefined),
			})),
			getVolume: vi.fn(() => ({
				inspect: vi.fn(async () => {
					throw Object.assign(new Error("not found"), { statusCode: 404 });
				}),
			})),
			createVolume: vi.fn(async () => ({ name: "created" })),
		}),
		getSwarmInfo: vi.fn(async () => ({ NodeID: "n1", LocalNodeState: "active", ControlAvailable: true })),
		inspectSwarmService,
		createSwarmService,
		updateSwarmService: vi.fn(async () => undefined),
		removeSwarmService: vi.fn(async (name: string) => {
			services.delete(name);
			tasks.delete(name);
		}),
		listSwarmServiceTasks: vi.fn(async (name: string) => tasks.get(name) ?? []),
		ensureOverlayNetwork: vi.fn(async () => undefined),
		getSwarmServiceLogs: vi.fn(async () => ""),
	} as unknown as DockerService;

	return {
		dockerService,
		services,
		tasks,
		createSwarmService: createSwarmService as unknown as {
			mock: { calls: Array<[CapturedSpec]>; results: unknown[] };
			toHaveBeenCalledTimes: (n: number) => void;
			mockRejectedValue: (e: unknown) => void;
			mockRejectedValueOnce: (e: unknown) => void;
		},
	};
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
	const mocks = makeDockerService();
	const env = makeEnv(envOverrides);
	const hostnameService = new EnvHostnameService(makeEnv(envOverrides));
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
	const supervisor = new TraefikSupervisorService(mocks.dockerService, hostnameService, env, settings);
	return { supervisor, settings, env, ...mocks };
}

/** Bypass the private HTTP entrypoint probe — liveness is covered by the task state. */
function stubProbe(supervisor: TraefikSupervisorService): void {
	vi.spyOn(
		supervisor as unknown as { probeEntrypoint(candidates: string[], port?: number): Promise<EntrypointProbe> },
		"probeEntrypoint",
	).mockResolvedValue({ reachable: true, host: "deployer-traefik", port: 80, statusCode: 200, latencyMs: 1 });
}

describe("PlatformNetwork", () => {
	it("names the network without prefix segment when prefix empty", () => {
		expect(PlatformNetwork.name("")).toBe("deployer-platform");
	});

	it("isolates networks per prefix", () => {
		expect(PlatformNetwork.name("acme")).toBe("deployer-platform-acme");
	});
});

describe("TraefikSupervisorService (swarm-global ingress)", () => {
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

	it("converges by creating a GLOBAL swarm service when missing", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, createSwarmService } = makeSupervisor({ TRAEFIK_CONFIG_BASE_PATH: configDir });
		stubProbe(supervisor);

		const state = await supervisor.ensureDesiredState();

		expect(state).toBe("converged");
		expect(createSwarmService.mock.calls).toHaveLength(1);
		const spec = createSwarmService.mock.calls[0]?.[0];
		expect(spec?.Name).toBe("deployer-traefik");
		// GLOBAL = one task per node: the single-node case is the same code path.
		expect(spec?.Mode).toEqual({ Global: {} });
		expect(spec?.Labels?.["deployer.platform.role"]).toBe("ingress");
	});

	it("does not recreate when the service already exists (idempotent update)", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, createSwarmService, dockerService } = makeSupervisor({
			TRAEFIK_CONFIG_BASE_PATH: configDir,
		});
		stubProbe(supervisor);

		await supervisor.ensureDesiredState();
		await supervisor.ensureDesiredState();

		expect(createSwarmService.mock.calls).toHaveLength(1);
		expect(dockerService.updateSwarmService).toHaveBeenCalledTimes(1);
	});

	it("enables the swarm docker provider and the file provider", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, createSwarmService } = makeSupervisor({ TRAEFIK_CONFIG_BASE_PATH: configDir });
		stubProbe(supervisor);

		await supervisor.ensureDesiredState();

		const cmd = createSwarmService.mock.calls[0]?.[0]?.TaskTemplate.ContainerSpec.Command ?? [];
		// Workloads are SWARM SERVICES — without swarmMode the provider never
		// reads their labels and every route 404s.
		expect(cmd).toContain("--providers.docker.swarmMode=true");
		expect(cmd).toContain("--providers.file.directory=/config");
		expect(cmd).toContain("--providers.file.watch=true");
	});

	it("mounts the docker socket and the config volume read-only", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, createSwarmService } = makeSupervisor({ TRAEFIK_CONFIG_BASE_PATH: configDir });
		stubProbe(supervisor);

		await supervisor.ensureDesiredState();

		const mounts = createSwarmService.mock.calls[0]?.[0]?.TaskTemplate.ContainerSpec.Mounts ?? [];
		const sources = mounts.map((mount) => `${String(mount.Source)}:${String(mount.Target)}:${String(mount.ReadOnly)}`);
		expect(sources).toContain("/var/run/docker.sock:/var/run/docker.sock:true");
		expect(sources).toContain("deployer-traefik-config:/config:true");
	});

	it("attaches the overlay under the service name so the ingress is addressable", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, createSwarmService, dockerService } = makeSupervisor({
			TRAEFIK_CONFIG_BASE_PATH: configDir,
		});
		stubProbe(supervisor);

		await supervisor.ensureDesiredState();

		expect(dockerService.ensureOverlayNetwork).toHaveBeenCalled();
		expect(createSwarmService.mock.calls[0]?.[0]?.TaskTemplate.Networks).toEqual([
			{ Target: "deployer-platform-overlay", Aliases: ["deployer-traefik"] },
		]);
	});

	it("derives the prefixed service name from DEPLOYER_PREFIX", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, createSwarmService } = makeSupervisor({
			DEPLOYER_PREFIX: "acme",
			TRAEFIK_CONFIG_BASE_PATH: configDir,
		});
		stubProbe(supervisor);

		await supervisor.ensureDesiredState();

		expect(createSwarmService.mock.calls[0]?.[0]?.Name).toBe("deployer-traefik-acme");
	});

	it("publishes the entry port in HOST mode (a global service cannot use ingress)", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, createSwarmService } = makeSupervisor({ TRAEFIK_CONFIG_BASE_PATH: configDir });
		stubProbe(supervisor);

		await supervisor.ensureDesiredState();

		expect(createSwarmService.mock.calls[0]?.[0]?.EndpointSpec?.Ports).toEqual([
			{ TargetPort: 80, PublishedPort: 80, Protocol: "tcp", PublishMode: "host" },
		]);
	});

	it("adds the websecure entrypoint + HTTP→HTTPS redirect when TLS is enabled", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, createSwarmService } = makeSupervisor({
			DEPLOYER_TRAEFIK_TLS_ENABLED: true,
			TRAEFIK_CONFIG_BASE_PATH: configDir,
		});
		stubProbe(supervisor);

		await supervisor.ensureDesiredState();

		const spec = createSwarmService.mock.calls[0]?.[0];
		expect(spec?.TaskTemplate.ContainerSpec.Command).toContain("--entrypoints.websecure.address=:443");
		expect(spec?.EndpointSpec?.Ports).toEqual([
			{ TargetPort: 80, PublishedPort: 80, Protocol: "tcp", PublishMode: "host" },
			{ TargetPort: 443, PublishedPort: 443, Protocol: "tcp", PublishMode: "host" },
		]);
	});

	it("publishes no host port in production (headless behind the operator's proxy)", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, createSwarmService } = makeSupervisor({
			NODE_ENV: "production",
			TRAEFIK_CONFIG_BASE_PATH: configDir,
		});
		stubProbe(supervisor);

		await supervisor.ensureDesiredState();

		expect(createSwarmService.mock.calls[0]?.[0]?.EndpointSpec?.Ports ?? []).toEqual([]);
	});

	it("marks Traefik DEGRADED when the entry port is unavailable (no silent fallback)", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, createSwarmService } = makeSupervisor({ TRAEFIK_CONFIG_BASE_PATH: configDir });
		stubProbe(supervisor);
		vi.spyOn(supervisor as unknown as { delay(ms: number): Promise<void> }, "delay").mockResolvedValue();

		// The engine rejects the global service because the entry port is
		// already bound on the node.
		createSwarmService.mockRejectedValueOnce(
			new Error(
				"failed to program external connectivity on endpoint deployer-traefik: failed to bind host port 0.0.0.0:80/tcp: address already in use",
			),
		);

		const state = await supervisor.ensureDesiredState();

		// NO headless fallback — the conflict surfaces as an ERROR the web can
		// see and remediate (set a different entry port).
		expect(state).toBe("degraded");
		expect(supervisor.getStateSnapshot().detail).toContain("entry port 80 is already in use");
	});

	it("reports the entire ingress process info (swarm process + entry + urls)", async () => {
		const configDir = await makeConfigDir();
		const { supervisor } = makeSupervisor({ TRAEFIK_CONFIG_BASE_PATH: configDir });
		stubProbe(supervisor);
		await supervisor.ensureDesiredState();

		const info = await supervisor.getProcessInfo();

		expect(info.supervisorId).toBe("platform-ingress-traefik");
		expect(info.process.kind).toBe("swarm");
		const swarmProcess = info.process.kind === "swarm" ? info.process : null;
		expect(swarmProcess?.desired.name).toBe("deployer-traefik");
		expect(swarmProcess?.desired.image).toBe("traefik:v3.3");
		expect(swarmProcess?.desired.mode).toBe("global");
		expect(swarmProcess?.live.exists).toBe(true);
		expect(swarmProcess?.live.runningTasks).toBe(1);
		expect(info.entry).toEqual({ port: 80, isDefault80: true, source: "default" });
		expect(info.urls.entryUrl).toBe("http://localhost:80");
		expect(info.urls.apiUrl).toBe("http://api.deployer.localhost");
		expect(info.config.dynamicApiFile).toContain("dynamic-api.yml");
	});

	it("reports the web-configured entry port (local-db source) in process info", async () => {
		const configDir = await makeConfigDir();
		const { supervisor } = makeSupervisor({ TRAEFIK_CONFIG_BASE_PATH: configDir }, 8080);
		stubProbe(supervisor);
		await supervisor.ensureDesiredState();

		const info = await supervisor.getProcessInfo();

		expect(info.entry).toEqual({ port: 8080, isDefault80: false, source: "local-db" });
		expect(info.process.kind).toBe("swarm");
		expect(info.urls.entryUrl).toBe("http://localhost:8080");
	});

	it("reports unhealthy when the ingress task is not running on this node", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, tasks } = makeSupervisor({ TRAEFIK_CONFIG_BASE_PATH: configDir });
		stubProbe(supervisor);
		await supervisor.ensureDesiredState();
		tasks.set("deployer-traefik", [{ NodeID: "n1", Status: { State: "pending" } }]);

		const health = await supervisor.getHealth();

		expect(health.healthy).toBe(false);
		expect(health.detail).toContain("not running");
	});

	it("degrades instead of throwing when convergence keeps failing", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, createSwarmService } = makeSupervisor({ TRAEFIK_CONFIG_BASE_PATH: configDir });
		stubProbe(supervisor);
		// Retries are real backoff delays — collapse them for determinism.
		vi.spyOn(supervisor as unknown as { delay(ms: number): Promise<void> }, "delay").mockResolvedValue();
		createSwarmService.mockRejectedValue(new Error("engine refused"));

		const state = await supervisor.ensureDesiredState();

		expect(state).toBe("degraded");
		expect(supervisor.getStateSnapshot().detail).toContain("engine refused");
	});
});
