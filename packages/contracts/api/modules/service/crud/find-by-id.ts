import { standardDomainErrorContracts } from "@repo/orpc-utils";
import { serviceOps } from "./shared";
import { serviceWithEffectiveConfigSchema } from "@repo/contracts-entities";

/**
 * Service detail — includes the resolved `effectiveConfig` (parent-chain
 * inheritance resolved server-side, Compose-merge semantics: child overrides
 * parent). The UI shows what the service will ACTUALLY run with.
 */
export const serviceFindByIdContract = serviceOps
  .read()
  .output((b) => b.body(serviceWithEffectiveConfigSchema.nullable()))
  .errors((e) => [
    // 404 when the service doesn't exist (or is inaccessible).
    ...standardDomainErrorContracts(e),
  ])
  .build();
