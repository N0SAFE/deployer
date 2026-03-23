import { startSharedPostgresContainer } from "./vitest.shared-postgres.e2e";

export default async function globalSetup() {
  await startSharedPostgresContainer();
}
