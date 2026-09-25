import { Module } from "@nestjs/common";
import { RenderModule } from "@nestjs-ssr/react";

import { EnvModule } from "@/config/env/env.module";
import { SetupHealthModule } from "@/modules/health/setup-health.module";
import { WizardController } from "./wizard.controller";
import { WizardOrpcModule } from "./wizard-orpc.module";
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
  controllers: [WizardController],
  providers: [WizardUpstreamService, WizardStreamService],
  exports: [WizardUpstreamService, WizardStreamService],
})
export class WizardModule {}
