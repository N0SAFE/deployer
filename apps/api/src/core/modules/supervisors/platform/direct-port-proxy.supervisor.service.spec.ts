import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { join } from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import {
	DIRECT_PORT_PROXY_SUPERVISOR_ID,
	DirectPortProxySupervisorService,
} from "./direct-port-proxy.supervisor.service";
import { TraefikSupervisorService } from "./traefik-supervisor.service";
import { SupervisorEventBus } from "@/core/modules/supervisors/supervisor-event.bus";
import type { PlatformWebTargetService } from "../../platform-ingress/services/platform-web-target.service";
import type { DockerService } from "@/core/modules/docker/services/docker.service";
import type { EnvService } from "@/config/env/env.service";

type InspectResult = {
	Id: string;
	State: { Running: boolean; ExitCode?: number; StartedAt?: string };
	Labels?: Record<string, string>;
};

type DockerodeError = Error & { statusCode?: number };

/** dockerode client mock: containers by name; the API's OWN container is
 *  resolvable by id (HOSTNAME) so target auto-resolution works. */
function makeDockerClient(opts: { selfId: string; selfName: string }) {
	const containers = new Map<string, InspectResult>();
	// STABLE per-container mocks: getContainer must return the SAME object per
	// name (inspect/start/remove feed across calls) so assertions on them hold.
	const containerMocks = new Map<string, { inspect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }>();
	const getContainerMocks = (name: string) => {
		let mocks = containerMocks.get(name);
		if (mocks === undefined) {
			mocks = {
				inspect: vi.fn(async () => {
					if (name === opts.selfId) {
						return { Id: opts.selfId, Name: `/${opts.selfName}`, State: { Running: true } };
					}
					const state =
						containers.get(name) ??
						[...containers.values()].find((c) => c.Id === name);
					if (state === undefined) {
						const err = new Error("not found") as DockerodeError;
						err.statusCode = 404;
						throw err;
					}
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
			};
			containerMocks.set(name, mocks);
		}
		return mocks;
	};
	const client = {
		getContainer: vi.fn((name: string) => getContainerMocks(name)),
		createContainer: vi.fn(async (opts_: { name: string; Labels?: Record<string, string> }) => {
			const state: InspectResult = { Id: `id-${opts_.name}`, State: { Running: false, ExitCode: 0 }, Labels: opts_.Labels ?? {} };
			containers.set(opts_.name, state);
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
		})),
		getVolume: vi.fn(() => ({
			inspect: vi.fn(async () => {
				throw Object.assign(new Error("not found"), { statusCode: 404 });
			}),
		})),
		createVolume: vi.fn(async () => ({ name: "created" })),
		pull: vi.fn((_image: string, cb: (err: Error | null, stream: NodeJS.ReadableStream | null) => void) => {
			const stream = new PassThrough();
			cb(null, stream);
			queueMicrotask(() => stream.end());
		}),
	};
	return { client, containers };
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
	return { getStateSnapshot: () => ({ state, detail: state === "degraded" ? "entry port 80 is already in use" : null }) };
}

function makeSupervisor(opts: { envOverrides?: Partial<Record<string, unknown>>; configDir: string; traefikState?: "converged" | "degraded" | "idle" | "converging" | null }) {
	const { client, containers } = makeDockerClient({ selfId: "0123456789ab", selfName: "deployer-api" });
	const dockerService = { getDockerClient: () => client } as unknown as DockerService;
	const env = makeEnv(opts.envOverrides, opts.configDir);
	const webTarget = {
		resolveWebTarget: vi.fn(async () => null),
	} as unknown as PlatformWebTargetService;
	const supervisor = new DirectPortProxySupervisorService(dockerService, env, webTarget);

	const traefik = opts.traefikState !== null && opts.traefikState !== undefined ? makeTraefikShim(opts.traefikState) : null;
	(supervisor as unknown as { orchestrator: { register: ReturnType<typeof vi.fn>; getSupervisorById: ReturnType<typeof vi.fn> } }).orchestrator = {
		register: vi.fn(),
		getSupervisorById: vi.fn(async () => traefik),
	};

	return { supervisor, client, containers, env, traefik };
}

function portBindingsOf(createArgs: Record<string, unknown>): Record<string, unknown> {
	const hostConfig = createArgs.HostConfig as Record<string, unknown>;
	return (hostConfig.PortBindings ?? {}) as Record<string, unknown>;
}

function hostBindsOf(createArgs: Record<string, unknown>): string[] {
	const hostConfig = createArgs.HostConfig as Record<string, unknown>;
	return (hostConfig.Binds ?? []) as string[];
}

function extraHostsOf(createArgs: Record<string, unknown>): string[] | undefined {
	const hostConfig = createArgs.HostConfig as Record<string, unknown>;
	return hostConfig.ExtraHosts as string[] | undefined;
}

async function makeConfigDir(): Promise<string> {
	const base = process.env.TMPDIR ?? "/tmp";
	return await mkdtemp(join(base, "direct-port-proxy-"));
}

describe("DirectPortProxySupervisorService", () => {
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

	it("stays REMOVED while Traefik is the working single entry point (no ports, no config)", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, client } = makeSupervisor({ configDir, traefikState: "converged" });

		const state = await supervisor.ensureDesiredState();

		expect(state).toBe("converged");
		expect(client.createContainer).not.toHaveBeenCalled();
		// No nginx.conf written while inactive.
		await expect(readFile(join(configDir, "nginx.conf"), "utf8")).rejects.toThrow();
	});

	it("takes over the API + web host ports when Traefik FAILS (entry-port conflict)", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, client } = makeSupervisor({ configDir, traefikState: "degraded" });

		const state = await supervisor.ensureDesiredState();

		expect(state).toBe("converged");
		expect(client.createContainer).toHaveBeenCalledTimes(1);
		const createArgs = vi.mocked(client.createContainer).mock.calls[0]?.[0] as Record<string, unknown>;
		// The proxy publishes ONLY the service ports (never port 80).
		expect(portBindingsOf(createArgs)).toEqual({
			"3005/tcp": [{ HostPort: "3005" }],
			"3000/tcp": [{ HostPort: "3000" }],
		});
		// Config shared via the NAMED volume at the nginx config dir.
		expect(hostBindsOf(createArgs)).toContain("deployer-port-proxy-config:/etc/nginx/port-proxy:ro");
		// Forwards recorded for restart-on-change + probe reporting.
		const label = (createArgs.Labels as Record<string, string>)[DirectPortProxySupervisorService.FORWARDS_LABEL];
		expect(label).toBe(
			JSON.stringify([
				{ hostPort: 3005, target: "deployer-api", targetPort: 3005 },
				{ hostPort: 3000, target: "web-dev", targetPort: 3000 },
			]),
		);
		// Generated nginx config proxies to the container names (embedded DNS).
		const conf = await readFile(join(configDir, "nginx.conf"), "utf8");
		expect(conf).toContain("listen 3005");
		expect(conf).toContain("proxy_pass http://deployer-api:3005");
		expect(conf).toContain("listen 3000");
		expect(conf).toContain("proxy_pass http://web-dev:3000");
	});

	it("targets host.docker.internal when running bare-metal (ExtraHosts added)", async () => {
		const configDir = await makeConfigDir();
		delete process.env.HOSTNAME; // no docker container id → bare metal
		const { supervisor, client } = makeSupervisor({ configDir, traefikState: "degraded" });

		await supervisor.ensureDesiredState();

		const createArgs = vi.mocked(client.createContainer).mock.calls[0]?.[0] as Record<string, unknown>;
		expect(extraHostsOf(createArgs)).toContain("host.docker.internal:host-gateway");
		const conf = await readFile(join(configDir, "nginx.conf"), "utf8");
		expect(conf).toContain("proxy_pass http://host.docker.internal:3005");
	});

	it("closes itself when Traefik recovers (proxy container removed)", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, client } = makeSupervisor({ configDir, traefikState: "degraded" });
		await supervisor.ensureDesiredState();
		expect(client.createContainer).toHaveBeenCalledTimes(1);

		// Traefik converges → same supervisor re-evaluates → proxy removes itself.
		const { traefik } = makeSupervisor({ configDir, traefikState: "converged" });
		await (supervisor as unknown as { orchestrator: { getSupervisorById: ReturnType<typeof vi.fn> } }).orchestrator.getSupervisorById.mockResolvedValue(traefik);

		const state = await supervisor.ensureDesiredState();

		expect(state).toBe("converged");
		expect(client.getContainer("deployer-port-proxy").remove).toHaveBeenCalled();
	});

	it("holds off while Traefik is still converging (no boot churn)", async () => {
		const configDir = await makeConfigDir();
		// Traefik registered but not yet converged (boot window) → the proxy
		// must NOT take over; its `state-changed` event triggers it if Traefik
		// then FAILS.
		const { supervisor, client } = makeSupervisor({ configDir, traefikState: "idle" });

		const state = await supervisor.ensureDesiredState();

		expect(state).toBe("converged");
		expect(client.createContainer).not.toHaveBeenCalled();
		expect(client.getContainer("deployer-port-proxy").remove).toHaveBeenCalled();
	});

	it("omits the managed-web forward when that flag is disabled (no 502 target)", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, client } = makeSupervisor({
			configDir,
			envOverrides: { DIRECT_PROXY_WEB_TARGET: undefined },
			traefikState: "degraded",
		});
		// No web target resolved (no managed web, no DEPLOYER_WEB_TARGET) →
		// the web forward is omitted — otherwise nginx would 502 to a
		// non-existent container.
		await (supervisor as unknown as { webTarget: { resolveWebTarget: ReturnType<typeof vi.fn> } }).webTarget.resolveWebTarget.mockResolvedValue(null);

		await supervisor.ensureDesiredState();

		const createArgs = vi.mocked(client.createContainer).mock.calls[0]?.[0] as Record<string, unknown>;
		expect(portBindingsOf(createArgs)).toEqual({ "3005/tcp": [{ HostPort: "3005" }] });
		const conf = await readFile(join(configDir, "nginx.conf"), "utf8");
		expect(conf).not.toContain("listen 3000");
	});

	it("drops a host port already bound elsewhere and converges with the remaining forwards", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, client } = makeSupervisor({ configDir, traefikState: "degraded" });

		// First create attempt: start fails because host port 3005 is taken.
		client.createContainer.mockImplementationOnce(async (opts_: { name: string }) => {
			const state: InspectResult = { Id: `id-${opts_.name}`, State: { Running: false, ExitCode: 0 }, Labels: {} };
			return {
				id: state.Id,
				start: vi.fn(async () => {
					throw new Error(
						"failed to program external connectivity on endpoint deployer-port-proxy: failed to bind host port 0.0.0.0:3005/tcp: address already in use",
					);
				}),
				inspect: vi.fn(async () => state),
			};
		});

		const state = await supervisor.ensureDesiredState();

		expect(state).toBe("converged");
		// Recreate WITHOUT the conflicting 3005; the web forward survives.
		expect(client.createContainer).toHaveBeenCalledTimes(2);
		const secondArgs = vi.mocked(client.createContainer).mock.calls[1]?.[0] as Record<string, unknown>;
		expect(portBindingsOf(secondArgs)).toEqual({ "3000/tcp": [{ HostPort: "3000" }] });
		const conf = await readFile(join(configDir, "nginx.conf"), "utf8");
		expect(conf).not.toContain("listen 3005");
		expect(conf).toContain("listen 3000");
	});

	it("reacts to Traefik events through the supervisor bus (start on fail, close on recovery)", async () => {
		const configDir = await makeConfigDir();
		const { supervisor, client, traefik } = makeSupervisor({ configDir, traefikState: "degraded" });
		const bus = new SupervisorEventBus();
		(supervisor as unknown as { eventBus: SupervisorEventBus }).eventBus = bus;
		await supervisor.onModuleInit();

		// Traefik degraded → health-snapshot event → proxy starts.
		bus.emit({ supervisorId: TraefikSupervisorService.getIdentifier(), type: "health-snapshot", at: new Date().toISOString(), healthy: false });
		await vi.waitFor(() => expect(client.createContainer).toHaveBeenCalledTimes(1));

		// Traefik recovers (entry port configured) → health-snapshot event → proxy closes.
		(supervisor as unknown as { orchestrator: { getSupervisorById: ReturnType<typeof vi.fn> } }).orchestrator.getSupervisorById.mockResolvedValue({
			getStateSnapshot: () => ({ state: "converged" as const, detail: null }),
		});
		bus.emit({ supervisorId: TraefikSupervisorService.getIdentifier(), type: "health-snapshot", at: new Date().toISOString(), healthy: true });
		await vi.waitFor(() => expect(client.getContainer("deployer-port-proxy").remove).toHaveBeenCalled());
	});

	it("reports process info with the direct rescue URLs while active", async () => {
		const configDir = await makeConfigDir();
		const { supervisor } = makeSupervisor({ configDir, traefikState: "degraded" });
		await supervisor.ensureDesiredState();

		const info = await supervisor.getProcessInfo();

		expect(info.process.kind).toBe("docker");
		expect(info.urls.apiDirectUrl).toBe("http://localhost:3005");
		expect(info.urls.webDirectUrl).toBe("http://localhost:3000");
	});

	it("reports inactive (no direct URLs) while Traefik owns the ingress", async () => {
		const configDir = await makeConfigDir();
		const { supervisor } = makeSupervisor({ configDir, traefikState: "converged" });
		// Health reflects convergence first (base semantics): converge to
		// REMOVED, then the probe reports healthy + inactive.
		await supervisor.ensureDesiredState();

		const snapshot = await supervisor.getHealth();
		expect(snapshot.healthy).toBe(true);
		expect(snapshot.payload.active).toBe(false);

		const info = await supervisor.getProcessInfo();
		expect(info.urls.apiDirectUrl).toBeNull();
		expect(info.urls.webDirectUrl).toBeNull();
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