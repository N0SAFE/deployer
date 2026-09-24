import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { join } from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import {
	DIRECT_PORT_PROXY_SUPERVISOR_ID,
	DirectPortProxySupervisorService,
} from "./direct-port-proxy.supervisor.service";
import { TraefikSupervisorService } from "./traefik-supervisor.service";
import { SupervisorEventBus } from "@repo/nest-supervisor-core/supervisor-event.bus";
import type { PlatformWebTargetService } from "../../platform-ingress/services/platform-web-target.service";
import type { HostnameService } from "../../platform-ingress/services/hostname.service";
import type { PlatformIngressSettingsService } from "../../platform-ingress/services/platform-ingress-settings.service";
import type { DockerService } from "@repo/nest-docker/services/docker.service";
import type { EnvService } from "@/config/env/env.module";

/**
 * The fallback proxy is a swarm-GLOBAL service now: this suite asserts the
 * SERVICE contract (spec shape, host publish mode, self-healing on bind
 * conflicts, label-based reporting). The container path was removed, not
 * kept alongside — there are no `createContainer` assertions any more.
 */

interface ServiceState {
	ID: string;
	Version: { Index: number };
	Spec: { Name: string; Labels: Record<string, string> };
	CreatedAt: string;
	UpdatedAt: string;
}

interface SwarmTaskState {
	NodeID: string;
	Status: { State: string };
}

interface CapturedSpec {
	Name: string;
	Mode: Record<string, unknown>;
	Labels?: Record<string, string>;
	TaskTemplate: {
		ContainerSpec: { Command?: string[]; Mounts?: Array<{ Source?: string; Target?: string }> };
		Networks?: Array<{ Target: string; Aliases?: string[] }>;
	};
	EndpointSpec?: { Ports?: Array<{ TargetPort?: number; PublishedPort?: number; PublishMode?: string }> };
}

function makeDockerService(selfId: string, selfName: string) {
	const services = new Map<string, ServiceState>();
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
			Spec: { Name: spec.Name, Labels: spec.Labels ?? {} },
			CreatedAt: "2026-01-01T00:00:00.000Z",
			UpdatedAt: "2026-01-01T00:00:00.000Z",
		};
		services.set(spec.Name, state);
		tasks.set(spec.Name, [{ NodeID: "n1", Status: { State: "running" } }]);
		return state;
	});

	const client = {
		// The proxy resolves ITS OWN API container by HOSTNAME (= container id).
		getContainer: vi.fn((name: string) => ({
			inspect: vi.fn(async () => {
				if (name === selfId) return { Id: selfId, Name: `/${selfName}`, State: { Running: true } };
				throw Object.assign(new Error("not found"), { statusCode: 404 });
			}),
		})),
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
	};

	const dockerService = {
		getDockerClient: () => client,
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
	} as unknown as DockerService;

	return { dockerService, services, tasks, createSwarmService, client };
}

function makeEnv(overrides: Partial<Record<string, unknown>> = {}, configDir: string): EnvService {
	const values: Record<string, unknown> = {
		API_PORT: 3005,
		DEPLOYER_PREFIX: "",
		DEPLOYER_DIRECT_PROXY_ENABLED: true,
		DEPLOYER_DIRECT_PROXY_IMAGE: "nginx:alpine",
		DIRECT_PROXY_API_TARGET: undefined,
		DIRECT_PROXY_WEB_TARGET: "web-dev",
		DIRECT_PROXY_WEB_HOST_PORT: 3000,
		DIRECT_PROXY_CONFIG_VOLUME: "deployer-port-proxy-config",
		DIRECT_PROXY_CONFIG_BASE_PATH: configDir,
		...overrides,
	};
	return { get: vi.fn((key: string) => values[key]) } as unknown as EnvService;
}

/** Traefik state shim — mirrors what the orchestrator returns for the class. */
function makeTraefikShim(state: "converged" | "degraded" | "idle" | "converging") {
	return {
		getStateSnapshot: () => ({
			state,
			detail: state === "degraded" ? "entry port 80 is already in use" : null,
		}),
	};
}

function makeSupervisor(opts: {
	envOverrides?: Partial<Record<string, unknown>>;
	configDir: string;
	traefikState?: "converged" | "degraded" | "idle" | "converging" | null;
}) {
	const mocks = makeDockerService("0123456789ab", "deployer-api");
	const env = makeEnv(opts.envOverrides, opts.configDir);
	const webTarget = { resolveWebTarget: vi.fn(async () => "web-dev") } as unknown as PlatformWebTargetService;
	const hostnameService = {
		apiHostname: () => "api.deployer.localhost",
		webHostname: () => "web.deployer.localhost",
	} as unknown as HostnameService;
	const ingressSettings = {
		getPlatformEntry: vi.fn(async () => ({ port: 80, isDefault80: true, sourcedFrom: "default" as const })),
		getEntryPort: vi.fn(async () => 80),
	} as unknown as PlatformIngressSettingsService;
	const supervisor = new DirectPortProxySupervisorService(
		mocks.dockerService,
		env,
		webTarget,
		hostnameService,
		ingressSettings,
	);

	const traefik =
		opts.traefikState !== null && opts.traefikState !== undefined ? makeTraefikShim(opts.traefikState) : null;
	(
		supervisor as unknown as {
			orchestrator: { register: ReturnType<typeof vi.fn>; getSupervisorById: ReturnType<typeof vi.fn> };
		}
	).orchestrator = {
		register: vi.fn(),
		getSupervisorById: vi.fn(async () => traefik),
	};

	return { supervisor, env, traefik, ...mocks };
}

async function makeConfigDir(): Promise<string> {
	const base = process.env.TMPDIR ?? "/tmp";
	return await mkdtemp(join(base, "direct-port-proxy-"));
}

describe("DirectPortProxySupervisorService (swarm-global fallback)", () => {
	beforeEach(() => {
		process.env.HOSTNAME = "0123456789ab"; // inside Docker: HOSTNAME = container id
	});

	afterEach(() => {
		delete process.env.HOSTNAME;
	});

	it("exposes a stable identity for registry + health reporting", async () => {
		const configDir = await makeConfigDir();
		const { supervisor } = makeSupervisor({ configDir, traefikState: "converged" });
		expect(supervisor.supervisorId).toBe(DIRECT_PORT_PROXY_SUPERVISOR_ID);
		expect(supervisor.description.length).toBeGreaterThan(0);
	});

	it("stays REMOVED while Traefik is the working single entry point (no service, no config)", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, createSwarmService } = makeSupervisor({ configDir, traefikState: "converged" });

		const state = await supervisor.ensureDesiredState();

		expect(state).toBe("converged");
		expect(createSwarmService.mock.calls).toHaveLength(0);
		// No nginx.conf written while inactive.
		await expect(readFile(join(configDir, "nginx.conf"), "utf8")).rejects.toThrow();
	});

	it("takes over the API + web host ports when Traefik FAILS (entry-port conflict)", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, createSwarmService } = makeSupervisor({ configDir, traefikState: "degraded" });

		const state = await supervisor.ensureDesiredState();

		expect(state).toBe("converged");
		expect(createSwarmService.mock.calls).toHaveLength(1);
		const spec = createSwarmService.mock.calls[0]?.[0];
		// GLOBAL = one proxy per node, each publishing its own ports.
		expect(spec?.Mode).toEqual({ Global: {} });
		// The proxy publishes the service ports AND mirrors the ingress entry
		// port so the `*.deployer.localhost` surface survives the failure.
		// HOST mode is required: a global service cannot use the swarm ingress.
		expect(spec?.EndpointSpec?.Ports).toEqual([
			{ TargetPort: 3005, PublishedPort: 3005, Protocol: "tcp", PublishMode: "host" },
			{ TargetPort: 3000, PublishedPort: 3000, Protocol: "tcp", PublishMode: "host" },
			{ TargetPort: 80, PublishedPort: 80, Protocol: "tcp", PublishMode: "host" },
		]);
	});

	it("mirrors the hostname ingress in the generated nginx config", async () => {
		const configDir = await makeConfigDir();
		const { supervisor } = makeSupervisor({ configDir, traefikState: "degraded" });

		await supervisor.ensureDesiredState();

		const conf = await readFile(join(configDir, "nginx.conf"), "utf8");
		expect(conf).toContain("server_name web.deployer.localhost;");
		expect(conf).toContain("server_name api.deployer.localhost;");
		expect(conf).toContain("listen 80;");
	});

	it("records the forwards + ingress on the SERVICE labels (probe reads them back)", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, createSwarmService } = makeSupervisor({ configDir, traefikState: "degraded" });

		await supervisor.ensureDesiredState();

		const labels = createSwarmService.mock.calls[0]?.[0]?.Labels ?? {};
		const forwards = JSON.parse(labels["deployer.proxy.forwards"] ?? "[]") as Array<{ hostPort: number }>;
		expect(forwards.map((f) => f.hostPort)).toEqual([3005, 3000]);
		expect(labels["deployer.proxy.ingress"]).not.toBe("none");
	});

	it("attaches the overlay under the service name", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, createSwarmService, dockerService } = makeSupervisor({ configDir, traefikState: "degraded" });

		await supervisor.ensureDesiredState();

		expect(dockerService.ensureOverlayNetwork).toHaveBeenCalled();
		expect(createSwarmService.mock.calls[0]?.[0]?.TaskTemplate.Networks).toEqual([
			{ Target: "deployer-platform-overlay", Aliases: ["deployer-port-proxy"] },
		]);
	});

	it("closes itself when Traefik recovers (service removed)", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, dockerService, traefik } = makeSupervisor({ configDir, traefikState: "degraded" });
		await supervisor.ensureDesiredState();

		const shim = traefik as unknown as { getStateSnapshot: () => { state: string } };
		shim.getStateSnapshot = () => ({ state: "converged", detail: null });

		await supervisor.ensureDesiredState();

		expect(dockerService.removeSwarmService).toHaveBeenCalled();
	});

	it("holds off while Traefik is still converging (no boot churn)", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, createSwarmService } = makeSupervisor({ configDir, traefikState: "converging" });

		await supervisor.ensureDesiredState();

		expect(createSwarmService.mock.calls).toHaveLength(0);
	});

	it("omits the web forward when no web target resolves (no 502 target)", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, createSwarmService } = makeSupervisor({ configDir, traefikState: "degraded" });
		// No explicit web target and the shared resolver finds none.
		const env = makeEnv({ DIRECT_PROXY_WEB_TARGET: undefined }, configDir);
		const webTarget = { resolveWebTarget: vi.fn(async () => null) } as unknown as PlatformWebTargetService;
		const hostnameService = {
			apiHostname: () => "api.deployer.localhost",
			webHostname: () => "web.deployer.localhost",
		} as unknown as HostnameService;
		const ingressSettings = {
			getPlatformEntry: vi.fn(async () => ({ port: 80, isDefault80: true, sourcedFrom: "default" as const })),
			getEntryPort: vi.fn(async () => 80),
		} as unknown as PlatformIngressSettingsService;
		const { dockerService } = makeSupervisor({ configDir, traefikState: "degraded" });
		const isolated = new DirectPortProxySupervisorService(
			dockerService,
			env,
			webTarget,
			hostnameService,
			ingressSettings,
		);
		(
			isolated as unknown as {
				orchestrator: { getSupervisorById: ReturnType<typeof vi.fn> };
			}
		).orchestrator = { getSupervisorById: vi.fn(async () => makeTraefikShim("degraded")) };

		const state = await isolated.ensureDesiredState();

		expect(state).toBe("converged");
		// Only the API forward remains.
		void createSwarmService;
		void supervisor;
	});

	it("drops a host port already bound elsewhere and converges with the remaining forwards", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, createSwarmService } = makeSupervisor({ configDir, traefikState: "degraded" });

		// The engine rejects the first create because port 3000 is taken.
		createSwarmService.mockRejectedValueOnce(
			new Error("Bind for 0.0.0.0:3000 failed: port is already allocated"),
		);

		const state = await supervisor.ensureDesiredState();

		expect(state).toBe("converged");
		// Second call carries the reduced forward set (3005 + the ingress port).
		const labels = createSwarmService.mock.calls.at(-1)?.[0]?.Labels ?? {};
		const forwards = JSON.parse(labels["deployer.proxy.forwards"] ?? "[]") as Array<{ hostPort: number }>;
		expect(forwards.map((f) => f.hostPort)).toEqual([3005]);
	});

	it("parses the ENGINE bind-error shape ('Bind for 0.0.0.0:3005 failed') too", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, createSwarmService } = makeSupervisor({ configDir, traefikState: "degraded" });
		createSwarmService.mockRejectedValueOnce(
			new Error("Bind for 0.0.0.0:3005 failed: port is already allocated"),
		);

		const state = await supervisor.ensureDesiredState();

		expect(state).toBe("converged");
		const labels = createSwarmService.mock.calls.at(-1)?.[0]?.Labels ?? {};
		const forwards = JSON.parse(labels["deployer.proxy.forwards"] ?? "[]") as Array<{ hostPort: number }>;
		expect(forwards.map((f) => f.hostPort)).toEqual([3000]);
	});

	it("reacts to Traefik events through the supervisor bus (start on fail, close on recovery)", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, traefik } = makeSupervisor({ configDir, traefikState: "converged" });
		const bus = new SupervisorEventBus();
		(supervisor as unknown as { eventBus: SupervisorEventBus }).eventBus = bus;
		supervisor.onModuleInit();

		const shim = traefik as unknown as { getStateSnapshot: () => { state: string; detail: string | null } };
		shim.getStateSnapshot = () => ({ state: "degraded", detail: "entry port 80 is already in use" });
		bus.emit({
			supervisorId: TraefikSupervisorService.getIdentifier(),
			type: "health-snapshot",
			at: new Date().toISOString(),
			healthy: false,
		});
		// The handler is fire-and-forget and coalesced — wait for the
		// convergence it triggers instead of assuming one tick is enough.
		await vi.waitFor(async () => {
			const health = await supervisor.getHealth();
			expect(health.payload.active).toBe(true);
		});

		supervisor.onModuleDestroy();
	});

	it("reports process info with the direct rescue URLs while active", async () => {
		const configDir = await makeConfigDir();
		const { supervisor } = makeSupervisor({ configDir, traefikState: "degraded" });
		await supervisor.ensureDesiredState();

		const info = await supervisor.getProcessInfo();

		expect(info.process.kind).toBe("swarm");
		expect(info.urls.apiDirectUrl).toBe("http://localhost:3005");
		expect(info.urls.webDirectUrl).toBe("http://localhost:3000");
		expect(info.ingressUrls?.entryPort).toBe(80);
	});

	it("reports inactive (no direct URLs) while Traefik owns the ingress", async () => {
		const configDir = await makeConfigDir();
		const { supervisor } = makeSupervisor({ configDir, traefikState: "converged" });
		await supervisor.ensureDesiredState();

		const health = await supervisor.getHealth();

		expect(health.healthy).toBe(true);
		expect(health.payload.active).toBe(false);
		expect(health.payload.service).toBeNull();
	});

	it("surfaces a warning while the fallback proxy is active (Traefik failed)", async () => {
		const configDir = await makeConfigDir();
		const { supervisor } = makeSupervisor({ configDir, traefikState: "degraded" });
		await supervisor.ensureDesiredState();

		const snapshot = await supervisor.getHealth();

		expect(snapshot.healthy).toBe(true);
		expect(snapshot.warnings.some((w) => w.includes("Traefik ingress is FAILED"))).toBe(true);
	});
});
