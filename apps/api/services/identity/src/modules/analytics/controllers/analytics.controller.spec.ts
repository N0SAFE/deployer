import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyticsReportNotReady } from "../domain/analytics.errors";
import { AnalyticsService } from "../services/analytics.service";

import { AnalyticsController } from "./analytics.controller";

/**
 * The generator a built procedure was given through `.effect(...)`: the controller's whole behaviour.
 * The oRPC builder is stubbed to capture it, and `serve` to pass the effect through, so the spec runs the
 * handler against a substituted `AnalyticsService`.
 */
type Handler = (args: { input: unknown; context: unknown }) => Generator<unknown, unknown, never>;

function capturedHandler(procedure: unknown): Handler {
	const handler = (procedure as { effect?: unknown }).effect;
	if (typeof handler !== "function") throw new TypeError("procedure does not expose an effect handler");
	return handler as Handler;
}

vi.mock("@orpc/nest", () => ({
	Implement: vi.fn(() => () => undefined),
}));
vi.mock("@orpc/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("@orpc/server")>()),
	implement: vi.fn(() => ({
		use: vi.fn().mockReturnThis(),
		effect: vi.fn((fn: unknown) => ({ effect: fn })),
	})),
}));
vi.mock("@deployer/shared/core/modules/auth/orpc/middlewares", () => ({
	requireAuth: vi.fn(() => ({})),
	requirePlatformRole: vi.fn(() => ({})),
}));
vi.mock("@identity/core/orpc/serve", () => ({
	serve: () => <A, E, R>(effect: Effect.Effect<A, E, R>) => effect,
}));
vi.mock("../analytics.module", () => ({ AnalyticsDomainModule: {} }));

describe("AnalyticsController.getReportContent", () => {
	const downloadReport = vi.fn();
	const controller = new AnalyticsController();

	const run = (reportId: string) => {
		const handler = capturedHandler(controller.getReportContent());
		return Effect.runPromise(
			Effect.gen(() => handler({ input: { params: { reportId } }, context: {} }) as never).pipe(
				Effect.provideService(AnalyticsService, { downloadReport } as never),
			) as Effect.Effect<File>,
		);
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns the stored content as a JSON file named after the report", async () => {
		downloadReport.mockReturnValue(Effect.succeed({ name: "r", format: "json", content: { total: 3 }, sizeBytes: 10 }));

		const file = await run("rep-1");

		expect(downloadReport).toHaveBeenCalledWith("rep-1");
		expect(file.name).toBe("report-rep-1.json");
		expect(file.type).toContain("application/json");
		expect(JSON.parse(await file.text())).toEqual({ total: 3 });
	});

	it("serves an empty object when a completed report has no content", async () => {
		downloadReport.mockReturnValue(Effect.succeed({ name: "r", format: "json", content: null, sizeBytes: 0 }));

		const file = await run("rep-2");

		expect(JSON.parse(await file.text())).toEqual({});
	});

	it("lets the service refuse a report that did not complete", async () => {
		downloadReport.mockReturnValue(Effect.fail(new AnalyticsReportNotReady({ id: "rep-3", status: "failed" })));

		await expect(run("rep-3")).rejects.toBeDefined();
	});
});
