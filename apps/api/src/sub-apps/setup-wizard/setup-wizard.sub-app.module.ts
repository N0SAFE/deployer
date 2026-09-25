/**
 * SetupWizardSubAppModule — the API's PRE-SETUP HTTP surface.
 *
 * WHY IT STILL EXISTS
 * The API's full AppModule (with its 225+ routes) cannot boot before the global
 * database exists, but `/setup/*` must be reachable from the first second —
 * otherwise nothing could drive provisioning. This sub-app is that pre-setup
 * surface: it mounts the setup ORPC controller on its own port (3010) so
 * onboarding works while the main app is not yet started.
 *
 * WHAT IT NO LONGER DOES
 * It does NOT serve the wizard PAGE. The page moved to `apps/setup`, which is
 * the process answering on `setup.<host>` during onboarding — the browser's
 * connection therefore terminates there, which is what lets the ingress
 * handover happen without interrupting a wizard the operator is watching
 * (see the setup-app refactor plan §9.3). The `RenderModule` and its
 * `SetupPageController` were removed with it.
 *
 * LAYER NOTE: this module is a sub-app ROOT, so it lives under `sub-apps/`. It
 * imports the setup FEATURE module (`SetupModule`) — it previously sat in
 * `core/setup-sub-app/`, which made `core/` import the feature layer (the SC7
 * reverse-import violation).
 */
import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { SetupModule } from "@/modules/setup/setup.module";
import { EnvModule } from "@/config/env/env.module";
import { InternalErrorContextMiddleware } from "@/core/middlewares/internal-error/internal-error-context.middleware";
import { LoggerMiddleware } from "@/core/middlewares/logger.middleware";

@Module({
  imports: [EnvModule, SetupModule],
  controllers: [],
})
export class SetupSubAppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(InternalErrorContextMiddleware, LoggerMiddleware).forRoutes("*");
  }
}
