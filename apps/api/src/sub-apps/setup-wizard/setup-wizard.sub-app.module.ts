/**
 * SetupWizardSubAppModule — the wizard's HTTP surface, started as a SUB-APP.
 *
 * LAYER NOTE: this module is a sub-app ROOT (it imports the setup FEATURE
 * module `SetupModule` and applies middleware), so it lives under `sub-apps/`
 * next to `setup-wizard/` and `mesh-initializer/`. It previously sat in
 * `core/setup-sub-app/`, which made `core/` import the feature layer — the SC7
 * reverse-import violation.
 */
import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { RenderModule } from "@nestjs-ssr/react";
import { SetupModule } from "@/modules/setup/setup.module";
import { EnvModule } from "@/config/env/env.module";
import { InternalErrorContextMiddleware } from "@/core/middlewares/internal-error/internal-error-context.middleware";
import { LoggerMiddleware } from "@/core/middlewares/logger.middleware";
import { SetupPageController } from "./setup-page.controller";

@Module({
  imports: [
    EnvModule,
    SetupModule,
    // The onboarding UI is served BY THE API (React SSR), so this sub-app needs
    // its own RenderModule — it is a separate Nest application from AppModule
    // and doesn't inherit that one's.
    RenderModule.forRoot({
      project: "api",
      viewsDir: "src/views",
      environment:
        process.env.NODE_ENV === "production" || process.env.NODE_ENV === "test"
          ? "production"
          : "development",
      vite: { port: 5173 },
    }),
  ],
  controllers: [SetupPageController],
})
export class SetupSubAppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(InternalErrorContextMiddleware, LoggerMiddleware).forRoutes("*");
  }
}
