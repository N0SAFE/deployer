import { oc } from '@orpc/contract';
// Import all metrics contracts
import { analyticsGetResourceMetricsContract, analyticsGetApplicationMetricsContract, analyticsGetDatabaseMetricsContract, analyticsGetDeploymentMetricsContract, analyticsGetServiceHealthContract, analyticsGetRealTimeMetricsContract, } from './metrics';
// Import all usage contracts
import { analyticsGetResourceUsageContract, analyticsGetUserActivityContract, analyticsGetActivitySummaryContract, analyticsGetApiUsageContract, analyticsGetDeploymentUsageContract, analyticsGetStorageUsageContract, } from './usage';
// Import all reporting contracts
import { analyticsGenerateReportContract, analyticsGetReportContract, analyticsListReportsContract, analyticsDeleteReportContract, analyticsDownloadReportContract, analyticsCreateReportConfigContract, analyticsListReportConfigsContract, analyticsUpdateReportConfigContract, analyticsDeleteReportConfigContract, } from './reporting';
// Combine into main analytics contract
export const analyticsContract = oc.tag("Analytics").prefix("/analytics").router({
    // Metrics endpoints
    getResourceMetrics: analyticsGetResourceMetricsContract,
    getApplicationMetrics: analyticsGetApplicationMetricsContract,
    getDatabaseMetrics: analyticsGetDatabaseMetricsContract,
    getDeploymentMetrics: analyticsGetDeploymentMetricsContract,
    getServiceHealth: analyticsGetServiceHealthContract,
    getRealTimeMetrics: analyticsGetRealTimeMetricsContract,
    // Usage endpoints
    getResourceUsage: analyticsGetResourceUsageContract,
    getUserActivity: analyticsGetUserActivityContract,
    getActivitySummary: analyticsGetActivitySummaryContract,
    getApiUsage: analyticsGetApiUsageContract,
    getDeploymentUsage: analyticsGetDeploymentUsageContract,
    getStorageUsage: analyticsGetStorageUsageContract,
    // Reporting endpoints
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
// Re-export everything from individual contracts
export * from './schemas';
export * from './metrics';
export * from './usage';
export * from './reporting';
