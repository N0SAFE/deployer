import { createServiceTestConfig } from "@deployer/config-vitest/service";

/**
 * The node-agent's test config. Everything shared (the SWC decorator transform, the `@/core` aliases, the
 * unit/e2e projects) lives in `@deployer/config-vitest/service`, so this file is only what is specific here.
 */
export default createServiceTestConfig({ service: "node-agent" });
