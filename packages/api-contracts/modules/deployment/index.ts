import { oc } from '@orpc/contract';
/**
 * Deployment Contract - Core Deployment Operations
 *
 * This contract handles the essential deployment operations for the platform:
 * - Deployment lifecycle management (trigger, cancel, rollback)
 * - Real-time status monitoring and logging
 * - WebSocket integration for live updates
 *
 * This is the PRIMARY deployment contract used by the frontend.
 * It provides simple, focused deployment operations without complex CI/CD pipeline overhead.
 *
 * Routes: /deployment/*
 * Frontend Usage: ✅ Active - Used by useDeployments.ts hooks
 *
 * @see ../../CONTRACT_ARCHITECTURE.md for contract organization
 */
// Import all contract definitions
import { deploymentGetStatusContract } from './getStatus';
import { deploymentJobStatusContract } from './jobStatus';
import { deploymentTriggerContract } from './trigger';
import { deploymentCancelContract } from './cancel';
import { deploymentRollbackContract } from './rollback';
import { deploymentGetLogsContract } from './getLogs';
import { deploymentListContract } from './list';
import { deploymentSubscribeContract, deploymentUnsubscribeContract, deploymentStatusUpdateContract, deploymentLogStreamContract, } from './websocket';
import { deploymentHealthMonitorContract, deploymentDetailedStatusContract, deploymentRestartUnhealthyContract } from './health';
import { deploymentListContainersContract, deploymentContainerActionContract } from './listContainers';
import { 
    deploymentGetRollbackHistoryContract,
    deploymentPreviewCleanupContract, 
    deploymentTriggerCleanupContract,
    deploymentUpdateRetentionPolicyContract
} from './rollbackHistory';

// Combine HTTP API contracts into main deployment contract
export const deploymentContract = oc.tag("Deployment").prefix("/deployment").router({
    getStatus: deploymentGetStatusContract,
    jobStatus: deploymentJobStatusContract,
    trigger: deploymentTriggerContract,
    cancel: deploymentCancelContract,
    rollback: deploymentRollbackContract,
    getLogs: deploymentGetLogsContract,
    list: deploymentListContract,
    health: deploymentHealthMonitorContract,
    detailedStatus: deploymentDetailedStatusContract,
    restartUnhealthy: deploymentRestartUnhealthyContract,
    listContainers: deploymentListContainersContract,
    containerAction: deploymentContainerActionContract,
    // Rollback history and cleanup
    getRollbackHistory: deploymentGetRollbackHistoryContract,
    previewCleanup: deploymentPreviewCleanupContract,
    triggerCleanup: deploymentTriggerCleanupContract,
    updateRetentionPolicy: deploymentUpdateRetentionPolicyContract,
});
// WebSocket contracts for real-time events
export const deploymentWebSocketContract = oc.router({
    subscribe: deploymentSubscribeContract,
    unsubscribe: deploymentUnsubscribeContract,
    statusUpdate: deploymentStatusUpdateContract,
    logStream: deploymentLogStreamContract,
});
export type DeploymentContract = typeof deploymentContract;
export type DeploymentWebSocketContract = typeof deploymentWebSocketContract;
// Re-export everything from individual contracts
export * from './getStatus';
export * from './jobStatus';
export * from './trigger';
export * from './cancel';
export * from './rollback';
export * from './getLogs';
export * from './list';
export * from './websocket';
export * from './health';
export * from './listContainers';
export * from './rollbackHistory';
