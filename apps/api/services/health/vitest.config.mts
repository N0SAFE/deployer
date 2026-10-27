import { createServiceTestConfig } from "@deployer/config-vitest/service";

/**
 * The health app's test config. Everything shared — the SWC decorator transform, the
 * `@/core` aliases, the unit/e2e projects — lives in
 * `@deployer/config-vitest/service`, so this file is only what is specific to health.
 */
export default createServiceTestConfig({ service: "health" });
