import { createGenesis, createJoinRequest, generateMeshIdentity } from "@repo/mesh-network";
import { describe, expect, it, vi } from "vitest";

import { MeshAdmissionService } from "./mesh-admission.service";
import { MeshAgentRequestError, type MeshAgentClient } from "./mesh-agent.client";

function statusWith(path: "direct" | "trying", interfaceUp = true) {
	return {
		memberId: "m1",
		signingKey: "k",
		wireguardKey: "w",
		cluster: { clusterId: "c1", cidr: "100.88.0.0/16", listenPort: 51820, address: "100.88.0.1", interfaceUp },
		members: [{ memberId: "m2", name: "b", kind: "node", address: "100.88.0.2", state: "active", endpoints: [], labels: {}, link: { path, endpoint: null, latestHandshakeAt: null } }],
		settingKeys: [],
		doors: [],
		lastGossipAt: null,
		lastError: null,
	};
}

describe("MeshAdmissionService", () => {
	const founder = generateMeshIdentity();
	const roster = createGenesis(founder, { name: "a" });
	const request = createJoinRequest(generateMeshIdentity(), { clusterId: roster.genesis.record.clusterId, cidr: "100.88.0.0/16" }, { name: "b" });

	it("tells a joiner which cluster to sign for", async () => {
		const mesh = { status: vi.fn(() => Promise.resolve(statusWith("direct"))) } as unknown as MeshAgentClient;
		expect(await new MeshAdmissionService(mesh).clusterForGrant()).toEqual({ clusterId: "c1", cidr: "100.88.0.0/16" });
	});

	it("admits a well-formed request through the local agent", async () => {
		const admit = vi.fn(() => Promise.resolve({ admission: {}, roster }));
		const result = await new MeshAdmissionService({ admit } as unknown as MeshAgentClient).admit(request);
		expect(admit).toHaveBeenCalledWith(request);
		expect(result).toEqual({ roster });
	});

	it("returns null — never throws — for garbage or a refused admission", async () => {
		const admit = vi.fn(() => Promise.reject(new MeshAgentRequestError("address-collision", 409, "taken")));
		const service = new MeshAdmissionService({ admit } as unknown as MeshAgentClient);
		expect(await service.admit({ not: "an entry" })).toBeNull();
		expect(admit).not.toHaveBeenCalled();
		expect(await service.admit(request)).toBeNull();
	});

	it("waits for a fresh WireGuard handshake before Swarm dials a manager", async () => {
		const status = vi.fn().mockResolvedValueOnce(statusWith("trying")).mockResolvedValueOnce(statusWith("direct"));
		const linked = await new MeshAdmissionService({ status } as unknown as MeshAgentClient).waitForLink(1_000, 1);
		expect(linked).toBe(true);
		expect(status).toHaveBeenCalledTimes(2);
	});

	it("gives up after the timeout instead of blocking setup forever", async () => {
		const status = vi.fn(() => Promise.resolve(statusWith("trying")));
		expect(await new MeshAdmissionService({ status } as unknown as MeshAgentClient).waitForLink(5, 1)).toBe(false);
	});
});
