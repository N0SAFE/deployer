import { startSharedWebContainer, stopSharedWebContainer } from "./vitest.shared-web.e2e";

export { WEB_E2E_BASE_URL_FILE } from "./vitest.shared-web.e2e";

/**
 * Global setup for the web app's Vitest e2e project.
 *
 * Starts the web app in a shared Docker container (oven/bun image, repo
 * mounted read-only) with a fully controlled environment — same pattern as
 * apps/api's vitest.shared-postgres.e2e.ts. The production build must exist
 * first: `bun --bun run build` (the `test:e2e` script chains it).
 *
 * Vitest has no separate global-teardown hook — the teardown MUST be
 * returned from this default export so vitest runs it after the suite.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  await startSharedWebContainer();
  return async () => {
    await stopSharedWebContainer();
  };
}
