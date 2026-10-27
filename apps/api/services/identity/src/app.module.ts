import { AppLifecycleModule } from '@deployer/nest-lifecycle'
import {
    createModuleContext,
    EffectRuntime,
    EffectRuntimeModule,
} from '@deployer/nest-effect'
import {
    DEPENDENCIES,
    HealthModule,
    PreflightModule,
    ServiceHealthModule,
    createOrpcModule,
} from '@deployer/shared/server'
import { registerSchemaCodecs } from '@deployer/shared/config/drizzle/schema-codecs'
import { EnvModule, EnvService } from '@deployer/shared/config/env/env.module'
import { GLOBAL_DATABASE_CONNECTION } from '@deployer/nest-database-core/database-connection'
import { DatabaseModule } from '@deployer/shared/core/modules/database/database.module'
import { AuthModule } from '@deployer/shared/core/modules/auth/auth.module'
import { createBetterAuth } from '@deployer/shared/config/auth/auth'
import { GlobalDatabaseService } from '@deployer/shared/core/modules/database/services/global-database.service'
import { DatabasePort } from '@identity/core/database/database.port'

import { UserDomainModule } from './modules/user/user.module'
import { PushDomainModule } from './modules/push/push.module'
import { AnalyticsDomainModule } from './modules/analytics/analytics.module'
import { PermissionDomainModule } from './modules/permission/permission.module'

// Module-load, not a lifecycle hook: the column codecs run at QUERY time and the
// first query can happen during bootstrap — before any `onModuleInit`.
registerSchemaCodecs()

/**
 * The identity service.
 *
 * Owns: user, permission, push, analytics.
 *
 * ── WHAT A SERVICE ROOT MODULE CONTAINS ─────────────────────────────────────
 * Imports, plus the one provider every domain shares: `DatabasePort`, aliased
 * to the global database service. A domain module owns its own controllers and
 * providers; declaring them twice would be a second place to look.
 *
 * ── THE SHARED IMPORTS, AND WHY EACH IS HERE ────────────────────────────────
 *   EnvModule, DatabaseModule   configuration + the pool
 *   PreflightModule             proves dependencies BEFORE serving (binds readiness)
 *   ServiceHealthModule         `/health` (liveness) and `/health/ready`
 *   HealthModule                the REAL indicators + their live stream
 *   createOrpcModule()          the transport policy, identical in every app
 */
export class IdentityServiceModule extends createModuleContext({
    imports: [
        EnvModule,
        AppLifecycleModule.forRoot(),
        DatabaseModule,
        // ── WHY EVERY SERVICE IMPORTS THE AUTH MODULE ────────────────────────────
        // `createOrpcModule()` injects `AuthCoreService` to build the auth plugin that
        // populates `context.auth`, so the service it injects has to be in this app's
        // graph. Without it the boot fails with `Nest can't resolve dependencies of
        // the Symbol(ORPC_NEST_MODULE_CONFIG) … AuthCoreService at index [1]`, which
        // names neither this module nor the missing import.
        //
        // A service is NOT the session authority — the BFF is — but it must still be
        // able to RESOLVE a session from the request the BFF forwards, which is what
        // binding the same plugin everywhere buys. This is the identical wiring the
        // BFF uses, deliberately: the two sides must agree on what a session is.
        AuthModule.forRootAsync({
            imports: [EnvModule],
            useFactory: createBetterAuth,
            inject: [GLOBAL_DATABASE_CONNECTION, EnvService],
        }),
        PreflightModule.forRoot({ dependencies: DEPENDENCIES.platform }),
        ServiceHealthModule,
        HealthModule.forRoot({ indicators: 'platform' }),
        // `.effect()` handlers resolve services from `effect/context`; the runtime
        // contributes that context per request without changing the shared policy.
        createOrpcModule({
            extraContext: {
                inject: [EffectRuntime],
                resolve: async (runtime) => ({
                    'effect/context': await runtime.context(),
                }),
            },
        }),

        EffectRuntimeModule,

        UserDomainModule,
        PushDomainModule,
        AnalyticsDomainModule,
        PermissionDomainModule,
    ],
    providers: [{ provide: DatabasePort, useExisting: GlobalDatabaseService }],
}) {}
