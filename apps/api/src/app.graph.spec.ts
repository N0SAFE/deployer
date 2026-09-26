import { Test } from "@nestjs/testing";
import { describe, it, vi } from "vitest";

// The SSR module resolves a client bundle on disk (its RenderService reads
// `dist/client/index.html`) and throws when the app has not been built:
//
//   Error: Template file not found at apps/api/dist/client/index.html
//
// That is a RENDERING concern, not a DI-graph one, and building the SSR bundle
// before every unit run would make this check slow and non-hermetic. Mocking it
// mirrors `apps/setup/src/app.module.spec.ts`, which documents the same reason.
// The mock keeps the module's SHAPE (so consumers of its exports still resolve)
// while removing the filesystem dependency.
vi.mock("@nestjs-ssr/react", () => ({
  RenderModule: { forRoot: vi.fn().mockReturnValue({ module: class {} }) },
  Render: () => () => {},
}));

import { AppModule } from "./app.module";

/**
 * The Nest GRAPH is assemblable.
 *
 * This is the check `type-check` cannot give: tsc validates types, not whether
 * Nest can resolve the DI graph. A provider whose consumer does not import it,
 * or an `@Inject(TOKEN)` nobody binds, compiles cleanly and throws at boot.
 *
 * WHY A SEPARATE FILE FROM `app.module.configure.spec.ts`
 * That file asserts the middleware WIRING — it never builds a container, so it
 * CANNOT catch a DI defect. This one assembles the real graph and closes it.
 * They are split because they fail for unrelated reasons: a wiring regression
 * should not look like a broken provider.
 *
 * IT HAS ALREADY PAID FOR ITSELF. The first runs failed with:
 *
 *   Nest can't resolve dependencies of the DatabaseStartupGuard
 *   (NodeConfigRepository, ?, DatabaseProbeService)
 *
 * `AppLifecycleModule` is `@Global() @Module({})` — importing it BARE registers
 * no providers, and only `forRoot()` does. Every registration in the repo
 * imported the bare class, so `AppLifecycleService` was never provided anywhere.
 * The next run then exposed `NodeConfigRepository` unable to resolve
 * `LocalDatabaseService`, the same hidden coupling `apps/setup` had hit.
 *
 * WHY `AppModule` AND NOT `OrchestrationModule`
 * The gateway's `onApplicationBootstrap` spawns sub-apps as separate processes.
 * A graph check must not start services, and `AppModule` is the harder graph
 * (225+ routes, the whole DI surface), so it is the stronger guarantee.
 *
 * WHY `Test.createTestingModule` AND NOT `createCompileContext()`
 * They answer different questions and both are wanted, so this deliberately
 * does NOT reuse the shared factory:
 *
 *   compile.ts         the real context — what ships
 *   this spec          the module graph — fast, no HTTP adapter, parallel
 *
 * Running the real context here would still run every `onModuleInit`, coupling
 * this check to boot ordering. The graph is what catches DI mistakes, and it is
 * cheap — so it runs in the unit suite while `compile.ts` runs at build time.
 *
 * `close()` is not optional: leaving a compiled module open keeps its providers'
 * subscriptions and timers alive, which in a test runner means a hanging process.
 */
describe("AppModule (graph)", () => {
  it("assembles the Nest module graph", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    await moduleRef.close();
  });
});
