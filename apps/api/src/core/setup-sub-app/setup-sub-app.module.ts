import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { SetupModule } from "../../modules/setup/setup.module";
import { EnvModule } from "../../config/env/env.module";
import { InternalErrorContextMiddleware } from "../middlewares/internal-error/internal-error-context.middleware";
import { LoggerMiddleware } from "../middlewares/logger.middleware";

@Module({
  imports: [EnvModule, SetupModule],
})
export class SetupSubAppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(InternalErrorContextMiddleware, LoggerMiddleware).forRoutes("*");
  }
}
