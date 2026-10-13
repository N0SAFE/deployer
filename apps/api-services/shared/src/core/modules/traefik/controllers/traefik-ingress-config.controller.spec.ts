import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { EnvService } from "@/config/env/env.module";
import { deriveIngressProviderToken } from "@/core/modules/platform-ingress/services/ingress-provider-token";
import type { TraefikIngressConfigService } from "@/core/modules/traefik/services/traefik-ingress-config.service";
import { TraefikIngressConfigController } from "@/core/modules/traefik/controllers/traefik-ingress-config.controller";

const config = { http: { routers: {}, services: {} } };

function controller() {
	const service = { buildDynamicConfig: vi.fn(() => Promise.resolve(config)) } as unknown as TraefikIngressConfigService;
	const env = { get: vi.fn((key: string) => (key === "AUTH_SECRET" ? "s3cret" : undefined)) } as unknown as EnvService;
	return { controller: new TraefikIngressConfigController(service, env), service };
}

describe("TraefikIngressConfigController", () => {
	it("serves the dynamic configuration to an ingress presenting the derived token", async () => {
		const { controller: c } = controller();
		expect(await c.dynamicConfig(deriveIngressProviderToken("s3cret"))).toBe(config);
	});

	it("refuses anyone else — the endpoint is reachable through Traefik itself", async () => {
		const { controller: c, service } = controller();
		await expect(c.dynamicConfig(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
		await expect(c.dynamicConfig("guess")).rejects.toBeInstanceOf(UnauthorizedException);
		expect(service.buildDynamicConfig).not.toHaveBeenCalled();
	});
});
