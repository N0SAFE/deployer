import type { BaseTriggerService } from '@/core/modules/triggers/base-bridge.service';
import type { z } from 'zod/v4';

/**
 * Generates a DI token for a sub-app's result based on its bridge class.
 * Core modules inject this token to get the sub-app's typed output.
 *
 * The token is a Symbol keyed on the bridge class name, so injecting
 * with the same bridge class always resolves to the same token.
 *
 * Usage:
 *   inject: [SUB_APP_RESULT(SetupWizardBridge)]
 *   useFactory: (result: SetupWizardBridgePayload) => { ... }
 *
 * The result type is automatically inferred from the bridge's schema.
 */
export const SUB_APP_RESULT = <TBridge extends BaseTriggerService<any>>(
  bridgeClass: { new (...args: any[]): TBridge },
): symbol => {
  return Symbol.for(`SUB_APP_RESULT_${bridgeClass.name}`);
};

/**
 * Utility type: extract the payload type from a bridge class.
 *
 * Usage:
 *   @Inject(SUB_APP_RESULT(SetupWizardBridge))
 *   private readonly result: BridgeResult<SetupWizardBridge>
 */
export type BridgeResult<T extends BaseTriggerService<any>> = 
  T extends BaseTriggerService<infer S> 
    ? S extends z.ZodType 
      ? z.output<S> 
      : never 
    : never;
