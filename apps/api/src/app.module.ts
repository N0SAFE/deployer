import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { DatabaseModule } from './core/modules/db/database.module';
import { CoreModule } from './core/core.module';
import { HealthModule } from './modules/health/health.module';
import { UserModule } from './modules/user/user.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { WebSocketModule } from './modules/websocket/websocket.module';
import { TraefikModule } from './modules/traefik/traefik.module';
import { ProjectModule } from './modules/project/project.module';
import { ServiceModule } from './modules/service/service.module';
import { onError, ORPCModule } from '@orpc/nest';
import { DATABASE_CONNECTION } from './core/modules/db/database-connection';
import { AuthModule } from './modules/auth/auth.module';
import { betterAuthFactory } from './auth';
import { LoggerMiddleware } from './core/middlewares/logger.middleware';

@Module({
  imports: [
    // Redis/Bull Queue configuration
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
      },
    }),
    DatabaseModule,
    CoreModule,
    HealthModule,
    UserModule,
    JobsModule,
    WebSocketModule,
    TraefikModule,
    ProjectModule,
    ServiceModule,
    AuthModule.forRootAsync({
      imports: [DatabaseModule],
      useFactory: betterAuthFactory,
      inject: [DATABASE_CONNECTION],
    }),
    ORPCModule.forRoot({
      interceptors: [
        onError((error, ctx) => {
          console.error('oRPC Error:', JSON.stringify(error), JSON.stringify(ctx));
        }),
      ],
      eventIteratorKeepAliveInterval: 5000, // 5 seconds
    }),
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LoggerMiddleware)
      .forRoutes('*'); // Apply the logger middleware to all routes
  }
}