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

	/**
	 * SETUP WRITES `dynamic-setup.yml` LAST, SO THE BOOT WRITE ALONE LOSES.
	 *
	 * Observed on a completed onboarding:
	 *
	 *   API boot   12:50:52   writes the API's platform-setup route
	 *   handover   12:51:18   setup overwrites it with its own
	 *
	 * Setup's version has no redirect and names setup's own backend, so a reload
	 * after onboarding served the wizard's router instead of the API's landing
	 * page. The boot write is therefore followed by a second one, gated on the
	 * handover having finished.
	 */
	it("re-publishes the routes once the handover releases the ingress", async () => {
		vi.useFakeTimers();
		try {
			const writes: number[] = [];
			const writePlatformConfigs = vi.fn(async () => {
				writes.push(Date.now());
			});
			// `pending` is the pre-handover state: the supervisor defers while
			// setup's bootstrap ingress owns the entry port. `converged` means the
			// ingress is ours, so setup has finished and its final write has landed.
			// Keyed on a flag rather than call order, so the assertion does not
			// depend on how the boot refresh and the watch interleave.
			let handoverDone = false;
			// Typed via the parameter list rather than `as const`: a `const`
			// assertion cannot apply to a ternary expression (TS1355).
			const convergeNow = vi.fn<(id: string) => Promise<"converged" | "pending">>(
				async () => (handoverDone ? "converged" : "pending"),
			);
			const refresher = new TraefikConfigRefresher(
				{ writePlatformConfigs } as unknown as TraefikPlatformConfigService,
				{ convergeNow } as unknown as SupervisorOrchestratorService,
			);

			refresher.onApplicationBootstrap();
			// Boot write happens while setup still owns the port.
			await vi.advanceTimersByTimeAsync(3_000);
			expect(writePlatformConfigs).toHaveBeenCalledTimes(1);

			// The handover completes.
			handoverDone = true;
			await vi.advanceTimersByTimeAsync(60_000);

			// A SECOND write landed — the one that supersedes setup's final write.
			// Without it setup's version stays on disk and the route keeps pointing
			// at a backend that no longer exists.
			expect(writePlatformConfigs).toHaveBeenCalledTimes(2);
			expect(writes[1]).toBeGreaterThan(writes[0] ?? 0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("stops watching once the handover re-publish has landed", async () => {
		vi.useFakeTimers();
		try {
			const writePlatformConfigs = vi.fn(async () => undefined);
			const convergeNow = vi.fn(async () => "converged" as const);
			const refresher = new TraefikConfigRefresher(
				{ writePlatformConfigs } as unknown as TraefikPlatformConfigService,
				{ convergeNow } as unknown as SupervisorOrchestratorService,
			);

			refresher.onApplicationBootstrap();
			// Long enough for many watch intervals to elapse.
			await vi.advanceTimersByTimeAsync(120_000);

			// Exactly one boot write plus one post-handover write — the watch STOPS
			// once it has done its job, rather than re-writing on every pass.
			expect(writePlatformConfigs).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});
});