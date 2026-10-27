import path from "node:path";
import { createServiceTestConfig } from "@deployer/config-vitest/service";

const sharedSrc = path.resolve(import.meta.dirname, "../shared/src");

/**
 * The BFF's test config. Everything shared — the SWC decorator transform, the unit/e2e
 * projects — lives in `@deployer/config-vitest/service`, so this file is only what is
 * specific to the BFF.
 *
 * ── WHY THE BFF NEEDS ALIASES THE SERVICES DO NOT ───────────────────────────
 * The BFF's source imports the shared platform through `@/auth`, `@/config/*` and
 * `@/core/*` (see its `tsconfig.json` `paths`), where each service imports it by package name
 * (`@deployer/shared/...`). Without these entries vitest resolves `@/config/...` against the
 * BFF's own `src/`, which has no such directory, so every spec that loads `bff.module.ts`
 * (all of the e2e) failed at import. They mirror the tsconfig entries one for one.
 */
export default createServiceTestConfig({
  service: "bff",
  extraAliases: [
    { find: /^@\/auth$/, replacement: path.join(sharedSrc, "auth.ts") },
    { find: /^@\/config\//, replacement: `${sharedSrc}/config/` },
    { find: /^@\/core\//, replacement: `${sharedSrc}/core/` },
    { find: /^@\/e2e-harness\//, replacement: `${sharedSrc}/e2e-harness/` },
  ],
});
