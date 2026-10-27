import "@orpc/effect/extensions/effect";

import { effectContext } from "@deployer/nest-effect/testing";
import { callProcedure } from "@deployer/orpc-utils/testing";
import { Context } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HealthController } from "./health.controller";
import { HealthRegistryRepository } from "../services/health.service";
import { HealthService, HealthServiceImpl } from "../services/health.service";
import { healthRegistryFake, healthSnapshot } from "../testing/health.fixtures";

/**
 * The health service's contract surface.
 *
 * `.effect()` handlers resolve services from `effect/context`, so the
 * controller is a plain class and the context is built explicitly. The shared
 * test helpers (`callProcedure`, `effectContext`) remove the per-file
 * `~orpc.handler` and Context plumbing.
 */
const runOnce = vi.fn(() => Promise.resolve(healthSnapshot()));

describe("HealthController", () => {
	let controller: HealthController;
	let context: { "effect/context": Context.Context<HealthService | HealthRegistryRepository> };

	beforeEach(() => {
		runOnce.mockReset();
		runOnce.mockImplementation(() => Promise.resolve(healthSnapshot()));

		context = effectContext(
			Context.empty().pipe(
				Context.add(HealthService, new HealthServiceImpl()),
				Context.add(HealthRegistryRepository, healthRegistryFake(runOnce)),
			),
		);
		controller = new HealthController();
	});

	function call<TOutput>(implementation: unknown): Promise<TOutput> {
		return callProcedure<TOutput>(implementation, {}, context);
	}

	describe("check", () => {
		it("runs a REAL pass rather than reading a cache", async () => {
			await call(controller.check());

			// The container probe (`/health/ready`) reads the cached verdict because it
			// is polled forever; this endpoint is a consumer asking "what is true now",
			// so it must force a pass — otherwise two callers could see different
			// answers to the same question.
			expect(runOnce).toHaveBeenCalled();
		});

		it("reports ok with the per-indicator detail when everything is up", async () => {
			const result = await call<{
				status: string;
				indicators: { name: string; status: string }[];
			}>(controller.check());

			expect(result.status).toBe("ok");
			expect(result.indicators[0]?.name).toBe("database");
		});

		it("reports degraded when any indicator is down", async () => {
			runOnce.mockResolvedValue(
				healthSnapshot({
					status: "down",
					indicators: [
						{ name: "redis", status: "down", latencyMs: 2, message: "connection refused" },
					],
				}),
			);

			const result = await call<{ status: string }>(controller.check());

			// `degraded` rather than an error: a health endpoint that fails when a
			// dependency is down has hidden the diagnosis it exists to provide.
			expect(result.status).toBe("degraded");
		});
	});

	describe("detailed", () => {
		it("passes Terminus' payload through unchanged", async () => {
			const result = await call<{
				info: Record<string, unknown>;
				error: Record<string, unknown>;
				details: Record<string, unknown>;
			}>(controller.detailed());

			// A Terminus client or UI must be able to consume this without a translator.
			expect(result.info).toHaveProperty("database");
			expect(result.error).toEqual({});
			expect(result.details).toHaveProperty("database");
		});

		it("reports uptime in seconds, as the contract declares", async () => {
			const result = await call<{ uptime: number }>(controller.detailed());

			expect(result.uptime).toBeGreaterThan(0);
		});

		it("includes the flattened renderable list alongside the Terminus shape", async () => {
			const result = await call<{ indicators: { name: string; status: string }[] }>(
				controller.detailed(),
			);

			expect(result.indicators).toHaveLength(1);
			expect(result.indicators[0]).toMatchObject({ name: "database", status: "up" });
		});
	});
});
