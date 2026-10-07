import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { analyticsContract } from "@repo/api-contracts";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";
import { AnalyticsService } from "../services/analytics.service";

/**
 * Analytics controllers.
 *
 * ORPC handler input shapes (verified against the contracts + every other
 * controller in the repo):
 *   - `.query(schema)`  → `input.query`   (defaults applied by Zod)
 *   - `.params(...)`    → `input.params.X`
 *   - `.body(schema)`   → `input.body`
 *
 * The previous version destructured `input` directly, which silently ignored
 * every query param and passed `undefined` for all params/body fields
 * (e.g. `generateReport(input.period)` crashed because `input` is the
 * `{ body }` envelope). Each handler below reads the correct slice.
 */
@Controller()
export class AnalyticsController {
    constructor(private readonly analyticsService: AnalyticsService) {}

    @Implement(analyticsContract.getResourceMetrics)
    getResourceMetrics() {
        return implement(analyticsContract.getResourceMetrics)
            .use(requireAuth())
            .handler(({ input }) => {
                const { timeRange = "1d", granularity = "hour", services } = input.query ?? {};
                return this.analyticsService.getResourceMetrics(timeRange, granularity, services);
            });
    }

    @Implement(analyticsContract.getApplicationMetrics)
    getApplicationMetrics() {
        return implement(analyticsContract.getApplicationMetrics)
            .use(requireAuth())
            .handler(({ input }) => {
                const { timeRange = "1d", granularity = "hour", services } = input.query ?? {};
                return this.analyticsService.getApplicationMetrics(timeRange, granularity, services);
            });
    }

    @Implement(analyticsContract.getDatabaseMetrics)
    getDatabaseMetrics() {
        return implement(analyticsContract.getDatabaseMetrics)
            .use(requireAuth())
            .handler(({ input }) => {
                const { timeRange = "1d", granularity = "hour", services } = input.query ?? {};
                return this.analyticsService.getDatabaseMetrics(timeRange, granularity, services);
            });
    }

    @Implement(analyticsContract.getDeploymentMetrics)
    getDeploymentMetrics() {
        return implement(analyticsContract.getDeploymentMetrics)
            .use(requireAuth())
            .handler(({ input }) => {
                const { timeRange = "1d", granularity = "hour", services } = input.query ?? {};
                return this.analyticsService.getDeploymentMetrics(timeRange, granularity, services);
            });
    }

    @Implement(analyticsContract.getServiceHealth)
    getServiceHealth() {
        return implement(analyticsContract.getServiceHealth)
            .use(requireAuth())
            .handler(({ input }) => this.analyticsService.getServiceHealth(input.query?.services));
    }

    @Implement(analyticsContract.getRealTimeMetrics)
    getRealTimeMetrics() {
        return implement(analyticsContract.getRealTimeMetrics)
            .use(requireAuth())
            .handler(({ input }) => this.analyticsService.getRealTimeMetrics(input.query?.services));
    }

    @Implement(analyticsContract.getResourceUsage)
    getResourceUsage() {
        return implement(analyticsContract.getResourceUsage)
            .use(requireAuth())
            .handler(({ input }) => {
                const { timeRange = "1d", resource = "all", aggregation = "average" } = input.query ?? {};
                return this.analyticsService.getResourceUsage(timeRange, resource, aggregation);
            });
    }

    @Implement(analyticsContract.getUserActivity)
    getUserActivity() {
        return implement(analyticsContract.getUserActivity)
            .use(requireAuth())
            .handler(({ input }) => {
                const {
                    timeRange = "1d",
                    userId,
                    action,
                    resource,
                    limit = 100,
                    offset = 0,
                } = input.query ?? {};

                return this.analyticsService.getUserActivity(
                    timeRange,
                    userId,
                    action,
                    resource,
                    limit,
                    offset,
                );
            });
    }

    @Implement(analyticsContract.getActivitySummary)
    getActivitySummary() {
        return implement(analyticsContract.getActivitySummary)
            .use(requireAuth())
            .handler(({ input }) => {
                const { period = "day", granularity = "day", limit = 30 } = input.query ?? {};
                return this.analyticsService.getActivitySummary(period, granularity, limit);
            });
    }

    @Implement(analyticsContract.getApiUsage)
    getApiUsage() {
        return implement(analyticsContract.getApiUsage)
            .use(requireAuth())
            .handler(({ input }) => {
                const { timeRange = "1d", groupBy = "endpoint", limit = 20 } = input.query ?? {};
                return this.analyticsService.getApiUsage(timeRange, groupBy, limit);
            });
    }

    @Implement(analyticsContract.getDeploymentUsage)
    getDeploymentUsage() {
        return implement(analyticsContract.getDeploymentUsage)
            .use(requireAuth())
            .handler(({ input }) => {
                const { timeRange = "30d", projectId, userId } = input.query ?? {};
                return this.analyticsService.getDeploymentUsage(timeRange, projectId, userId);
            });
    }

    @Implement(analyticsContract.getStorageUsage)
    getStorageUsage() {
        return implement(analyticsContract.getStorageUsage)
            .use(requireAuth())
            .handler(({ input }) => {
                const { timeRange = "30d", breakdown = "project" } = input.query ?? {};
                return this.analyticsService.getStorageUsage(timeRange, breakdown);
            });
    }

    @Implement(analyticsContract.generateReport)
    generateReport() {
        return implement(analyticsContract.generateReport)
            .use(requireAuth())
            .handler(({ input }) =>
                this.analyticsService.generateReport(input),
            );
    }

    @Implement(analyticsContract.getReport)
    getReport() {
        return implement(analyticsContract.getReport)
            .use(requireAuth())
            .handler(({ input }) => this.analyticsService.getReport(input.params.reportId));
    }

    @Implement(analyticsContract.listReports)
    listReports() {
        return implement(analyticsContract.listReports)
            .use(requireAuth())
            .handler(({ input }) => {
                const { status, limit = 20, offset = 0 } = input.query ?? {};
                return this.analyticsService.listReports(limit, offset, status);
            });
    }

    @Implement(analyticsContract.deleteReport)
    deleteReport() {
        return implement(analyticsContract.deleteReport)
            .use(requireAuth())
            .handler(({ input }) => this.analyticsService.deleteReport(input.params.reportId));
    }

    @Implement(analyticsContract.downloadReport)
    downloadReport() {
        return implement(analyticsContract.downloadReport)
            .use(requireAuth())
            .handler(({ input }) => this.analyticsService.downloadReport(input.params.reportId));
    }

    @Implement(analyticsContract.createReportConfig)
    createReportConfig() {
        return implement(analyticsContract.createReportConfig)
            .use(requireAuth())
            .handler(({ input }) =>
                this.analyticsService.createReportConfig(input),
            );
    }

    @Implement(analyticsContract.listReportConfigs)
    listReportConfigs() {
        return implement(analyticsContract.listReportConfigs)
            .use(requireAuth())
            .handler(({ input: { query } }) => {
                const { limit = 20, offset = 0 } = query ?? {};
                return this.analyticsService.listReportConfigs(limit, offset);
            });
    }

    @Implement(analyticsContract.updateReportConfig)
    updateReportConfig() {
        return implement(analyticsContract.updateReportConfig)
            .use(requireAuth())
            .handler(({ input }) =>
                this.analyticsService.updateReportConfig(input.params.configId, input.body ?? {}),
            );
    }

    @Implement(analyticsContract.deleteReportConfig)
    deleteReportConfig() {
        return implement(analyticsContract.deleteReportConfig)
            .use(requireAuth())
            .handler(({ input }) => this.analyticsService.deleteReportConfig(input.params.configId));
    }
}
