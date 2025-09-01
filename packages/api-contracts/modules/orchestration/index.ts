import { oc } from "@orpc/contract";

// Import all individual contracts
import { createStackContract } from './createStack';
import { getStackContract } from './getStack';
import { listStacksContract } from './listStacks';
import { updateStackContract } from './updateStack';
import { removeStackContract } from './removeStack';
import { scaleServicesContract } from './scaleServices';
import { getDomainMappingsContract } from './getDomainMappings';
import { updateDomainMappingsContract } from './updateDomainMappings';
import { listCertificatesContract } from './listCertificates';
import { getCertificateStatusContract } from './getCertificateStatus';
import { renewCertificateContract } from './renewCertificate';
import { listJobsContract } from './listJobs';
import { getJobContract } from './getJob';
import { getJobQueueStatsContract } from './getJobQueueStats';
import { retryJobsContract } from './retryJobs';
import { getJobHistoryContract } from './getJobHistory';
import { cancelJobContract } from './cancelJob';
import { getSystemHealthContract } from './getSystemHealth';
import { getServiceHealthContract } from './getServiceHealth';
import { getSystemMetricsContract } from './getSystemMetrics';
import { getHealthHistoryContract } from './getHealthHistory';
import { runHealthCheckContract } from './runHealthCheck';
import { setResourceQuotasContract } from './setResourceQuotas';
import { getResourceAllocationContract } from './getResourceAllocation';
import { getSystemResourceSummaryContract } from './getSystemResourceSummary';
import { getResourceAlertsContract } from './getResourceAlerts';
import { generateTraefikPreviewContract } from './generateTraefikPreview';

// Combine into main orchestration contract
export const orchestrationContract = oc.tag("Orchestration").prefix("/orchestration").router({
  // Stack management
  createStack: createStackContract,
  getStack: getStackContract,
  listStacks: listStacksContract,
  updateStack: updateStackContract,
  removeStack: removeStackContract,
  scaleServices: scaleServicesContract,

  // Domain and SSL management
  getDomainMappings: getDomainMappingsContract,
  updateDomainMappings: updateDomainMappingsContract,
  listCertificates: listCertificatesContract,
  getCertificateStatus: getCertificateStatusContract,
  renewCertificate: renewCertificateContract,

  // Resource management
  setResourceQuotas: setResourceQuotasContract,
  getResourceAllocation: getResourceAllocationContract,
  getSystemResourceSummary: getSystemResourceSummaryContract,
  getResourceAlerts: getResourceAlertsContract,

  // Traefik configuration
  generateTraefikPreview: generateTraefikPreviewContract,

  // Job management
  listJobs: listJobsContract,
  getJob: getJobContract,
  getJobQueueStats: getJobQueueStatsContract,
  retryJobs: retryJobsContract,
  getJobHistory: getJobHistoryContract,
  cancelJob: cancelJobContract,

  // Health monitoring
  getSystemHealth: getSystemHealthContract,
  getServiceHealth: getServiceHealthContract,
  getSystemMetrics: getSystemMetricsContract,
  getHealthHistory: getHealthHistoryContract,
  runHealthCheck: runHealthCheckContract,
});

export type OrchestrationContract = typeof orchestrationContract;

// Re-export all individual contracts and schemas
export * from './createStack';
export * from './getStack';
export * from './listStacks';
export * from './updateStack';
export * from './removeStack';
export * from './scaleServices';
export * from './getDomainMappings';
export * from './updateDomainMappings';
export * from './listCertificates';
export * from './getCertificateStatus';
export * from './renewCertificate';
export * from './setResourceQuotas';
export * from './getResourceAllocation';
export * from './getSystemResourceSummary';
export * from './getResourceAlerts';
export * from './generateTraefikPreview';
export * from './listJobs';
export * from './getJob';
export * from './getJobQueueStats';
export * from './retryJobs';
export * from './getJobHistory';
export * from './cancelJob';
export * from './getSystemHealth';
export * from './getServiceHealth';
export * from './getSystemMetrics';
export * from './getHealthHistory';
export * from './runHealthCheck';
export * from './schemas';