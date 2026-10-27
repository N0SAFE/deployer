import { NotFoundError } from "@deployer/errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyticsService } from "./analytics.service";

const NOW = new Date("2026-10-27T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

const deployment = (overrides: Record<string, unknown> = {}) => ({
	id: "d-1",
	serviceId: "s-1",
	status: "success",
	createdAt: minutesAgo(30),
	deployCompletedAt: minutesAgo(29),
	errorMessage: null,
	...overrides,
});

function makeRepository() {
	return {
		deploymentsInRange: vi.fn().mockResolvedValue([]),
		rollbacksInRange: vi.fn().mockResolvedValue([]),
		serviceRows: vi.fn().mockResolvedValue([]),
		latestDeploymentPerService: vi.fn().mockResolvedValue(new Map()),
		projectNamesByIds: vi.fn().mockResolvedValue(new Map()),
		insertReport: vi.fn(),
		findReport: vi.fn(),
		listReports: vi.fn(),
		deleteReport: vi.fn(),
		insertReportConfig: vi.fn(),
		listReportConfigs: vi.fn(),
		updateReportConfig: vi.fn(),
		deleteReportConfig: vi.fn(),
	};
}

describe("AnalyticsService", () => {
	let repo: ReturnType<typeof makeRepository>;
	let service: AnalyticsService;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		repo = makeRepository();
		service = new AnalyticsService(repo as never);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("metrics that have no data source", () => {
		it.each(["applicationMetrics", "databaseMetrics"] as const)(
			"%s is empty and says so, rather than reporting zeros",
			async (method) => {
				const result = await service[method]({ timeRange: "1d", granularity: "hour" } as never);

				expect(result.dataSource).toBe("unavailable");
				expect(result.data).toEqual([]);
				expect(result.timeRange).toBe("1d");
			},
		);
	});

	describe("deploymentMetrics", () => {
		const query = { timeRange: "1d", granularity: "hour" } as never;

		it("returns one bucket per hour of the window, all empty without deployments", async () => {
			const result = await service.deploymentMetrics(query);

			expect(result.dataSource).toBe("deployments");
			expect(result.data).toHaveLength(24);
			expect(result.data.every((bucket) => bucket.deploymentsCount === 0 && bucket.successRate === 0)).toBe(true);
		});

		it("counts a deployment into its bucket and reports the window success rate", async () => {
			repo.deploymentsInRange.mockResolvedValue([
				deployment({ id: "d-1", status: "success" }),
				deployment({ id: "d-2", status: "failed", deployCompletedAt: null, errorMessage: "build failed" }),
			]);

			const result = await service.deploymentMetrics(query);

			const populated = result.data.filter((bucket) => bucket.deploymentsCount > 0);
			expect(populated).toHaveLength(1);
			expect(populated[0]).toMatchObject({ deploymentsCount: 2, successRate: 50 });
		});

		it("averages the durations of the successful deployments in a bucket", async () => {
			repo.deploymentsInRange.mockResolvedValue([
				deployment({ id: "d-1", createdAt: minutesAgo(30), deployCompletedAt: new Date(minutesAgo(30).getTime() + 10_000) }),
				deployment({ id: "d-2", createdAt: minutesAgo(31), deployCompletedAt: new Date(minutesAgo(31).getTime() + 30_000) }),
			]);

			const result = await service.deploymentMetrics(query);

			const bucket = result.data.find((b) => b.deploymentsCount === 2);
			expect(bucket?.averageDeployTime).toBe(20_000);
		});

		it("ignores unfinished deployments when averaging", async () => {
			repo.deploymentsInRange.mockResolvedValue([
				deployment({ id: "d-1", createdAt: minutesAgo(30), deployCompletedAt: new Date(minutesAgo(30).getTime() + 10_000) }),
				deployment({ id: "d-2", createdAt: minutesAgo(31), deployCompletedAt: null }),
			]);

			const result = await service.deploymentMetrics(query);

			expect(result.data.find((b) => b.deploymentsCount === 2)?.averageDeployTime).toBe(10_000);
		});

		it("lists the five most frequent failure reasons of a bucket, most frequent first", async () => {
			const failures = (reason: string, count: number) =>
				Array.from({ length: count }, (_, i) =>
					deployment({ id: `${reason}-${String(i)}`, status: "failed", deployCompletedAt: null, errorMessage: reason }),
				);
			repo.deploymentsInRange.mockResolvedValue([
				...failures("oom", 3),
				...failures("timeout", 2),
				...failures("r3", 1),
				...failures("r4", 1),
				...failures("r5", 1),
				...failures("r6", 1),
			]);

			const result = await service.deploymentMetrics(query);

			const reasons = result.data.find((b) => b.deploymentsCount > 0)?.failureReasons ?? [];
			expect(reasons).toHaveLength(5);
			expect(reasons.slice(0, 2)).toEqual([
				{ reason: "oom", count: 3 },
				{ reason: "timeout", count: 2 },
			]);
		});

		it("counts rollbacks into their bucket", async () => {
			repo.rollbacksInRange.mockResolvedValue([{ id: "r-1", createdAt: minutesAgo(30) }]);

			const result = await service.deploymentMetrics(query);

			expect(result.data.reduce((sum, b) => sum + b.rollbackCount, 0)).toBe(1);
		});

		it("restricts the deployments to the named services", async () => {
			repo.serviceRows.mockResolvedValue([{ id: "s-1", name: "web", projectId: "p-1" }]);

			await service.deploymentMetrics({ ...(query as object), services: ["web"] } as never);

			expect(repo.serviceRows).toHaveBeenCalledWith(["web"]);
			expect(repo.deploymentsInRange).toHaveBeenCalledWith(expect.any(Date), expect.any(Date), ["s-1"]);
		});
	});

	describe("serviceHealth", () => {
		it("derives each service's status from its latest deployment", async () => {
			repo.serviceRows.mockResolvedValue([{ id: "s-1", name: "web", projectId: "p-1" }]);
			repo.latestDeploymentPerService.mockResolvedValue(new Map([["s-1", deployment()]]));

			const result = await service.serviceHealth();

			expect(result.dataSource).toBe("services");
			expect(result.data).toHaveLength(1);
			expect(result.data[0]).toMatchObject({ serviceName: "web", status: "healthy" });
			expect(result.data[0]?.checks[0]).toMatchObject({ name: "latest-deployment", status: "pass" });
		});

		it("reports a service that never deployed as unknown (a warning), not as failed", async () => {
			repo.serviceRows.mockResolvedValue([{ id: "s-1", name: "web", projectId: "p-1" }]);

			const result = await service.serviceHealth();

			expect(result.data[0]).toMatchObject({ status: "unknown" });
			expect(result.data[0]?.checks[0]).toMatchObject({ status: "warn", message: "this service has no deployments yet" });
		});

		it("reports a failed latest deployment as failing", async () => {
			repo.serviceRows.mockResolvedValue([{ id: "s-1", name: "web", projectId: "p-1" }]);
			repo.latestDeploymentPerService.mockResolvedValue(new Map([["s-1", deployment({ status: "failed" })]]));

			const result = await service.serviceHealth();

			expect(result.data[0]?.checks[0]?.status).toBe("fail");
		});
	});

	describe("generateReport", () => {
		const input = {
			period: { start: new Date("2026-10-26T12:00:00.000Z"), end: NOW },
			format: "json",
			includeResourceUsage: false,
			includeApplicationMetrics: true,
			includeDatabaseMetrics: false,
			includeDeploymentAnalytics: true,
			includeServiceHealth: false,
			includeUserActivity: false,
		} as const;

		it("stores a completed report with the sections it included and the size of its content", async () => {
			repo.insertReport.mockImplementation((row: object) => Promise.resolve({ id: "report-1", ...row }));

			const report = await service.generateReport(input);

			expect(report).toMatchObject({ id: "report-1", status: "completed", format: "json" });
			const stored = repo.insertReport.mock.calls[0]?.[0] as { sections: string[]; content: Record<string, unknown>; sizeBytes: number };
			expect(stored.sections).toEqual(["deploymentAnalytics", "applicationMetrics"]);
			// A section with no data source is recorded as such, not omitted.
			expect(stored.content.applicationMetricsDataSource).toBe("unavailable");
			expect(stored.sizeBytes).toBe(Buffer.byteLength(JSON.stringify(stored.content), "utf8"));
		});

		it("names the report after its period", async () => {
			repo.insertReport.mockImplementation((row: object) => Promise.resolve({ id: "report-1", ...row }));

			await service.generateReport(input);

			expect(repo.insertReport.mock.calls[0]?.[0]).toMatchObject({
				name: "Analytics report — 2026-10-26 → 2026-10-27",
			});
		});

		it("records a failed report, with the reason, when a section throws", async () => {
			repo.deploymentsInRange.mockRejectedValue(new Error("db down"));
			repo.insertReport.mockImplementation((row: object) => Promise.resolve({ id: "report-2", ...row }));

			const report = await service.generateReport(input);

			expect(report).toMatchObject({ status: "failed", errorMessage: "db down", sizeBytes: 0 });
		});
	});

	describe("reports", () => {
		const completed = { id: "r-1", name: "R", format: "json", status: "completed", content: { a: 1 }, sizeBytes: 9 };

		it("findReport returns the stored report and answers not found otherwise", async () => {
			repo.findReport.mockResolvedValueOnce(completed).mockResolvedValueOnce(null);

			await expect(service.findReport("r-1")).resolves.toBe(completed);
			await expect(service.findReport("ghost")).rejects.toBeInstanceOf(NotFoundError);
		});

		it("deleteReport confirms a deletion and answers not found for an unknown report", async () => {
			repo.deleteReport.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

			await expect(service.deleteReport("r-1")).resolves.toEqual({ success: true });
			await expect(service.deleteReport("ghost")).rejects.toBeInstanceOf(NotFoundError);
		});

		it("downloadReport hands back the content of a completed report", async () => {
			repo.findReport.mockResolvedValue(completed);

			await expect(service.downloadReport("r-1")).resolves.toEqual({
				name: "R",
				format: "json",
				content: { a: 1 },
				sizeBytes: 9,
			});
		});

		it("downloadReport refuses a report that did not complete, naming its status", async () => {
			repo.findReport.mockResolvedValue({ ...completed, status: "failed" });

			await expect(service.downloadReport("r-1")).rejects.toThrow(/status: failed/);
		});
	});

	describe("report configurations", () => {
		it("stores a config with defaults for the optional fields", async () => {
			repo.insertReportConfig.mockImplementation((row: object) => Promise.resolve({ id: "cfg-1", ...row }));

			await service.createReportConfig({ name: "Daily", metrics: ["deployments"], schedule: "daily" });

			expect(repo.insertReportConfig).toHaveBeenCalledWith({
				name: "Daily",
				description: null,
				metrics: ["deployments"],
				schedule: "daily",
				recipients: [],
			});
		});

		it("updates only the fields it was given", async () => {
			repo.updateReportConfig.mockResolvedValue({ id: "cfg-1" });

			await service.updateReportConfig("cfg-1", { name: "Weekly", schedule: "weekly" });

			expect(repo.updateReportConfig).toHaveBeenCalledWith("cfg-1", { name: "Weekly", schedule: "weekly" });
		});

		it("answers not found when updating or deleting an unknown config", async () => {
			repo.updateReportConfig.mockResolvedValue(null);
			repo.deleteReportConfig.mockResolvedValue(false);

			await expect(service.updateReportConfig("ghost", { name: "x" })).rejects.toBeInstanceOf(NotFoundError);
			await expect(service.deleteReportConfig("ghost")).rejects.toBeInstanceOf(NotFoundError);
		});
	});
});
