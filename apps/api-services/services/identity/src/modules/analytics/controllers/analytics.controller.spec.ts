import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsController } from "./analytics.controller";

/**
 * Resolve a built procedure's handler; oRPC keeps it on the `~orpc` descriptor, older
 * versions on the procedure itself. Reading both keeps the assertion about the contract.
 */
function procedureHandler(procedure: unknown): (...args: unknown[]) => Promise<unknown> {
	const p = procedure as { handler?: unknown; "~orpc"?: { handler?: unknown } };
	const handler = p.handler ?? p["~orpc"]?.handler;
	if (typeof handler !== "function") throw new TypeError("procedure does not expose a handler");
	return handler as (...args: unknown[]) => Promise<unknown>;
}

vi.mock("@orpc/nest", () => ({
	Implement: vi.fn(() => () => undefined),
}));
vi.mock("@orpc/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("@orpc/server")>()),
	implement: vi.fn(() => ({
		use: vi.fn().mockReturnThis(),
		handler: vi.fn((fn: unknown) => ({ handler: fn })),
	})),
}));
vi.mock("@deployer/shared/core/modules/auth/orpc/middlewares", () => ({
	requireAuth: vi.fn(() => ({})),
}));

describe("AnalyticsController.getReportContent", () => {
	const analytics = { downloadReport: vi.fn() };
	let controller: AnalyticsController;

	beforeEach(() => {
		vi.clearAllMocks();
		controller = new AnalyticsController(analytics as never);
	});

	it("returns the stored content as a JSON file named after the report", async () => {
		analytics.downloadReport.mockResolvedValue({ name: "r", format: "json", content: { total: 3 }, sizeBytes: 10 });

		const handler = procedureHandler(controller.getReportContent());
		const file = (await handler({ input: { params: { reportId: "rep-1" } } })) as File;

		expect(analytics.downloadReport).toHaveBeenCalledWith("rep-1");
		expect(file.name).toBe("report-rep-1.json");
		expect(file.type).toContain("application/json");
		expect(JSON.parse(await file.text())).toEqual({ total: 3 });
	});

	it("serves an empty object when a completed report has no content", async () => {
		analytics.downloadReport.mockResolvedValue({ name: "r", format: "json", content: null, sizeBytes: 0 });

		const handler = procedureHandler(controller.getReportContent());
		const file = (await handler({ input: { params: { reportId: "rep-2" } } })) as File;

		expect(JSON.parse(await file.text())).toEqual({});
	});

	it("lets the service refuse a report that did not complete", async () => {
		analytics.downloadReport.mockRejectedValue(new Error("not completed"));

		const handler = procedureHandler(controller.getReportContent());
		await expect(handler({ input: { params: { reportId: "rep-3" } } })).rejects.toThrow("not completed");
	});
});
