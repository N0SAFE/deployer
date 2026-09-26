import { Test } from "@nestjs/testing";
import { describe, expect, it, vi } from "vitest";

// The SSR module resolves a client bundle on disk (its RenderService reads
// `dist/client/index.html`) and throws when the app has not been built:
//
//   Error: Template file not found at apps/setup/dist/client/index.html
//
// That is a RENDERING concern, not a DI-graph one, and building the SSR bundle
// before every unit run would make this check slow and non-hermetic. Mocking it
// mirrors `apps/api/src/app.module.spec.ts`, which documents the same reason. The
// mock keeps the module's SHAPE (so consumers of its exports still resolve)
// while removing the filesystem dependency.
vi.mock("@nestjs-ssr/react", () => ({
  RenderModule: { forRoot: vi.fn().mockReturnValue({ module: class {} }) },
  Render: () => () => {},
}));

import { SetupAppModule } from "./app.module";

/**
 * The Nest GRAPH is assemblable.
 *
 * This is the check `type-check` cannot give: tsc validates types, not whether
 * Nest can resolve the DI graph. A provider whose consumer does not import it,
 * or an `@Inject(TOKEN)` nobody binds, compiles cleanly and throws at boot.
 *
 * It has already paid for itself. The first run failed with:
 *
 *   Nest can't resolve dependencies of the NodeConfigRepository (?).
 *   Please make sure that the argument LocalDatabaseService at index [0] is
 *   available in the NodesModule module.
 *
 * `NodesModule` declared no `imports` and relied on `LocalDatabaseModule` being
 * registered globally by whichever app happened to do it. `apps/api` did;
 * `apps/setup` did not, so its graph could not be assembled at all.
 *
 * WHY `Test.createTestingModule` AND NOT `createSetupApp()`
 * They answer different questions and both are wanted, so this deliberately does
 * NOT reuse the shared factory:
 *
 *   compile.ts         the real factory — the app that actually starts
 *   this spec          the module graph — fast, no HTTP adapter, parallel
 *
 * Running the real factory here would still run every `onModuleInit`, coupling
 * this check to boot ordering. The graph is what catches DI mistakes, and it is
 * cheap — so it runs in the unit suite while `compile.ts` runs at build time.
 *
 * `close()` is not optional: leaving a compiled module open keeps its providers'
 * subscriptions and timers alive, which in a test runner means a hanging process.
 */
describe("SetupAppModule", () => {
  it("assembles the Nest module graph", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SetupAppModule],
    }).compile();

    await moduleRef.close();
  });
});
