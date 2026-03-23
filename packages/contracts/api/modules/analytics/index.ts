import { oc } from "@orpc/contract";
import {
    analyticsGetResourceMetricsContract,
    analyticsGetApplicationMetricsContract,
    analyticsGetDatabaseMetricsContract,
    analyticsGetDeploymentMetricsContract,
    analyticsGetServiceHealthContract,
    analyticsGetRealTimeMetricsContract,
} from "./metrics";
import {
    analyticsGetResourceUsageContract,
    analyticsGetUserActivityContract,
    analyticsGetActivitySummaryContract,
    analyticsGetApiUsageContract,
    analyticsGetDeploymentUsageContract,
    analyticsGetStorageUsageContract,
} from "./usage";
import {
    analyticsGenerateReportContract,
    analyticsGetReportContract,
    analyticsListReportsContract,
    analyticsDeleteReportContract,
    analyticsDownloadReportContract,
    analyticsCreateReportConfigContract,
    analyticsListReportConfigsContract,
    analyticsUpdateReportConfigContract,
    analyticsDeleteReportConfigContract,
} from "./reporting";

export const analyticsContract = oc.tag("Analytics").prefix("/analytics").router({
    getResourceMetrics: analyticsGetResourceMetricsContract,
    getApplicationMetrics: analyticsGetApplicationMetricsContract,
    getDatabaseMetrics: analyticsGetDatabaseMetricsContract,
    getDeploymentMetrics: analyticsGetDeploymentMetricsContract,
    getServiceHealth: analyticsGetServiceHealthContract,
    getRealTimeMetrics: analyticsGetRealTimeMetricsContract,

    getResourceUsage: analyticsGetResourceUsageContract,
    getUserActivity: analyticsGetUserActivityContract,
    getActivitySummary: analyticsGetActivitySummaryContract,
    getApiUsage: analyticsGetApiUsageContract,
    getDeploymentUsage: analyticsGetDeploymentUsageContract,
    getStorageUsage: analyticsGetStorageUsageContract,

    generateReport: analyticsGenerateReportContract,
    getReport: analyticsGetReportContract,
    listReports: analyticsListReportsContract,
    deleteReport: analyticsDeleteReportContract,
    downloadReport: analyticsDownloadReportContract,
    createReportConfig: analyticsCreateReportConfigContract,
    listReportConfigs: analyticsListReportConfigsContract,
    updateReportConfig: analyticsUpdateReportConfigContract,
    deleteReportConfig: analyticsDeleteReportConfigContract,
});

export type AnalyticsContract = typeof analyticsContract;

export * from "./schemas";
export * from "./metrics";
export * from "./usage";
export * from "./reporting";
