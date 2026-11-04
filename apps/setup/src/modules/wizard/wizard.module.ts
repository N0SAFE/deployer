import { RenderModule } from "@nestjs-ssr/react";

import { createModuleContext, serviceLifecycle } from "@deployer/nest-effect";
import { NodeConfigRepository } from "@deployer/node-state";

import { NodeStateModule } from "@/config/database/node-state.module";
import { EnvModule, EnvService } from "@/config/env/env.module";
import { SetupClusterModule } from "@/modules/cluster/cluster.module";
import { ClusterOrchestratorService } from "@/modules/cluster/services/cluster-orchestrator.service";
import { SetupHealthModule } from "@/modules/health/setup-health.module";
import { SetupPhaseService } from "@/modules/health/setup-phase.service";
import { SetupProgressModule } from "@/modules/progress/progress.module";
import { OrchestrationStreamService } from "@/modules/progress/services/orchestration-stream.service";

import { makeMeshOnboardingService, MeshOnboardingService } from "./mesh-onboarding.service";
import { NODE_CONFIG_READER, NODE_CONFIG_STORE } from "./node-config.port";
import { makeSetupGateService, SetupGateService } from "./setup-gate.service";
import { WizardOrpcModule } from "./wizard-orpc.module";
import { WizardPageController } from "./wizard-page.controller";
import { makeWizardStateService, WizardStateService } from "./wizard-state.service";
import { makeWizardStreamService, WizardStreamService } from "./wizard-stream.service";
import { makeWizardUpstreamService, WizardUpstreamService } from "./wizard-upstream.service";
import { WizardController } from "./wizard.controller";


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
export class WizardModule extends createModuleContext({
  imports: [
    EnvModule,
    SetupHealthModule,
    // The operator's progress timeline. Imported rather than provided here
    // because `cluster/` and `handover/` report on it too — see the module.
    SetupProgressModule,
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
    NodeStateModule,
    // The oRPC registration and its error mapping. `@Implement` mounts its own
    // routes, but the error mapping only exists once this module provides the
    // (global) `ImplementInterceptor` — without it a thrown `HttpException` or a
    // raw failure degrades to a bare 500 and the reason is lost.
    WizardOrpcModule.forRoot(),
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
  controllers: [WizardPageController, WizardController],
  providers: [
    // ── THE NARROW PORTS ARE BOUND TO THE REAL REPOSITORY ───────────────────
    // `SetupGateService` and `WizardStateService` take `NodeConfigStore` /
    // `NodeConfigReader` (a `Pick` of the repository) instead of the class, so
    // their specs can stub them without a private `localDb`. A `Pick` is a TYPE,
    // and Nest resolves by runtime token — an interface/type alias has none — so
    // the binding has to be explicit or the graph fails with
    // "Nest can't resolve dependencies of the SetupGateService".
    //
    // `useExisting` (not `useClass`) so there is still exactly ONE instance: the
    // `NodesModule` export is the single source, and `useClass` would construct a
    // second repository over the same file.
    {
      provide: NODE_CONFIG_STORE,
      useExisting: NodeConfigRepository,
    },
    {
      provide: NODE_CONFIG_READER,
      useExisting: NodeConfigRepository,
    },
    {
      provide: SetupGateService,
      useFactory: makeSetupGateService,
      inject: [SetupPhaseService, NODE_CONFIG_STORE, EnvService, ClusterOrchestratorService, OrchestrationStreamService],
    },
    serviceLifecycle(SetupGateService),
    { provide: MeshOnboardingService, useFactory: (env: EnvService) => makeMeshOnboardingService(env), inject: [EnvService] },
    { provide: WizardStateService, useFactory: makeWizardStateService, inject: [NODE_CONFIG_READER] },
    { provide: WizardUpstreamService, useFactory: makeWizardUpstreamService, inject: [EnvService] },
    { provide: WizardStreamService, useFactory: makeWizardStreamService, inject: [WizardUpstreamService, SetupPhaseService] },
  ],
  exports: [
    SetupGateService,
    MeshOnboardingService,
    WizardStateService,
    WizardUpstreamService,
    WizardStreamService,
  ],
}) {}
