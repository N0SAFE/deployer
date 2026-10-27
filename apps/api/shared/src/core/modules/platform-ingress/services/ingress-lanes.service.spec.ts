import { describe, expect, it, vi } from "vitest";
import { defaultIngressLanes, type IngressLanes } from "@deployer/contracts-entities/entities/ingress/index";

import type { EnvService } from "../../../../config/env/env.module";
import type { ClusterSettingsService } from "../../mesh-agent/cluster-settings.service";
import { INGRESS_LANES_SETTING, IngressLanesService } from "./ingress-lanes.service";

const env = { get: vi.fn((key: string) => (key === "DEPLOYER_TRAEFIK_HTTP_PORT" ? 8080 : undefined)) } as unknown as EnvService;

function settings(stored: IngressLanes | undefined) {
	return {
		read: vi.fn(() => Promise.resolve(stored)),
		write: vi.fn((_key: string, schema: { parse: (v: unknown) => unknown }, value: unknown) => Promise.resolve(schema.parse(value))),
	} as unknown as ClusterSettingsService;
}

describe("IngressLanesService", () => {
	it("reads local-only on the configured entry port when nothing is stored (never fails open)", async () => {
		expect(await new IngressLanesService(settings(undefined), env).getLanes()).toEqual(defaultIngressLanes(8080));
	});

	it("reads the replicated lanes when they exist", async () => {
		const stored = { ...defaultIngressLanes(80), private: { enabled: true, domain: "corp.internal", exposeOnLan: false } };
		expect(await new IngressLanesService(settings(stored), env).getLanes()).toEqual(stored);
	});

	it("writes the lanes under the replicated key, validated", async () => {
		const store = settings(undefined);
		const lanes = defaultIngressLanes(80);
		await new IngressLanesService(store, env).setLanes(lanes);
		expect(store.write).toHaveBeenCalledWith(INGRESS_LANES_SETTING, expect.anything(), lanes);
	});
});
