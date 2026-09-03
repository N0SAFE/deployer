import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsRepository } from "../repositories/analytics.repository";

const mockRepository = {
    deploymentsInRange: vi.fn().mockResolvedValue([]),
    rollbacksInRange: vi.fn().mockResolvedValue([]),
    serviceRows: vi.fn().mockResolvedValue([]),
    latestDeploymentPerService: vi.fn().mockResolvedValue(new Map()),
    createReport: vi.fn().mockResolvedValue({ id: "report-1" }),
    getReport: vi.fn().mockResolvedValue(null),
    listReports: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    deleteReport: vi.fn().mockResolvedValue(true),
    createReportConfig: vi.fn().mockResolvedValue({ id: "cfg-1" }),
    listReportConfigs: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    updateReportConfig: vi.fn().mockResolvedValue(true),
    deleteReportConfig: vi.fn().mockResolvedValue(true),
    projectNamesByIds: vi.fn().mockResolvedValue(new Map()),
};

describe("AnalyticsService", () => {
    let service: AnalyticsService;

    beforeEach(async () => {
        vi.clearAllMocks();
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AnalyticsService,
                { provide: AnalyticsRepository, useValue: mockRepository },
            ],
        }).compile();

        service = module.get<AnalyticsService>(AnalyticsService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });

    describe("getResourceMetrics", () => {
        it("returns time-bucketed resource metrics", async () => {
            const result = await service.getResourceMetrics("1d", "hour");

            expect(result.timeRange).toBe("1d");
            expect(result.granularity).toBe("hour");
            expect(result.data.length).toBe(24);
            expect(result.data[0]).toHaveProperty("cpu");
            expect(result.data[0]).toHaveProperty("memory");
        });
    });

    describe("getResourceUsage", () => {
        it("returns usage summary with peak, average and minimum", async () => {
            const result = await service.getResourceUsage("1d", "all", "average");

            expect(result.timeRange).toBe("1d");
            expect(result.summary).toHaveProperty("peak");
            expect(result.summary).toHaveProperty("average");
            expect(result.summary).toHaveProperty("minimum");
            expect(result.data.length).toBeGreaterThan(0);
        });
    });

    describe("getDeploymentMetrics", () => {
        it("returns deployment bucketed data from the repository", async () => {
            mockRepository.deploymentsInRange.mockResolvedValueOnce([
                {
                    id: "d-1",
                    serviceId: "s-1",
                    status: "success",
                    createdAt: new Date(),
                    deployCompletedAt: new Date(),
                    errorMessage: null,
                },
            ]);

            const result = await service.getDeploymentMetrics("1d", "hour", ["s-1"]);

            expect(result.dataSource).toBe("deployments");
            expect(result.data.length).toBe(24);
            expect(result.data.some((b) => b.deploymentsCount > 0)).toBe(true);
        });
    });

    describe("getServiceHealth", () => {
        it("returns health status per service", async () => {
            mockRepository.serviceRows.mockResolvedValueOnce([
                { id: "s-1", name: "web", projectId: "p-1" },
            ]);
            mockRepository.latestDeploymentPerService.mockResolvedValueOnce(
                new Map([
                    [
                        "s-1",
                        {
                            status: "success",
                            deployCompletedAt: new Date(),
                            createdAt: new Date(),
                            errorMessage: null,
                        },
                    ],
                ]),
            );

            const result = await service.getServiceHealth(["s-1"]);

            expect(result.dataSource).toBe("services");
            expect(result.data.length).toBe(1);
            expect(result.data[0]!.serviceName).toBe("web");
        });
    });

    describe("generateReport", () => {
        it("persists and returns report metadata", async () => {
            const result = await service.generateReport({
                period: {
                    start: new Date("2026-01-01T00:00:00.000Z"),
                    end: new Date("2026-01-31T23:59:59.999Z"),
                },
                format: "json",
                includeResourceUsage: true,
                includeApplicationMetrics: false,
                includeDatabaseMetrics: false,
                includeDeploymentAnalytics: false,
                includeServiceHealth: false,
                includeUserActivity: false,
            });

            expect(result.reportId).toBe("report-1");
            expect(result.status).toBe("completed");
            expect(mockRepository.createReport).toHaveBeenCalledOnce();
        });
    });

    describe("createReportConfig", () => {
        it("creates config with timestamps", async () => {
            const result = await service.createReportConfig({
                name: "Daily Ops",
                metrics: ["deployments", "errors"],
                schedule: "daily",
                recipients: ["ops@example.com"],
            });

            expect(result.id).toBe("cfg-1");
            expect(result.name).toBe("Daily Ops");
            expect(result.schedule).toBe("daily");
            expect(result.createdAt).toBeInstanceOf(Date);
            expect(result.updatedAt).toBeInstanceOf(Date);
        });
    });
});
