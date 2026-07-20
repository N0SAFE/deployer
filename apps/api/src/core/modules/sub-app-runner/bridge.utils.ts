/**
 * Bridge utilities — create injectable bridge + result token pairs.
 *
 * Usage:
 *
 *   // 1. Define the bridge pair from a Zod schema
 *   const { Bridge, Result } = createResultBridge(setupWizardBridgeSchema);
 *   //    Bridge = @Injectable() trigger class (extends BaseTriggerService)
 *   //    Result = DI token class (resolves to bridge.waitFor() output)
 *   //    When injected, it's typed as the Zod-schema output type
 *
 *   // 2. In module, provide the bridge + inject the result
 *   providers: [
 *     Bridge,
 *     injectResult(Bridge, Result),  // provides Result with bridge.waitFor()
 *   ]
 *
 *   // 3. In service, inject directly — no @Inject() needed for class tokens
 *   constructor(
 *     private readonly wizardResult: SetupWizardBridgeResult,
 *     //                        ^ typed as SetupWizardBridgePayload
 *   ) {}
 */

import { Injectable } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { z } from 'zod/v4';
import { BaseTriggerService } from '@/core/modules/triggers/base-bridge.service';

/**
 * Helper to create a bridge + result pair from a Zod schema.
 *
 * The `Result` class is cast so TypeScript sees its instance type as the
 * schema's output type — enabling direct injection without `@Inject()`.
 */
export function createResultBridge<S extends z.ZodType<any, any, any>>(
  schema: S,
): {
  Bridge: Type<BaseTriggerService<S>>;
  Result: new (...args: any[]) => z.output<S>;
} {
  // Generate a unique ID from the caller's module path or a random string
  const bridgeId = `Bridge_${crypto.randomUUID().slice(0, 8)}`;

  @Injectable()
  class Bridge extends BaseTriggerService<S> {
    static readonly bridgeId = bridgeId;
    constructor() {
      super(schema);
    }
  }

  // Result is a DI token class.
  class _Result {}

  return {
    Bridge: Bridge,
    Result: _Result as unknown as Type<z.output<S>>,
  };
}

/**
 * Creates a provider entry that resolves a bridge's waitFor() as a DI token.
 *
 * @param Bridge - The bridge class (from createResultBridge)
 * @param Result - The result class (from createResultBridge)
 * @returns A provider object ready for the providers array
 *
 * @example
 * providers: [
 *   SetupWizardBridge,
 *   injectResult(SetupWizardBridge, SetupWizardBridgeResult),
 * ]
 */
export function injectResult<
  B extends BaseTriggerService<any>,
  R extends Type,
>(
  Bridge: Type<B>,
  Result: R,
) {
  return {
    provide: Result,
    useFactory: (bridge: B) => bridge.waitFor(),
    inject: [Bridge],
  };
}
