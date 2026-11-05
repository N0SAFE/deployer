import { access } from "@deployer/auth/authz/meta";
import { serviceWithEffectiveConfigSchema } from "@deployer/contracts-entities";
import { standardDomainErrorContracts } from "@deployer/orpc-utils";

import { serviceOps } from "./shared";

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
  .meta(access({ permission: "service:read", scope: { by: "input", path: "params.id", kind: "service" } }))
  .build();
