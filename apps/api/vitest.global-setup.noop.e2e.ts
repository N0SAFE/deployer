/**
 * No-op globalSetup that makes vitest run the globalTeardown.
 *
 * Vitest only calls globalTeardown when globalSetup is also configured for
 * the project. This file provides a no-op setup so that the teardown always
 * runs, whether or not the shared Postgres container is used.
 */
// eslint-disable-next-line import/no-anonymous-default-export
export default async function globalSetupNoop(): Promise<void> {
  // Nothing to set up — this exists only to satisfy vitest's globalTeardown
  // lifecycle requirement.
}
