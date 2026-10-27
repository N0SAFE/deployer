import { beforeEach, describe, expect, it, vi } from "vitest";
import z from "zod/v4";

import { ClusterSettingsService } from "./cluster-settings.service";
import { MeshAgentRequestError, MeshAgentUnavailableError, type MeshAgentClient } from "./mesh-agent.client";

function mesh(settings: Record<string, unknown> | Error) {
	const writes: [string, unknown][] = [];
	const client = {
		readSettings: vi.fn(() => (settings instanceof Error ? Promise.reject(settings) : Promise.resolve(settings))),
		writeSetting: vi.fn((key: string, value: unknown) => {
			writes.push([key, value]);
			return Promise.resolve();
		}),
	} as unknown as MeshAgentClient;
	return { client, writes };
}

const portSchema = z.object({ port: z.number() });

describe("ClusterSettingsService", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("reads undefined when the agent is not running yet, so the caller's default applies", async () => {
		const { client } = mesh(new MeshAgentUnavailableError("/run/deployer-mesh/agent.sock", "ENOENT"));
		const service = new ClusterSettingsService(client);
		expect(await service.read("k", portSchema)).toBeUndefined();
		expect(await service.available()).toBe(false);
	});

	it("reads undefined before the agent founded or joined a cluster", async () => {
		const { client } = mesh(new MeshAgentRequestError("not-in-cluster", 409, "not in a cluster"));
		expect(await new ClusterSettingsService(client).read("k", portSchema)).toBeUndefined();
	});

	it("rethrows an agent refusal that is not 'no cluster yet'", async () => {
		const { client } = mesh(new MeshAgentRequestError("internal", 500, "boom"));
		await expect(new ClusterSettingsService(client).read("k", portSchema)).rejects.toThrow(/boom/);
	});

	it("ignores a malformed value instead of trusting it", async () => {
		const { client } = mesh({ k: { port: "eighty" } });
		expect(await new ClusterSettingsService(client).read("k", portSchema)).toBeUndefined();
	});

	it("caches reads briefly and drops the cache on write", async () => {
		const { client } = mesh({ k: { port: 80 } });
		const service = new ClusterSettingsService(client);
		await service.read("k", portSchema);
		await service.read("k", portSchema);
		expect(client.readSettings).toHaveBeenCalledTimes(1);
		await service.write("k", portSchema, { port: 81 });
		await service.read("k", portSchema);
		expect(client.readSettings).toHaveBeenCalledTimes(2);
	});

	it("validates before writing and propagates a write failure", async () => {
		const { client, writes } = mesh({});
		const service = new ClusterSettingsService(client);
		await expect(service.write("k", portSchema, { port: "x" } as unknown as { port: number })).rejects.toThrow();
		expect(writes).toEqual([]);
		vi.mocked(client.writeSetting).mockRejectedValueOnce(new MeshAgentUnavailableError("/sock", "ENOENT"));
		await expect(service.write("k", portSchema, { port: 1 })).rejects.toBeInstanceOf(MeshAgentUnavailableError);
	});
});
