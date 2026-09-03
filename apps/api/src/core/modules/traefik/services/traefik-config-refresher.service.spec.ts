import { describe, expect, it, vi } from "vitest";
import { TraefikConfigRefresher } from "./traefik-config-refresher.service";
import { TraefikSupervisorService } from "../../supervisors/platform/traefik-supervisor.service";
import type { TraefikPlatformConfigService } from "./traefik-platform-config.service";
import type { SupervisorOrchestratorService } from "../../supervisors/supervisor-orchestrator.service";

describe("TraefikConfigRefresher (core-module config update trigger)", () => {
	it("writes config THEN re-converges the process, never throwing", async () => {
		const writePlatformConfigs = vi.fn(async () => undefined);
		const convergeNow = vi.fn(async () => "converged" as const);
		const refresher = new TraefikConfigRefresher(
			{ writePlatformConfigs } as unknown as TraefikPlatformConfigService,
			{ convergeNow } as unknown as SupervisorOrchestratorService,
		);

		refresher.refresh();
		await vi.waitFor(() => expect(writePlatformConfigs).toHaveBeenCalled());
		expect(convergeNow).toHaveBeenCalledWith(TraefikSupervisorService.getIdentifier());
	});

	it("keeps running when the config write fails and logs instead of throwing", async () => {
		const writePlatformConfigs = vi.fn(async () => {
			throw new Error("write failed");
		});
		const convergeNow = vi.fn(async () => "converged" as const);
		const refresher = new TraefikConfigRefresher(
			{ writePlatformConfigs } as unknown as TraefikPlatformConfigService,
			{ convergeNow } as unknown as SupervisorOrchestratorService,
		);
		const warnSpy = vi.spyOn(refresher["logger"], "warn");

		refresher.refresh();
		await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());
		expect(convergeNow).toHaveBeenCalledWith(TraefikSupervisorService.getIdentifier());
	});
});