import "reflect-metadata";

const log = (...args: unknown[]) => {
  console.log(new Date().toISOString(), ...args);
};

const envBase = {
  NODE_ENV: "test",
  AUTH_SECRET: "test-auth-secret-key-for-testing-only",
  BETTER_AUTH_SECRET: "test-auth-secret-key-for-testing-only",
  NEXT_PUBLIC_API_URL: "http://localhost:3001",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  API_PORT: "3001",
  DEFAULT_ADMIN_EMAIL: "admin@test.com",
  DEFAULT_ADMIN_PASSWORD: "testpassword",
  NODE_LOCAL_DB_PATH: "/tmp/deployer-api-e2e-local.db",
};

const run = async () => {
  log("start script");
  const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
  log("loaded testcontainers");
  const container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("deployer_e2e")
    .withUsername("deployer")
    .withPassword("deployer")
    .start();
  log("container started", container.getId());

  const uri = new URL(container.getConnectionUri());
  if (uri.hostname === "localhost") uri.hostname = "127.0.0.1";

  Object.assign(process.env, envBase, { DATABASE_URL: uri.toString() });

  const { Test } = await import("@nestjs/testing");
  const { AppModule } = await import("../src/app.module");

  const imports = (Reflect.getMetadata("imports", AppModule) as unknown[]) ?? [];
  const timeoutMs = 15000;

  const nameOf = (imp: unknown): string => {
    if (!imp) return "<null>";
    if (typeof imp === "function") return (imp as { name?: string }).name ?? "<anonymous fn>";
    if (typeof imp === "object" && imp !== null && "module" in imp) {
      const moduleName = (imp as { module?: { name?: string } }).module?.name;
      return moduleName ? `${moduleName}(dynamic)` : "<dynamic module>";
    }
    return typeof imp;
  };

  log("imports", imports.length);

  for (let i = 1; i <= imports.length; i += 1) {
    const subset = imports.slice(0, i);
    const current = nameOf(imports[i - 1]);
    const start = Date.now();
    try {
      const compiled = await Promise.race([
        Test.createTestingModule({ imports: subset }).compile(),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);

      log("OK", i, current, `${Date.now() - start}ms`);
      await (compiled as { close: () => Promise<void> }).close();
    } catch (error) {
      log("FAIL", i, current, `${Date.now() - start}ms`, error);
      break;
    }
  }

  await container.stop();
  log("done");
};

run().catch((error) => {
  log("fatal", error);
  process.exitCode = 1;
});
