import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "../services/analytics.service";

function createImplementMock() {
    type HandlerFn = (opts: { input: unknown; context: unknown }) => unknown;

    return {
        use: vi.fn().mockReturnThis(),
        handler: vi.fn((fn: HandlerFn) => ({ handler: fn })),
    };
}

vi.mock("@orpc/nest", () => ({
    implement: vi.fn(() => createImplementMock()),
    Implement: vi.fn(() => () => {}),
}));

vi.mock("@/core/modules/auth/orpc/middlewares", () => ({
    requireAuth: vi.fn(() => ({})),
}));

describe("AnalyticsController", () => {
    let controller: AnalyticsController;

    beforeEach(async () => {
        const mockAnalyticsService = {
            getResourceMetrics: vi.fn(),
            getApplicationMetrics: vi.fn(),
            getDatabaseMetrics: vi.fn(),
            getDeploymentMetrics: vi.fn(),
            getServiceHealth: vi.fn(),
            getRealTimeMetrics: vi.fn(),
            getResourceUsage: vi.fn(),
            getUserActivity: vi.fn(),
            getActivitySummary: vi.fn(),
            getApiUsage: vi.fn(),
            getDeploymentUsage: vi.fn(),
            getStorageUsage: vi.fn(),
            generateReport: vi.fn(),
            getReport: vi.fn(),
            listReports: vi.fn(),
            deleteReport: vi.fn(),
            downloadReport: vi.fn(),
            createReportConfig: vi.fn(),
            listReportConfigs: vi.fn(),
            updateReportConfig: vi.fn(),
            deleteReportConfig: vi.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [AnalyticsController],
            providers: [
                {
                    provide: AnalyticsService,
                    useFactory: () => mockAnalyticsService,
                },
            ],
        }).compile();

        controller = module.get<AnalyticsController>(AnalyticsController);
    });

    it("should be defined", () => {
        expect(controller).toBeDefined();
    });

    describe("ORPC implementation methods", () => {
        const methods: Array<keyof AnalyticsController> = [
            "getResourceMetrics",
            "getApplicationMetrics",
            "getDatabaseMetrics",
            "getDeploymentMetrics",
            "getServiceHealth",
            "getRealTimeMetrics",
            "getResourceUsage",
            "getUserActivity",
            "getActivitySummary",
            "getApiUsage",
            "getDeploymentUsage",
            "getStorageUsage",
            "generateReport",
            "getReport",
            "listReports",
            "deleteReport",
            "downloadReport",
            "createReportConfig",
            "listReportConfigs",
            "updateReportConfig",
            "deleteReportConfig",
        ];

        for (const method of methods) {
            it(`${method} should return an implementation with a handler`, () => {
                const implementation = (controller[method] as () => any)();
                expect(implementation).toBeDefined();
                expect(typeof implementation.handler).toBe("function");
            });
        }
    });
});
