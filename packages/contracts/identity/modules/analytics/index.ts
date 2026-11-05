import { oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'

import {
    analyticsGetResourceMetricsContract,
    analyticsGetApplicationMetricsContract,
    analyticsGetDatabaseMetricsContract,
    analyticsGetDeploymentMetricsContract,
    analyticsGetServiceHealthContract,
    analyticsGetRealTimeMetricsContract,
    analyticsStreamResourceMetricsContract,
    analyticsStreamDeploymentMetricsContract,
    analyticsStreamServiceHealthContract,
    analyticsStreamRealTimeMetricsContract,
} from './metrics'
import {
    analyticsGenerateReportContract,
    analyticsGetReportContract,
    analyticsListReportsContract,
    analyticsDeleteReportContract,
    analyticsDownloadReportContract,
    analyticsReportContentContract,
    analyticsCreateReportConfigContract,
    analyticsListReportConfigsContract,
    analyticsUpdateReportConfigContract,
    analyticsDeleteReportConfigContract,
} from './reporting'
import {
    analyticsGetResourceUsageContract,
    analyticsGetUserActivityContract,
    analyticsGetActivitySummaryContract,
    analyticsGetApiUsageContract,
    analyticsGetDeploymentUsageContract,
    analyticsGetStorageUsageContract,
    analyticsStreamResourceUsageContract,
    analyticsStreamDeploymentUsageContract,
} from './usage'

export const analyticsContract = oc
    .meta(openapi({ tags: ['Analytics'], prefix: '/analytics' }))
    .router({
        getResourceMetrics: analyticsGetResourceMetricsContract,
        getApplicationMetrics: analyticsGetApplicationMetricsContract,
        getDatabaseMetrics: analyticsGetDatabaseMetricsContract,
        getDeploymentMetrics: analyticsGetDeploymentMetricsContract,
        getServiceHealth: analyticsGetServiceHealthContract,
        getRealTimeMetrics: analyticsGetRealTimeMetricsContract,

        // SSE siblings of the polled reads above: same input, pushed on change.
        getResourceMetricsStream: analyticsStreamResourceMetricsContract,
        getDeploymentMetricsStream: analyticsStreamDeploymentMetricsContract,
        getServiceHealthStream: analyticsStreamServiceHealthContract,
        getRealTimeMetricsStream: analyticsStreamRealTimeMetricsContract,

        getResourceUsage: analyticsGetResourceUsageContract,
        getUserActivity: analyticsGetUserActivityContract,
        getActivitySummary: analyticsGetActivitySummaryContract,
        getApiUsage: analyticsGetApiUsageContract,
        getDeploymentUsage: analyticsGetDeploymentUsageContract,
        getStorageUsage: analyticsGetStorageUsageContract,

        getResourceUsageStream: analyticsStreamResourceUsageContract,
        getDeploymentUsageStream: analyticsStreamDeploymentUsageContract,

        generateReport: analyticsGenerateReportContract,
        getReport: analyticsGetReportContract,
        listReports: analyticsListReportsContract,
        deleteReport: analyticsDeleteReportContract,
        downloadReport: analyticsDownloadReportContract,
        getReportContent: analyticsReportContentContract,
        createReportConfig: analyticsCreateReportConfigContract,
        listReportConfigs: analyticsListReportConfigsContract,
        updateReportConfig: analyticsUpdateReportConfigContract,
        deleteReportConfig: analyticsDeleteReportConfigContract,
    })

export type AnalyticsContract = typeof analyticsContract

export * from './schemas'
export * from './metrics'
export * from './usage'
export * from './reporting'
