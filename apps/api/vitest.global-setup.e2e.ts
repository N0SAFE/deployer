import { startSharedPostgresContainer } from "./vitest.shared-postgres.e2e";
// Vitest has no separate global-teardown hook — the ONLY mechanism is a
// teardown closure returned from this default export. The previous
// `globalTeardown` config key was silently ignored, so containers leaked on
// every run; delegating to vitest.teardown.e2e.ts here makes it actually run.
import globalTeardown from "./vitest.teardown.e2e";

export default async function globalSetup(): Promise<() => Promise<void>> {
  await startSharedPostgresContainer();
  return globalTeardown;
}
