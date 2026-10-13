import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HealthRegistry } from "@deployer/shared/server";

import { HealthController } from "./health.controller";

/**
 * The health service's contract surface.
 *
 * The registry is stubbed because its own behaviour (the real indicators, the
 * stream, the transitions) is covered where it lives, in
 * `@deployer/shared`'s suite. What is worth asserting HERE is the mapping: that
 * each procedure calls the registry and returns the shape its contract declares
 * — which is the only responsibility this domain has left.
 */
function snapshot(overrides: Partial<Awaited<ReturnType<HealthRegistry["runOnce"]>>> = {}) {
	return {
		status: "up" as const,
		info: { database: { status: "up" as const, latencyMs: 3, version: "PostgreSQL 16.4" } },
		error: {},
		details: { database: { status: "up" as const, latencyMs: 3 } },
		indicators: [
			{
				name: "database",
				status: "up" as const,
				latencyMs: 3,
				detail: { version: "PostgreSQL 16.4" },
			},
		],
		checkedAt: "2026-10-09T00:00:00.000Z",
		durationMs: 4,
		...overrides,
	};
}

describe("HealthController", () => {
	let controller: HealthController;
	let registry: { runOnce: ReturnType<typeof vi.fn> };

	beforeEach(async () => {
		registry = { runOnce: vi.fn(async () => snapshot()) };

		const module = await Test.createTestingModule({
			// `@Implement` registers route metadata at DECORATION time, so the handler
			// is accessible without building an HTTP server.
			controllers: [HealthController],
			providers: [{ provide: HealthRegistry, useValue: registry }],
		}).compile();

		controller = module.get(HealthController);
	});

	/** Pull the handler off an `@Implement`-produced procedure. */
	function handlerOf(implementation: unknown): (options: unknown) => Promise<unknown> {
		// ── WHERE THE HANDLER ACTUALLY LIVES ────────────────────────────────────────
		// `implement(contract).handler(fn)` returns a Procedure whose ONLY own key is
		// `~orpc`, and the handler sits inside that. Reading `.handler` off the procedure
		// is `undefined`, which is what produced `no handler on the implemented procedure`
		// for every test in this file — a harness bug that looked like a contract failure.
		//
		// Verified by inspecting the object: own keys are `["~orpc"]`, and `~orpc` holds
		// `errorMap`, `meta`, `inputSchemas`, `outputSchemas`, `metaPlugins`,
		// `orderedMiddlewares`, `handler`.
		const orpc = (implementation as { "~orpc"?: { handler?: unknown } })["~orpc"];
		const handler = orpc?.handler;
		if (typeof handler !== "function") throw new Error("no handler on the implemented procedure");
		return handler as (options: unknown) => Promise<unknown>;
	}

	describe("check", () => {
		it("runs a REAL pass rather than reading a cache", async () => {
			await handlerOf(controller.check())({ input: {}, context: {} });

			// The container probe (`/health/ready`) reads the cached verdict because it
			// is polled forever; this endpoint is a consumer asking "what is true now",
			// so it must force a pass — otherwise two callers could see different
			// answers to the same question.
			expect(registry.runOnce).toHaveBeenCalled();
		});

		it("reports ok with the per-indicator detail when everything is up", async () => {
			const result = (await handlerOf(controller.check())({ input: {}, context: {} })) as {
				status: string;
				indicators: { name: string; status: string }[];
			};

			expect(result.status).toBe("ok");
			expect(result.indicators[0]?.name).toBe("database");
		});

		it("reports degraded when any indicator is down", async () => {
			registry.runOnce.mockResolvedValue(
				snapshot({
					status: "down",
					indicators: [{ name: "redis", status: "down", latencyMs: 2, message: "connection refused" }],
				}),
			);

			const result = (await handlerOf(controller.check())({ input: {}, context: {} })) as { status: string };

			// `degraded` rather than an error: a health endpoint that fails when a
			// dependency is down has hidden the diagnosis it exists to provide.
			expect(result.status).toBe("degraded");
		});
	});

	describe("detailed", () => {
		it("passes Terminus' payload through unchanged", async () => {
			const result = (await handlerOf(controller.detailed())({ input: {}, context: {} })) as {
				info: Record<string, unknown>;
				error: Record<string, unknown>;
				details: Record<string, unknown>;
			};

			// A Terminus client or UI must be able to consume this without a translator.
			expect(result.info).toHaveProperty("database");
			expect(result.error).toEqual({});
			expect(result.details).toHaveProperty("database");
		});

		it("reports uptime in seconds, as the contract declares", async () => {
			const result = (await handlerOf(controller.detailed())({ input: {}, context: {} })) as { uptime: number };

			expect(result.uptime).toBeGreaterThan(0);
		});

		it("includes the flattened renderable list alongside the Terminus shape", async () => {
			const result = (await handlerOf(controller.detailed())({ input: {}, context: {} })) as {
				indicators: { name: string; status: string }[];
			};

			expect(result.indicators).toHaveLength(1);
			expect(result.indicators[0]).toMatchObject({ name: "database", status: "up" });
		});
	});
});
