import { createServiceTestConfig } from "@deployer/config-vitest/service";

/**
 * The fleet app's test config. Everything shared — the SWC decorator transform, the
 * `@/core` aliases, the unit/e2e projects — lives in
 * `@deployer/config-vitest/service`, so this file is only what is specific to fleet.
 */
export default createServiceTestConfig({ service: "fleet" });
