import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { appContract } from "@repo/api-contracts";
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

    @Implement(appContract.analytics.getResourceMetrics)
    getResourceMetrics() {
        return implement(appContract.analytics.getResourceMetrics)
            .use(requireAuth())
            .handler(({ input }) => {
                const { timeRange = "1d", granularity = "hour", services } = input.query ?? {};
                return this.analyticsService.getResourceMetrics(timeRange, granularity, services);
            });
    }

    @Implement(appContract.analytics.getApplicationMetrics)
    getApplicationMetrics() {
        return implement(appContract.analytics.getApplicationMetrics)
            .use(requireAuth())
            .handler(({ input }) => {
                const { timeRange = "1d", granularity = "hour", services } = input.query ?? {};
                return this.analyticsService.getApplicationMetrics(timeRange, granularity, services);
            });
    }

    @Implement(appContract.analytics.getDatabaseMetrics)
    getDatabaseMetrics() {
        return implement(appContract.analytics.getDatabaseMetrics)
            .use(requireAuth())
            .handler(({ input }) => {
                const { timeRange = "1d", granularity = "hour", services } = input.query ?? {};
                return this.analyticsService.getDatabaseMetrics(timeRange, granularity, services);
            });
    }

    @Implement(appContract.analytics.getDeploymentMetrics)
    getDeploymentMetrics() {
        return implement(appContract.analytics.getDeploymentMetrics)
            .use(requireAuth())
            .handler(({ input }) => {
                const { timeRange = "1d", granularity = "hour", services } = input.query ?? {};
                return this.analyticsService.getDeploymentMetrics(timeRange, granularity, services);
            });
    }

    @Implement(appContract.analytics.getServiceHealth)
    getServiceHealth() {
        return implement(appContract.analytics.getServiceHealth)
            .use(requireAuth())
            .handler(({ input }) => this.analyticsService.getServiceHealth(input.query?.services));
    }

    @Implement(appContract.analytics.getRealTimeMetrics)
    getRealTimeMetrics() {
        return implement(appContract.analytics.getRealTimeMetrics)
            .use(requireAuth())
            .handler(({ input }) => this.analyticsService.getRealTimeMetrics(input.query?.services));
    }

    @Implement(appContract.analytics.getResourceUsage)
    getResourceUsage() {
        return implement(appContract.analytics.getResourceUsage)
            .use(requireAuth())
            .handler(({ input }) => {
                const { timeRange = "1d", resource = "all", aggregation = "average" } = input.query ?? {};
                return this.analyticsService.getResourceUsage(timeRange, resource, aggregation);
            });
    }

    @Implement(appContract.analytics.getUserActivity)
    getUserActivity() {
        return implement(appContract.analytics.getUserActivity)
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

    @Implement(appContract.analytics.getActivitySummary)
    getActivitySummary() {
        return implement(appContract.analytics.getActivitySummary)
            .use(requireAuth())
            .handler(({ input }) => {
                const { period = "day", granularity = "day", limit = 30 } = input.query ?? {};
                return this.analyticsService.getActivitySummary(period, granularity, limit);
            });
    }

    @Implement(appContract.analytics.getApiUsage)
    getApiUsage() {
        return implement(appContract.analytics.getApiUsage)
            .use(requireAuth())
            .handler(({ input }) => {
                const { timeRange = "1d", groupBy = "endpoint", limit = 20 } = input.query ?? {};
                return this.analyticsService.getApiUsage(timeRange, groupBy, limit);
            });
    }

    @Implement(appContract.analytics.getDeploymentUsage)
    getDeploymentUsage() {
        return implement(appContract.analytics.getDeploymentUsage)
            .use(requireAuth())
            .handler(({ input }) => {
                const { timeRange = "30d", projectId, userId } = input.query ?? {};
                return this.analyticsService.getDeploymentUsage(timeRange, projectId, userId);
            });
    }

    @Implement(appContract.analytics.getStorageUsage)
    getStorageUsage() {
        return implement(appContract.analytics.getStorageUsage)
            .use(requireAuth())
            .handler(({ input }) => {
                const { timeRange = "30d", breakdown = "project" } = input.query ?? {};
                return this.analyticsService.getStorageUsage(timeRange, breakdown);
            });
    }

    @Implement(appContract.analytics.generateReport)
    generateReport() {
        return implement(appContract.analytics.generateReport)
            .use(requireAuth())
            .handler(({ input }) =>
                this.analyticsService.generateReport(input),
            );
    }

    @Implement(appContract.analytics.getReport)
    getReport() {
        return implement(appContract.analytics.getReport)
            .use(requireAuth())
            .handler(({ input }) => this.analyticsService.getReport(input.params.reportId));
    }

    @Implement(appContract.analytics.listReports)
    listReports() {
        return implement(appContract.analytics.listReports)
            .use(requireAuth())
            .handler(({ input }) => {
                const { status, limit = 20, offset = 0 } = input.query ?? {};
                return this.analyticsService.listReports(limit, offset, status);
            });
    }

    @Implement(appContract.analytics.deleteReport)
    deleteReport() {
        return implement(appContract.analytics.deleteReport)
            .use(requireAuth())
            .handler(({ input }) => this.analyticsService.deleteReport(input.params.reportId));
    }

    @Implement(appContract.analytics.downloadReport)
    downloadReport() {
        return implement(appContract.analytics.downloadReport)
            .use(requireAuth())
            .handler(({ input }) => this.analyticsService.downloadReport(input.params.reportId));
    }

    @Implement(appContract.analytics.createReportConfig)
    createReportConfig() {
        return implement(appContract.analytics.createReportConfig)
            .use(requireAuth())
            .handler(({ input }) =>
                this.analyticsService.createReportConfig(input),
            );
    }

    @Implement(appContract.analytics.listReportConfigs)
    listReportConfigs() {
        return implement(appContract.analytics.listReportConfigs)
            .use(requireAuth())
            .handler(({ input: { query } }) => {
                const { limit = 20, offset = 0 } = query ?? {};
                return this.analyticsService.listReportConfigs(limit, offset);
            });
    }

    @Implement(appContract.analytics.updateReportConfig)
    updateReportConfig() {
        return implement(appContract.analytics.updateReportConfig)
            .use(requireAuth())
            .handler(({ input }) =>
                this.analyticsService.updateReportConfig(input.params.configId, input.body ?? {}),
            );
    }

    @Implement(appContract.analytics.deleteReportConfig)
    deleteReportConfig() {
        return implement(appContract.analytics.deleteReportConfig)
            .use(requireAuth())
            .handler(({ input }) => this.analyticsService.deleteReportConfig(input.params.configId));
    }
}
