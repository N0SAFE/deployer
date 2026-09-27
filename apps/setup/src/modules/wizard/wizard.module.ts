import { Module } from "@nestjs/common";
import { RenderModule } from "@nestjs-ssr/react";

import { EnvModule } from "@/config/env/env.module";
import { localDatabaseRegistration } from "@/config/database/local-database.module";
import { NodesModule } from "@repo/nest-nodes";
import { SetupHealthModule } from "@/modules/health/setup-health.module";
import { SetupClusterModule } from "@/modules/cluster/cluster.module";
import { SetupGateService } from "./setup-gate.service";
import { WizardController } from "./wizard.controller";
import { WizardStateService } from "./wizard-state.service";
import { WizardStreamService } from "./wizard-stream.service";
import { WizardUpstreamService } from "./wizard-upstream.service";

/**
 * The wizard half of setup: the onboarding page and the proxy to the API that
 * executes provisioning.
 *
 * `RenderModule.forRoot` is configured HERE with this app's own `viewsDir`, so
 * the SSR view discovery scans `apps/setup/src/views` and not the API's. That
 * separation is the point of plan §6.3: the API's entry globs every `views`
 * directory under its source root, which would drag every product page into the
 * setup bundle if the two apps shared a views root.
 *
 * Vite runs on **5174** (the API uses 5173) because in dev BOTH apps run at once
 * — setup drives the API — so they must not contend for the dev asset server.
 */
@Module({
  imports: [
    EnvModule,
    SetupHealthModule,
    // The GATE starts the cluster phase, so this module needs the orchestrator.
    //
    // DIRECTION: wizard → cluster, and never the reverse. `SetupClusterModule`
    // does not import this one — it only publishes phases through
    // `SetupPhaseService` — which is what keeps the graph acyclic. The DI gate
    // (`check-di-graph.ts`) enforces that.
    SetupClusterModule,
    // The gate persists the wizard's choices into the SHARED `node_config` row
    // (the same SQLite file the API reads), so it needs the repositories. The
    // registration is passed in rather than imported ambiently, exactly as
    // `SetupClusterModule` does — the app owns the file path.
    NodesModule.forRoot({ localDatabase: localDatabaseRegistration() }),
    RenderModule.forRoot({
      project: "setup",
      viewsDir: "src/views",
      environment:
        process.env.NODE_ENV === "production" || process.env.NODE_ENV === "test"
          ? "production"
          : "development",
      vite: { port: 5174 },
    }),
  ],
  controllers: [WizardController],
  providers: [SetupGateService, WizardStateService, WizardUpstreamService, WizardStreamService],
  exports: [SetupGateService, WizardStateService, WizardUpstreamService, WizardStreamService],
})
export class WizardModule {}
