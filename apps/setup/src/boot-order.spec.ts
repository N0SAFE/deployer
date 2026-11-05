import { Test } from "@nestjs/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

vi.mock("@nestjs-ssr/react", () => ({
  RenderModule: { forRoot: vi.fn().mockReturnValue({ module: class {} }) },
  Render: () => () => {},
}));

import { SetupAppModule } from "./app.module";
import { ApiServiceProvisioner } from "./modules/handover/services/api-service-provisioner.service";
import { IngressHandoverService } from "./modules/handover/services/ingress-handover.service";
import { SetupPhaseService } from "./modules/health/setup-phase.service";
import { BootstrapIngressService } from "./modules/ingress/services/bootstrap-ingress.service";
import { NODE_CONFIG_STORE } from "./modules/wizard/node-config.port";

/**
 * REAL Nest boot order, real module graph: a node whose setup is already done must reach the handover by itself.
 * The gate opens in its own `onApplicationBootstrap`; the handover subscribes to that edge in ITS. The edge is a plain
 * `Subject` (never replayed), so the order Nest runs the two hooks in decides whether the platform ever hands over.
 */
describe("boot order on a restart (setup_done)", () => {
  it("the handover is running when the gate opens, so ensureApi() is reached without a wizard", async () => {
    process.env.SETUP_MODE = "dev";
    const ensureApi = vi.fn(() => new Promise(() => undefined));
    const moduleRef = await Test.createTestingModule({ imports: [SetupAppModule] })
      .overrideProvider(NODE_CONFIG_STORE)
      .useValue({
        find: () => Effect.succeed({ nodeId: "n1", strategy: "local", setupState: "setup_done", meshUrlsSnapshot: [] }),
        upsert: (row: unknown) => Effect.succeed(row),
      })
      .overrideProvider(ApiServiceProvisioner)
      .useValue({ ensureApi })
      // Without this the real service starts a Traefik container on the host engine.
      .overrideProvider(BootstrapIngressService)
      .useValue({ onApplicationBootstrap: () => undefined, onModuleInit: () => undefined })
      .overrideProvider(IngressHandoverService)
      .useValue({ onApplicationBootstrap: () => undefined, onModuleInit: () => undefined })
      .compile();

    await moduleRef.init();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const phase = moduleRef.get(SetupPhaseService).current().phase;
    await moduleRef.close();

    // The gate opened AND the handover picked it up: the phase moved past `launching`.
    expect(phase).toBe("provisioning");

    expect(ensureApi).toHaveBeenCalledTimes(1);
  });
});
