import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { AnalyticsService } from "./analytics.service";

describe("AnalyticsService", () => {
    let service: AnalyticsService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [AnalyticsService],
        }).compile();

        service = module.get<AnalyticsService>(AnalyticsService);
    });

    it("should be defined", () => {
        expect(service).toBeDefined();
    });

    describe("getResourceMetrics", () => {
        it("returns time-bucketed resource metrics", () => {
            const result = service.getResourceMetrics("1d", "hour");

            expect(result.timeRange).toBe("1d");
            expect(result.granularity).toBe("hour");
            expect(result.data.length).toBe(24);
            expect(result.data[0]).toHaveProperty("cpu");
            expect(result.data[0]).toHaveProperty("memory");
        });
    });

    describe("getResourceUsage", () => {
        it("returns usage summary with peak, average and minimum", () => {
            const result = service.getResourceUsage("1d", "all", "average");

            expect(result.timeRange).toBe("1d");
            expect(result.summary).toHaveProperty("peak");
            expect(result.summary).toHaveProperty("average");
            expect(result.summary).toHaveProperty("minimum");
            expect(result.data.length).toBeGreaterThan(0);
        });
    });

    describe("generateReport", () => {
        it("returns pending report metadata", () => {
            const period = {
                start: new Date("2026-01-01T00:00:00.000Z"),
                end: new Date("2026-01-31T23:59:59.999Z"),
            };

            const result = service.generateReport(period, "json");

            expect(result.reportId).toMatch(/^report-/);
            expect(result.status).toBe("pending");
            expect(result.estimatedCompletion).toBeInstanceOf(Date);
        });
    });

    describe("createReportConfig", () => {
        it("creates config with timestamps", () => {
            const result = service.createReportConfig({
                name: "Daily Ops",
                metrics: ["deployments", "errors"],
                schedule: "daily",
                recipients: ["ops@example.com"],
            });

            expect(result.id).toMatch(/^config-/);
            expect(result.name).toBe("Daily Ops");
            expect(result.schedule).toBe("daily");
            expect(result.createdAt).toBeInstanceOf(Date);
            expect(result.updatedAt).toBeInstanceOf(Date);
        });
    });
});
