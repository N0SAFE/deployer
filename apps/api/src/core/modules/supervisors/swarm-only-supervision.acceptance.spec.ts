import { describe, expect, it } from "vitest";

import {
	resolveSupervisorRuntime,
	swarmRuntimeForScope,
} from "@repo/nest-docker/services/docker-supervisor-runtime";
import { PLATFORM_SUPERVISOR_TOPOLOGY } from "@/core/modules/supervisors/supervisor-topology";
import { GLOBAL_DB_SUPERVISOR_ID } from "@/core/modules/supervisors/database/global-db-supervisor.service";
import { DATABASE_SERVICE_SUPERVISOR_ID } from "@/core/modules/supervisors/database/database-service-supervisor.service";
import { DIRECT_PORT_PROXY_SUPERVISOR_ID } from "@/core/modules/supervisors/platform/direct-port-proxy.supervisor.service";
import { PLATFORM_MANAGED_WEB_SUPERVISOR_ID } from "@/core/modules/supervisors/platform/managed-web-supervisor.service";
import { PLATFORM_REDIS_SUPERVISOR_ID } from "@/core/modules/supervisors/platform/redis-supervisor.service";
import { PLATFORM_INGRESS_SUPERVISOR_ID } from "@/core/modules/supervisors/platform/traefik-supervisor.service";
import { PLATFORM_WIREGUARD_SUPERVISOR_ID } from "@/core/modules/supervisors/platform/wireguard-supervisor.service";

/**
 * ACCEPTANCE TEST — "every supervisor runs on the swarm, and the global
 * database is on the swarm too".
 *
 * This suite encodes the requirement as assertions over the REAL supervisor
 * identifiers and the REAL runtime resolver, so a regression that reintroduces
 * a plain-container path (or drops the global DB off the swarm) fails here
 * rather than only showing up in production.
 */

/** Every docker-backed platform supervisor that must be swarm-scheduled. */
const SWARM_SUPERVISORS = [
	PLATFORM_INGRESS_SUPERVISOR_ID,
	PLATFORM_REDIS_SUPERVISOR_ID,
	PLATFORM_MANAGED_WEB_SUPERVISOR_ID,
	DIRECT_PORT_PROXY_SUPERVISOR_ID,
	PLATFORM_WIREGUARD_SUPERVISOR_ID,
	GLOBAL_DB_SUPERVISOR_ID,
	DATABASE_SERVICE_SUPERVISOR_ID,
] as const;

describe("requirement: every supervisor uses the swarm", () => {
	it("classifies ALL platform supervisors with a swarm scope (none unclassified)", () => {
		const classified = PLATFORM_SUPERVISOR_TOPOLOGY.map((entry) => entry.supervisorId);
		for (const supervisorId of SWARM_SUPERVISORS) {
			expect(classified, `supervisor "${supervisorId}" is not in the topology table`).toContain(supervisorId);
		}
	});

	it("resolves EVERY supervisor to a swarm runtime on an active engine (never a container)", () => {
		for (const entry of PLATFORM_SUPERVISOR_TOPOLOGY) {
			const resolved = resolveSupervisorRuntime({
				managed: false,
				swarmActive: true,
				scope: entry.scope,
			});
			expect(resolved.runtime, `${entry.supervisorId} must be swarm-scheduled`).toBe(
				swarmRuntimeForScope(entry.scope),
			);
			expect(["swarm-global", "swarm-replicated"]).toContain(resolved.runtime);
		}
	});

	it("maps node-local supervisors to swarm-GLOBAL (one task per node)", () => {
		const nodeLocal = PLATFORM_SUPERVISOR_TOPOLOGY.filter((entry) => entry.scope === "node-local").map(
			(entry) => entry.supervisorId,
		);
		// The ingress, the failover proxy and the WireGuard sidecar are per-node.
		expect(nodeLocal).toContain(PLATFORM_INGRESS_SUPERVISOR_ID);
		expect(nodeLocal).toContain(DIRECT_PORT_PROXY_SUPERVISOR_ID);
		expect(nodeLocal).toContain(PLATFORM_WIREGUARD_SUPERVISOR_ID);
		for (const supervisorId of nodeLocal) {
			expect(resolveSupervisorRuntime({ managed: false, swarmActive: true, scope: "node-local" }).runtime).toBe(
				"swarm-global",
			);
			expect(supervisorId.length).toBeGreaterThan(0);
		}
	});

	it("maps mesh-wide supervisors to swarm-REPLICATED (one shared service)", () => {
		const meshWide = PLATFORM_SUPERVISOR_TOPOLOGY.filter((entry) => entry.scope === "mesh-wide").map(
			(entry) => entry.supervisorId,
		);
		expect(meshWide).toContain(PLATFORM_REDIS_SUPERVISOR_ID);
		expect(meshWide).toContain(PLATFORM_MANAGED_WEB_SUPERVISOR_ID);
		// Database supervisors are shared cluster state, not per-node copies.
		expect(meshWide).toContain(GLOBAL_DB_SUPERVISOR_ID);
		expect(meshWide).toContain(DATABASE_SERVICE_SUPERVISOR_ID);
		for (const _supervisorId of meshWide) {
			expect(resolveSupervisorRuntime({ managed: false, swarmActive: true, scope: "mesh-wide" }).runtime).toBe(
				"swarm-replicated",
			);
		}
	});

	it("NEVER returns a container runtime for ANY scope (the fallback was removed)", () => {
		const scopes = ["node-local", "mesh-wide"] as const;
		const swarmStates = [true, false] as const;
		for (const scope of scopes) {
			for (const swarmActive of swarmStates) {
				const resolved = resolveSupervisorRuntime({ managed: false, swarmActive, scope });
				expect(resolved.runtime).not.toBe("container");
			}
		}
	});

	it("degrades to `unavailable` (never a container) when the engine is not a swarm", () => {
		for (const scope of ["node-local", "mesh-wide"] as const) {
			const resolved = resolveSupervisorRuntime({ managed: false, swarmActive: false, scope });
			expect(resolved.runtime).toBe("unavailable");
			expect(resolved.reason).toContain("SwarmBootstrapService");
		}
	});

	it("still yields `managed` (link-only) when the deployment owns the process", () => {
		for (const scope of ["node-local", "mesh-wide"] as const) {
			expect(resolveSupervisorRuntime({ managed: true, swarmActive: true, scope }).runtime).toBe("managed");
			// Even on a non-swarm engine, `managed` wins: the supervisor never spawns.
			expect(resolveSupervisorRuntime({ managed: true, swarmActive: false, scope }).runtime).toBe("managed");
		}
	});
});

describe("requirement: the global database is on the swarm", () => {
	it("is classified mesh-wide (shared cluster state, not a per-node container)", () => {
		const globalDb = PLATFORM_SUPERVISOR_TOPOLOGY.find(
			(entry) => entry.supervisorId === GLOBAL_DB_SUPERVISOR_ID,
		);
		expect(globalDb).toBeDefined();
		expect(globalDb?.scope).toBe("mesh-wide");
	});

	it("resolves to swarm-replicated on an active engine", () => {
		const resolved = resolveSupervisorRuntime({ managed: false, swarmActive: true, scope: "mesh-wide" });
		expect(resolved.runtime).toBe("swarm-replicated");
	});

	it("is never scheduled as a plain container, even pre-swarm", () => {
		const resolved = resolveSupervisorRuntime({ managed: false, swarmActive: false, scope: "mesh-wide" });
		expect(resolved.runtime).not.toBe("container");
		expect(resolved.runtime).toBe("unavailable");
	});
});
