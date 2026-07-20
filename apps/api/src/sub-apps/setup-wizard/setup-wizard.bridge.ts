import { z } from 'zod/v4';
import { createResultBridge } from '@/core/modules/sub-app-runner/bridge.utils';
import type { BaseTriggerService } from '@/core/modules/triggers/base-bridge.service';

export const setupWizardBridgeSchema = z.object({
  databaseUrl: z.string().min(1),
  strategy: z.enum(['local', 'remote']),
  nodeId: z.string().min(1),
});

export type SetupWizardBridgePayload = z.infer<typeof setupWizardBridgeSchema>;

/** Bridge trigger + result token created from schema */
export const { Bridge: SetupWizardBridge, Result: SetupWizardBridgeResult } =
  createResultBridge(setupWizardBridgeSchema);

/**
 * Class-interface merge: gives SetupWizardBridgeResult the right shape
 * so services can inject it without @Inject() decorator:
 *
 *   constructor(
 *     private readonly wizardResult: SetupWizardBridgeResult,
 *   )   // ✗ typed as SetupWizardBridgePayload
 */
export interface SetupWizardBridgeResult extends SetupWizardBridgePayload {}

/**
 * Type-interface merge: gives SetupWizardBridge a proper instance type
 * so services can use it as a type annotation directly.
 */
export interface SetupWizardBridge extends BaseTriggerService<typeof setupWizardBridgeSchema> {}
