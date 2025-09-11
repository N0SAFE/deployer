import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './core/modules/db/database.module';
import { CoreModule } from './core/core.module';
import { HealthModule } from './modules/health/health.module';
import { HealthMonitorModule } from './modules/health-monitor/health-monitor.module';
import { UserModule } from './modules/user/user.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { WebSocketModule } from './modules/websocket/websocket.module';
import { TraefikModule } from './modules/traefik/traefik.module';
import { ProjectModule } from './modules/project/project.module';
import { ServiceModule } from './modules/service/service.module';
import { EnvironmentModule } from './modules/environment/environment.module';
import { DeploymentModule } from './modules/deployment/deployment.module';
import { OrchestrationControllerModule } from './modules/orchestration/orchestration.module';
import { StorageModule } from './modules/storage/storage.module';
import { StaticFileModule } from './modules/static-file/static-file.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { CiCdModule } from './modules/ci-cd/ci-cd.module';
import { onError, ORPCModule } from '@orpc/nest';
import { DATABASE_CONNECTION } from './core/modules/db/database-connection';
import { AuthModule } from './modules/auth/auth.module';
import { betterAuthFactory } from './auth';
import { LoggerMiddleware } from './core/middlewares/logger.middleware';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './modules/auth/guards/auth.guard';
@Module({
    imports: [
        // Enable scheduled tasks
        ScheduleModule.forRoot(),
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
        HealthMonitorModule,
        UserModule,
        JobsModule,
        WebSocketModule,
        TraefikModule,
        ProjectModule,
        ServiceModule,
        EnvironmentModule,
        DeploymentModule,
        OrchestrationControllerModule,
        StorageModule,
        StaticFileModule,
        AnalyticsModule,
        CiCdModule,
        AuthModule.forRootAsync({
            imports: [DatabaseModule],
            useFactory: betterAuthFactory,
            inject: [DATABASE_CONNECTION],
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
                                if (typeof value === 'object' && value !== null) {
                                    if (circularSeen.has(value)) {
                                        return '[Circular]';
                                    }
                                    circularSeen.add(value);
                                }
                                return value;
                            });
                        }
                    };
                    console.error('oRPC Error:', safeStringify(error), safeStringify(ctx));
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
        consumer
            .apply(LoggerMiddleware)
            .forRoutes('*'); // Apply the logger middleware to all routes
    }
}
