import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { defaultIngressLanes, type IngressLanes } from "@deployer/contracts-entities/entities/ingress/index";

import { TEST_TUNNEL_ID, testEdgeRegistry } from "@/core/modules/edge/testing/edge-registry.fixture";
import type { DockerService } from "@deployer/nest-docker/services/docker.service";

import type { EnvService } from "@/config/env/env.module";
import type { MeshAgentClient } from "@/core/modules/mesh-agent/mesh-agent.client";
import { EnvHostnameService } from "@/core/modules/platform-ingress/services/hostname.service";
import type { IngressLanesService } from "@/core/modules/platform-ingress/services/ingress-lanes.service";
import { deriveIngressProviderToken } from "@/core/modules/platform-ingress/services/ingress-provider-token";
import type { PlatformWebTargetService } from "@/core/modules/platform-ingress/services/platform-web-target.service";
import { PlatformNetwork, TraefikSupervisorService, type EntrypointProbe } from "@/core/modules/supervisors/platform/traefik-supervisor.service";

/**
 * The ingress is one GLOBAL swarm service with one entrypoint per lane. These tests
 * pin the properties the architecture depends on:
 *
 *   - routes come from the API (HTTP provider) — no Docker socket, no config volume;
 *   - only the `direct` public lane publishes host ports, every other lane is
 *     reached through the node doors the mesh agent runs;
 *   - the doors plan is published into the replicated roster on every convergence.
 */

type ServiceState = {
	ID: string;
	Version: { Index: number };
	Spec: { Name: string };
	CreatedAt: string;
	UpdatedAt: string;
}

type CapturedSpec = {
	Name: string;
	Mode: Record<string, unknown>;
	Labels?: Record<string, string>;
	TaskTemplate: {
		ContainerSpec: {
			Command?: string[];
			Args?: string[];
			Mounts?: { Source?: string; Target?: string; ReadOnly?: boolean }[];
		};
		Networks?: { Target: string; Aliases?: string[] }[];
	};
	EndpointSpec?: { Ports?: { TargetPort?: number; PublishedPort?: number; PublishMode?: string }[] };
}

function makeDockerService(bootstrapLabels: Record<string, string> | null = null, legacyForwarder = false) {
	const services = new Map<string, ServiceState>();
	const tasks = new Map<string, { NodeID: string; Status: { State: string } }[]>();
	const removedContainers: string[] = [];

	const createSwarmService = vi.fn((spec: CapturedSpec): Promise<ServiceState> => {
		const state: ServiceState = {
			ID: `svc-${spec.Name}`,
			Version: { Index: 1 },
			Spec: { Name: spec.Name },
			CreatedAt: "2026-01-01T00:00:00.000Z",
			UpdatedAt: "2026-01-01T00:00:00.000Z",
		};
		services.set(spec.Name, state);
		tasks.set(spec.Name, [{ NodeID: "n1", Status: { State: "running" } }]);
		return Promise.resolve(state);
	});

	const dockerService = {
		getDockerClient: () => ({
			getNetwork: vi.fn((name: string) => ({
				inspect: vi.fn(() => Promise.resolve({ Id: `net-${name}`, Driver: "overlay", Containers: {} })),
				connect: vi.fn(() => Promise.resolve()),
			})),
			getVolume: vi.fn(() => ({ inspect: vi.fn(() => Promise.reject(Object.assign(new Error("nf"), { statusCode: 404 }))) })),
			createVolume: vi.fn(() => Promise.resolve({ name: "created" })),
			getContainer: vi.fn((name: string) => ({
				inspect: vi.fn(() => {
					if (name === "deployer-ingress-forwarder") {
						return legacyForwarder ? Promise.resolve({ Id: "fwd", Config: { Labels: {} } }) : Promise.reject(new Error("no such container"));
					}
					if (bootstrapLabels === null) return Promise.reject(Object.assign(new Error(`No such container: ${name}`), { statusCode: 404 }));
					return Promise.resolve({ Id: "bootstrap", Config: { Labels: bootstrapLabels } });
				}),
				remove: vi.fn(() => {
					removedContainers.push(name);
					return Promise.resolve();
				}),
			})),
		}),
		getSwarmInfo: vi.fn(() => Promise.resolve({ NodeID: "n1", LocalNodeState: "active", ControlAvailable: true })),
		inspectSwarmService: vi.fn((name: string) => {
			const found = services.get(name);
			return found === undefined ? Promise.reject(new NotFoundException(`service ${name} not found`)) : Promise.resolve(found);
		}),
		createSwarmService,
		updateSwarmService: vi.fn(() => Promise.resolve()),
		removeSwarmService: vi.fn((name: string) => {
			services.delete(name);
			tasks.delete(name);
			return Promise.resolve();
		}),
		listSwarmServiceTasks: vi.fn((name: string) => Promise.resolve(tasks.get(name) ?? [])),
		ensureOverlayNetwork: vi.fn(() => Promise.resolve()),
		getSwarmServiceLogs: vi.fn(() => Promise.resolve("")),
	} as unknown as DockerService;

	return {
		dockerService,
		tasks,
		removedContainers,
		createSwarmService: createSwarmService as unknown as {
			mock: { calls: [CapturedSpec][] };
			mockRejectedValue: (e: unknown) => void;
			mockRejectedValueOnce: (e: unknown) => void;
		},
	};
}

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): EnvService {
	const values: Record<string, unknown> = {
		DEPLOYER_PREFIX: "",
		DEPLOYER_TRAEFIK_IMAGE: "traefik:v3.6.10",
		DEPLOYER_TRAEFIK_HTTP_PORT: 80,
		DEPLOYER_TRAEFIK_ACME_EMAIL: "ops@example.com",
		DEPLOYER_DOOR_IMAGE: "nginx:alpine",
		AUTH_SECRET: "test-secret",
		API_PORT: 3005,
		...overrides,
	};
	return { get: vi.fn((key: string) => values[key]) };
}

function makeSupervisor(options: {
	env?: Partial<Record<string, unknown>>;
	lanes?: IngressLanes;
	bootstrapLabels?: Record<string, string> | null;
	legacyForwarder?: boolean;
	meshWrite?: () => Promise<void>;
} = {}) {
	const mocks = makeDockerService(options.bootstrapLabels ?? null, options.legacyForwarder ?? false);
	const env = makeEnv(options.env);
	const lanes = { getLanes: vi.fn(() => Promise.resolve(options.lanes ?? defaultIngressLanes())) } as unknown as IngressLanesService;
	const writeSetting = vi.fn(options.meshWrite ?? (() => Promise.resolve()));
	const mesh = { writeSetting } as unknown as MeshAgentClient;
	const webTarget = { resolveWebTarget: vi.fn(() => Promise.resolve("deployer-managed-web")) } as unknown as PlatformWebTargetService;
	const supervisor = new TraefikSupervisorService(mocks.dockerService, new EnvHostnameService(env), env, lanes, mesh, webTarget, testEdgeRegistry().registry);
	vi.spyOn(
		supervisor as unknown as { probeEntrypoint(candidates: string[], port: number): Promise<EntrypointProbe> },
		"probeEntrypoint",
	).mockResolvedValue({ reachable: true, host: "deployer-traefik", port: 80, statusCode: 404, latencyMs: 1 });
	vi.spyOn(supervisor as unknown as { delay(ms: number): Promise<void> }, "delay").mockResolvedValue();
	return { supervisor, writeSetting, ...mocks };
}

const tunnelLanes = (): IngressLanes => ({
	...defaultIngressLanes(),
	public: { provider: TEST_TUNNEL_ID, domain: "apps.example.com", acknowledgedInboundPorts: false, options: { account: "acc" } },
});
const directLanes = (tls: boolean): IngressLanes => ({
	...defaultIngressLanes(),
	public: { provider: "direct", domain: "apps.example.com", acknowledgedInboundPorts: true, options: { tls } },
});

describe("PlatformNetwork", () => {
	it("isolates networks per prefix", () => {
		expect(PlatformNetwork.name("")).toBe("deployer-platform");
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

	describe("bootstrap-ingress handover", () => {
		it("defers while setup's bootstrap ingress still serves", async () => {
			const { supervisor, createSwarmService } = makeSupervisor({ bootstrapLabels: { "deployer.bootstrap": "true" } });
			expect(await supervisor.ensureDesiredState()).toBe("pending");
			expect(createSwarmService.mock.calls).toHaveLength(0);
			expect(supervisor.getStateSnapshot().detail).toContain("bootstrap ingress");
			supervisor.onModuleDestroy();
			expect(vi.getTimerCount()).toBe(0);
		});

		it("treats a container without the bootstrap label as not a handover", async () => {
			const { supervisor, createSwarmService } = makeSupervisor({ bootstrapLabels: { "deployer.platform.role": "ingress" } });
			expect(await supervisor.ensureDesiredState()).toBe("converged");
			expect(createSwarmService.mock.calls).toHaveLength(1);
		});
	});

	it("creates ONE global service, aliased on the overlay", async () => {
		const { supervisor, createSwarmService } = makeSupervisor();
		expect(await supervisor.ensureDesiredState()).toBe("converged");
		const spec = createSwarmService.mock.calls[0]?.[0];
		expect(spec?.Name).toBe("deployer-traefik");
		expect(spec?.Mode).toEqual({ Global: {} });
		expect(spec?.TaskTemplate.Networks).toEqual([{ Target: "deployer-platform-overlay", Aliases: ["deployer-traefik"] }]);
	});

	it("polls its routes from the API service alias, authenticated, with no socket and no volume", async () => {
		const { supervisor, createSwarmService } = makeSupervisor();
		await supervisor.ensureDesiredState();
		const container = createSwarmService.mock.calls[0]?.[0]?.TaskTemplate.ContainerSpec;
		const args = container?.Args ?? [];

		// `Args`, not `Command`: `Command` would replace the image's entrypoint.
		expect(container?.Command ?? []).toEqual([]);
		expect(args).toContain("--providers.http.endpoint=http://deployer-api:3005/internal/ingress/traefik-config");
		expect(args).toContain(`--providers.http.headers.X-Deployer-Ingress-Token=${deriveIngressProviderToken("test-secret")}`);
		expect(args.some((arg) => arg.startsWith("--providers.docker") || arg.startsWith("--providers.swarm") || arg.startsWith("--providers.file"))).toBe(false);
		expect(container?.Mounts ?? []).toEqual([]);
	});

	it("declares one entrypoint per lane, keeping :80 for the local lane", async () => {
		const { supervisor, createSwarmService } = makeSupervisor();
		await supervisor.ensureDesiredState();
		const args = createSwarmService.mock.calls[0]?.[0]?.TaskTemplate.ContainerSpec.Args ?? [];
		expect(args).toEqual(
			expect.arrayContaining(["--entrypoints.local.address=:80", "--entrypoints.private.address=:8001", "--entrypoints.public.address=:8002"]),
		);
	});

	it.each([
		["local only", defaultIngressLanes()],
		["private lane", { ...defaultIngressLanes(), private: { enabled: true, domain: "deployer.internal", exposeOnLan: false } }],
		["tunnel public lane", tunnelLanes()],
        ])("publishes NO host port with %s — the DOOR owns the entry port", async (_label, lanes) => {
                // ── THE DOOR BINDS THE ENTRY PORT; TRAEFIK MUST NOT ────────────────────
                // The per-node nginx door (`deployer-door-local`, and `-lan`/`-private` on
                // their lanes) binds `<address>:<entryPort>` and forwards to
                // `deployer-traefik:80` ON THE OVERLAY. Traefik's `:80` is a container port,
                // reached by service name — not a host port.
                //
                // Publishing it here creates a SECOND owner of one host port, and the swarm
                // task can never start. Measured on the affected node:
                //
                //   deployer-door-local → 127.0.0.1:80
                //   deployer-door-lan   → 192.168.1.27:80
                //   deployer-traefik    → PublishMode: host on 80
                //
                //   starting container failed: … Bind for 127.0.0.1:80 failed:
                //   port is already allocated
                //
                // which retried forever while the handover reported "the swarm ingress took
                // the entry port but is not routing the API yet". A previous version of this
                // test asserted the opposite, with a comment reasoning that promotion "must
                // keep the port" — right premise, wrong owner.
                const { supervisor, createSwarmService } = makeSupervisor({ lanes });
                await supervisor.ensureDesiredState();
                // The mapper OMITS `Ports` entirely when the list is empty (a swarm service
                // with no published port has no `EndpointSpec.Ports` key), so `undefined` is
                // the correct "publishes nothing" — not an empty array.
                expect(createSwarmService.mock.calls[0]?.[0]?.EndpointSpec?.Ports).toBeUndefined();
        });

        it("publishes ONLY the acknowledged `direct` edge, never the entry port", async () => {
                const { supervisor, createSwarmService } = makeSupervisor({ lanes: directLanes(false) });
                await supervisor.ensureDesiredState();
                const ports = createSwarmService.mock.calls[0]?.[0]?.EndpointSpec?.Ports ?? [];
                // `direct` is the one case where an operator explicitly takes inbound :80 for
                // Traefik itself. Note there is NO `TargetPort: 80` entry: the local lane
                // contributes nothing, so the only published port is the public edge.
                expect(ports.filter((port) => port.TargetPort === 80)).toHaveLength(0);
                expect(ports).toEqual([                        { TargetPort: 8002, PublishedPort: 80, Protocol: "tcp", PublishMode: "host" },
                ]);
        });
	it("adds :443, the redirect and a real ACME resolver for `direct` + TLS", async () => {
		const { supervisor, createSwarmService } = makeSupervisor({ lanes: directLanes(true) });
		await supervisor.ensureDesiredState();
		const spec = createSwarmService.mock.calls[0]?.[0];
		// The local entry port, then the public edge and its TLS port.
		expect(spec?.EndpointSpec?.Ports).toContainEqual({ TargetPort: 8443, PublishedPort: 443, Protocol: "tcp", PublishMode: "host" });
		expect(spec?.EndpointSpec?.Ports).toContainEqual({ TargetPort: 8002, PublishedPort: 80, Protocol: "tcp", PublishMode: "host" });
		const args = spec?.TaskTemplate.ContainerSpec.Args ?? [];
		expect(args).toContain("--entrypoints.public.http.redirections.entrypoint.to=public-tls");
		expect(args).toContain("--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=public");
		expect(spec?.TaskTemplate.ContainerSpec.Mounts?.map((m) => m.Target)).toEqual(["/acme"]);
	});

	it("publishes the doors plan into the mesh: local always, private only when enabled", async () => {
		const { supervisor, writeSetting } = makeSupervisor({
			lanes: { ...defaultIngressLanes(8080), private: { enabled: true, domain: "deployer.internal", exposeOnLan: false } },
		});
		await supervisor.ensureDesiredState();
		expect(writeSetting).toHaveBeenCalledWith(
			"node.doors",
			expect.objectContaining({
				entryPort: 8080,
				upstream: "deployer-traefik",
				network: "deployer-platform-overlay",
				namePrefix: "deployer",
				lanes: { local: { upstreamPort: 80 }, private: { upstreamPort: 8001 }, lan: null },
				rescue: [
					{ host: "api.deployer.localhost", target: "deployer-api", port: 3005 },
					{ host: "web.deployer.localhost", target: "deployer-managed-web", port: 3000 },
				],
			}),
		);
	});

	it("still converges when the mesh agent is unavailable — only the doors are missing", async () => {
		const { supervisor } = makeSupervisor({ meshWrite: () => Promise.reject(new Error("mesh agent is not reachable")) });
		expect(await supervisor.ensureDesiredState()).toBe("converged");
	});

	it("removes the legacy API-owned forwarder the agent's door replaces", async () => {
		const { supervisor, removedContainers } = makeSupervisor({ legacyForwarder: true });
		await supervisor.ensureDesiredState();
		expect(removedContainers).toContain("deployer-ingress-forwarder");
	});

	it("prefixes the service and the doors from DEPLOYER_PREFIX", async () => {
		const { supervisor, createSwarmService, writeSetting } = makeSupervisor({ env: { DEPLOYER_PREFIX: "acme" } });
		await supervisor.ensureDesiredState();
		expect(createSwarmService.mock.calls[0]?.[0]?.Name).toBe("deployer-traefik-acme");
		expect(writeSetting).toHaveBeenCalledWith("node.doors", expect.objectContaining({ namePrefix: "deployer-acme", upstream: "deployer-traefik-acme" }));
	});

	it("marks the ingress DEGRADED when a `direct` port is already bound", async () => {
		const { supervisor, createSwarmService } = makeSupervisor({ lanes: directLanes(false) });
		createSwarmService.mockRejectedValueOnce(new Error("failed to bind host port 0.0.0.0:80/tcp: address already in use"));
		expect(await supervisor.ensureDesiredState()).toBe("degraded");
		expect(supervisor.getStateSnapshot().detail).toContain("port 80 is already in use");
	});

	it("reports the lanes, the provider endpoint and the local console URL", async () => {
		const { supervisor } = makeSupervisor({ lanes: { ...tunnelLanes(), entryPort: 8080 } });
		await supervisor.ensureDesiredState();
		const info = await supervisor.getProcessInfo();
		expect(info.entry).toEqual({ port: 8080, isDefault80: false });
		expect(info.urls.entryUrl).toBe("http://web.deployer.localhost:8080");
		expect(info.config).toEqual({
			providerEndpoint: "http://deployer-api:3005/internal/ingress/traefik-config",
			lanes: ["local", "public"],
		});
	});

	it("reports unhealthy when this node's ingress task is not running", async () => {
		const { supervisor, tasks } = makeSupervisor();
		await supervisor.ensureDesiredState();
		tasks.set("deployer-traefik", [{ NodeID: "n1", Status: { State: "pending" } }]);
		const health = await supervisor.getHealth();
		expect(health.healthy).toBe(false);
		expect(health.detail).toContain("not running");
	});
});
