import { z } from 'zod/v4';
import { createResultBridge } from '@/core/modules/sub-app-runner/bridge.utils';
import type { BaseTriggerService } from '@/core/modules/triggers/base-bridge.service';

export const meshInitializerBridgeSchema = z.object({
  databaseUrl: z.string().min(1),
  strategy: z.enum(['local', 'remote', 'mesh_discovered']),
  nodeId: z.string().min(1),
  meshConnected: z.boolean(),
});

export type MeshInitializerBridgePayload = z.infer<typeof meshInitializerBridgeSchema>;

/** Bridge trigger + result token created from schema */
export const { Bridge: MeshInitializerBridge, Result: MeshInitializerBridgeResult } =
  createResultBridge(meshInitializerBridgeSchema);

/**
 * Class-interface merge: gives MeshInitializerBridgeResult the right shape
 * so services can inject it without @Inject() decorator:
 *
 *   constructor(
 *     private readonly meshResult: MeshInitializerBridgeResult,
 *   )   // ✓ typed as MeshInitializerBridgePayload
 */
export interface MeshInitializerBridgeResult extends MeshInitializerBridgePayload {}

/**
 * Type-interface merge: gives MeshInitializerBridge a proper instance type
 * so services can use it as a type annotation without the value-as-type error:
 *
 *   constructor(
 *     private readonly meshBridge: MeshInitializerBridge,
 *   )   // ✓ typed as BaseTriggerService<typeof meshInitializerBridgeSchema>
 */
export interface MeshInitializerBridge extends BaseTriggerService<typeof meshInitializerBridgeSchema> {}


