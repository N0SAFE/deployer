import { describe, expect, it, vi } from "vitest";
import { TraefikConfigRefresher } from "./traefik-config-refresher.service";
import { TraefikSupervisorService } from "../../supervisors/platform/traefik-supervisor.service";
import type { TraefikPlatformConfigService } from "./traefik-platform-config.service";
import type { SupervisorOrchestratorService } from "@repo/nest-supervisor-core/supervisor-orchestrator.service";

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
		// A failed write is an EXPECTED first-boot state (the schema does not exist
		// yet), so it is logged at `log` and RETRIED rather than thrown or warned.
		const logSpy = vi.spyOn(refresher["logger"], "log");

		refresher.refresh();
		await vi.waitFor(() => expect(logSpy).toHaveBeenCalled());
		expect(convergeNow).toHaveBeenCalledWith(TraefikSupervisorService.getIdentifier());
	});

	/**
	 * The retry that makes the boot-time write meaningful.
	 *
	 * The API boots BEFORE setup provisions the database, so the first write
	 * ALWAYS loses this race on a fresh install. Nothing retried it, which is why
	 * `dynamic-web.yml` was never written and `web.<host>` 404'd on a completed
	 * setup — real observed state, not a hypothesis.
	 */
	it("retries the write until the global database exists", async () => {
		vi.useFakeTimers();
		try {
			let attempts = 0;
			const writePlatformConfigs = vi.fn(async () => {
				attempts += 1;
				// The first two attempts lose the race; the third lands once the
				// schema exists.
				if (attempts < 3) throw new Error('relation "app_config" does not exist');
			});
			const convergeNow = vi.fn(async () => "converged" as const);
			const refresher = new TraefikConfigRefresher(
				{ writePlatformConfigs } as unknown as TraefikPlatformConfigService,
				{ convergeNow } as unknown as SupervisorOrchestratorService,
			);

			refresher.refresh();
			// Drive the chained timers through the two failures and the success.
			await vi.advanceTimersByTimeAsync(10_000);

			expect(writePlatformConfigs).toHaveBeenCalledTimes(3);

			// And it STOPS once the write succeeds — a permanent retry loop would
			// keep re-publishing configs forever.
			await vi.advanceTimersByTimeAsync(30_000);
			expect(writePlatformConfigs).toHaveBeenCalledTimes(3);
		} finally {
			vi.useRealTimers();
		}
	});
});