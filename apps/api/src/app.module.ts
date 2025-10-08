import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from "@nestjs/common";
import { BullModule } from "@nestjs/bull";
import { ScheduleModule } from "@nestjs/schedule";
import { onError, ORPCModule } from "@orpc/nest";
import { DATABASE_CONNECTION } from "@/core/modules/database/tokens/database-connection";
import { AuthModule } from "@/core/modules/auth/auth.module";
import { LoggerMiddleware } from "@/core/common/middlewares/logger.middleware";
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard } from "@/core/modules/auth/guards/auth.guard";
import { betterAuthFactory } from "@/config/auth/auth";
import { EnvService } from "@/config/env/env.service";
import { FeaturesModule } from "@/modules/features.module";
import { BootstrapModule } from "@/modules/bootstrap/bootstrap.module";

@Module({
  imports: [
    BootstrapModule, // Bootstrap services that run on application startup
    FeaturesModule,
    // Enable scheduled tasks
    ScheduleModule.forRoot(),
    // Redis/Bull Queue configuration
    BullModule.forRoot({
      redis: {
        host: "api-cache-dev",
        port: 6379,
        enableReadyCheck: false,
        lazyConnect: false,
      },
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 25,
      },
    }),
    AuthModule.forRootAsync({
      useFactory: betterAuthFactory,
      inject: [DATABASE_CONNECTION, EnvService],
    }),
    ORPCModule.forRoot({
      interceptors: [
        onError((error, ctx) => {
          // Handle potential circular references in error objects
          const safeStringify = (obj: any) => {
            try {
              return JSON.stringify(obj);
            } catch {
              // Handle circular reference by using a replacer function
              const circularSeen = new WeakSet();
              return JSON.stringify(obj, (key, value) => {
                if (typeof value === "object" && value !== null) {
                  if (circularSeen.has(value)) {
                    return "[Circular]";
                  }
                  circularSeen.add(value);
                }
                return value;
              });
            }
          };
          console.error(
            "oRPC Error:",
            safeStringify(error),
            safeStringify(ctx)
          );
        }),
      ],
      eventIteratorKeepAliveInterval: 5000, // 5 seconds
    }),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes("*"); // Apply the logger middleware to all routes
  }
}
