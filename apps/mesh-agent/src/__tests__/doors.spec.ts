import type { NodeDoorsSetting } from "@deployer/mesh-network";
import { describe, expect, it } from "vitest";

import { DOOR_HASH_LABEL, DOOR_LABEL, doorContainerSpec, planDoors, renderDoorNginxConfig } from "../doors/door-config";
import { DoorConverger } from "../doors/door-converger";
import type { ContainerSummary, DockerEngine } from "../doors/docker-engine";
import { lanCandidates } from "../endpoint-discovery";

const setting: NodeDoorsSetting = {
	image: "nginx:alpine",
	network: "deployer-platform-overlay",
	namePrefix: "deployer",
	entryPort: 80,
	upstream: "deployer-traefik",
	lanes: { local: { upstreamPort: 8000 }, private: { upstreamPort: 8001 }, lan: null },
	rescue: [
		{ host: "api.deployer.localhost", target: "deployer-api", port: 3005 },
		{ host: "web.deployer.localhost", target: "deployer-managed-web", port: 3000 },
	],
};

describe("door config", () => {
	it("listens on every address INSIDE the container — the host scope comes from HostIp", () => {
		const config = renderDoorNginxConfig("local", setting);
		expect(config).toContain("listen 80 default_server;");
		expect(config).not.toMatch(/listen 127\.0\.0\.1/);
	});

	it("routes the local lane to Traefik's local entrypoint with the rescue fallback", () => {
		const config = renderDoorNginxConfig("local", setting);
		expect(config).toContain("set $deployer_upstream deployer-traefik:8000;");
		expect(config).toContain("api.deployer.localhost deployer-api:3005;");
		expect(config).toContain("error_page 502 503 504 = @deployer_rescue;");
	});

	it("gives the private lane no rescue hosts", () => {
		const config = renderDoorNginxConfig("private", setting);
		expect(config).toContain("set $deployer_upstream deployer-traefik:8001;");
		expect(config).not.toContain("deployer-api:3005");
	});

	it("binds the local door to loopback, the private door to the mesh address and the LAN door to the LAN address", () => {
		const setting3: NodeDoorsSetting = { ...setting, lanes: { ...setting.lanes, lan: { upstreamPort: 8001 } } };
		const { desired } = planDoors(setting3, "100.88.4.2", "192.168.1.10");
		expect(desired.map((door) => [door.lane, door.bindAddress])).toEqual([
			["local", "127.0.0.1"],
			["private", "100.88.4.2"],
			["lan", "192.168.1.10"],
		]);
		const spec = doorContainerSpec(desired[1]!) as { HostConfig: { PortBindings: Record<string, unknown> } };
		expect(spec.HostConfig.PortBindings["80/tcp"]).toEqual([{ HostIp: "100.88.4.2", HostPort: "80" }]);
	});

	it("never falls back to 0.0.0.0 when the mesh or LAN address is unknown", () => {
		const setting3: NodeDoorsSetting = { ...setting, lanes: { ...setting.lanes, lan: { upstreamPort: 8001 } } };
		const { desired, absent } = planDoors(setting3, null, null);
		expect(desired.map((door) => door.lane)).toEqual(["local"]);
		expect(absent).toEqual(["private", "lan"]);
	});

	it("plans no private or LAN door when the lanes are disabled", () => {
		const off = planDoors({ ...setting, lanes: { ...setting.lanes, private: null } }, "100.88.4.2", "192.168.1.10");
		expect(off.absent).toEqual(["private", "lan"]);
	});
});

class MemoryEngine implements DockerEngine {
	containers = new Map<string, ContainerSummary & { spec: Record<string, unknown> }>();
	created = 0;
	removed = 0;
	failStart: string | null = null;
	network = true;
	portHolder: string | null = null;
	findPortHolder() {
		return Promise.resolve(this.portHolder);
	}
	inspectContainer(name: string) {
		return Promise.resolve(this.containers.get(name) ?? null);
	}
	createContainer(name: string, spec: Record<string, unknown>) {
		this.created += 1;
		this.containers.set(name, { id: name, running: false, labels: spec.Labels as Record<string, string>, spec, networks: [spec.HostConfig ? String((spec.HostConfig as { NetworkMode?: string }).NetworkMode) : ""], publishedPorts: ["80/tcp", "8080/tcp"] });
		return Promise.resolve(name);
	}
	startContainer(id: string) {
		if (this.failStart !== null) return Promise.reject(new Error(this.failStart));
		const container = this.containers.get(id);
		if (container) container.running = true;
		return Promise.resolve();
	}
	removeContainer(id: string) {
		this.removed += 1;
		this.containers.delete(id);
		return Promise.resolve();
	}
	imageExists() {
		return Promise.resolve(true);
	}
	pullImage() {
		return Promise.resolve();
	}
	networkExists() {
		return Promise.resolve(this.network);
	}
}

describe("DoorConverger", () => {
	it("creates the doors, then leaves them alone while nothing changes", async () => {
		const engine = new MemoryEngine();
		const doors = new DoorConverger(engine);
		const first = await doors.converge(setting, "100.88.4.2", null);
		expect(first.map((view) => view.state)).toEqual(["running", "running"]);
		await doors.converge(setting, "100.88.4.2", null);
		expect(engine.created).toBe(2);
		expect(engine.removed).toBe(0);
	});

	it("does not create a door while another container holds its port, and creates it once released", async () => {
		const engine = new MemoryEngine();
		engine.portHolder = "deployer-traefik";
		const doors = new DoorConverger(engine);
		const held = await doors.converge(setting, "100.88.4.2", null);
		expect(held.map((view) => view.state)).toEqual(["absent", "absent"]);
		expect(held[0]?.detail).toContain("deployer-traefik");
		expect(engine.created).toBe(0);

		engine.portHolder = null;
		const released = await doors.converge(setting, "100.88.4.2", null);
		expect(released.map((view) => view.state)).toEqual(["running", "running"]);
		expect(engine.created).toBe(2);
	});

	it("recreates a running door that lost its network and published port", async () => {
		const engine = new MemoryEngine();
		const doors = new DoorConverger(engine);
		await doors.converge(setting, "100.88.4.2", null);
		const door = engine.containers.get("deployer-door-local");
		if (door === undefined) throw new Error("door missing");
		door.networks = [];
		door.publishedPorts = [];

		await doors.converge(setting, "100.88.4.2", null);

		expect(engine.created).toBe(3);
		expect(engine.containers.get("deployer-door-local")?.publishedPorts).not.toEqual([]);
	});

	it("recreates a door when its plan changes", async () => {
		const engine = new MemoryEngine();
		const doors = new DoorConverger(engine);
		await doors.converge(setting, "100.88.4.2", null);
		await doors.converge({ ...setting, entryPort: 8080 }, "100.88.4.2", null);
		expect(engine.created).toBe(4);
	});

	it("removes the private door when the lane is disabled", async () => {
		const engine = new MemoryEngine();
		const doors = new DoorConverger(engine);
		await doors.converge(setting, "100.88.4.2", null);
		await doors.converge({ ...setting, lanes: { ...setting.lanes, private: null } }, "100.88.4.2", null);
		expect([...engine.containers.keys()]).toEqual(["deployer-door-local"]);
	});

	it("reports, never removes, a foreign container squatting a door name", async () => {
		const engine = new MemoryEngine();
		engine.containers.set("deployer-door-local", { id: "x", running: true, labels: {}, spec: {}, networks: [], publishedPorts: [] });
		const [local] = await new DoorConverger(engine).converge(setting, null, null);
		expect(local?.state).toBe("failed");
		expect(engine.containers.get("deployer-door-local")?.id).toBe("x");
	});

	it("does not leave a container behind when it cannot bind its port", async () => {
		const engine = new MemoryEngine();
		engine.failStart = "address already in use";
		const [local] = await new DoorConverger(engine).converge(setting, null, null);
		expect(local).toMatchObject({ state: "failed", detail: "address already in use" });
		expect(engine.containers.size).toBe(0);
	});

	it("waits for the overlay instead of failing hard", async () => {
		const engine = new MemoryEngine();
		engine.network = false;
		const [local] = await new DoorConverger(engine).converge(setting, null, null);
		expect(local?.state).toBe("absent");
	});

	it("does nothing before the API published a plan", async () => {
		const engine = new MemoryEngine();
		expect(await new DoorConverger(engine).converge(null, "100.88.4.2", null)).toEqual([]);
		expect(engine.created).toBe(0);
	});

	it("labels doors so it only ever touches its own", async () => {
		const engine = new MemoryEngine();
		await new DoorConverger(engine).converge(setting, null, null);
		const labels = engine.containers.get("deployer-door-local")?.labels ?? {};
		expect(labels[DOOR_LABEL]).toBe("local");
		expect(labels[DOOR_HASH_LABEL]).toMatch(/^[0-9a-f]{16}$/);
	});
});

describe("lanCandidates", () => {
	it("keeps real interfaces and drops Docker, mesh, loopback and link-local", () => {
		const candidates = lanCandidates(
			{
				eth0: [{ address: "192.168.1.10", family: "IPv4", internal: false } as never, { address: "fe80::1", family: "IPv6", internal: false } as never],
				lo: [{ address: "127.0.0.1", family: "IPv4", internal: true } as never],
				docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false } as never],
				"br-1234": [{ address: "172.18.0.1", family: "IPv4", internal: false } as never],
				"deployer-mesh": [{ address: "100.88.0.4", family: "IPv4", internal: false } as never],
				wlan0: [{ address: "169.254.3.3", family: "IPv4", internal: false } as never],
			},
			51820,
			"deployer-mesh",
		);
		expect(candidates).toEqual([{ kind: "lan", host: "192.168.1.10", port: 51820 }]);
	});
});
