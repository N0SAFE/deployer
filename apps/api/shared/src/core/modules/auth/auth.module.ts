import { AccessPolicy, createGlobalModule } from '@deployer/nest-effect'

import { accessPolicy } from '../../authz/access-policy'
import { createBetterAuth } from '../../../config/auth/auth'
import { EnvModule, EnvService } from '../../../config/env/env.module'
import { GLOBAL_DATABASE_CONNECTION } from '../database/database-connection'

import {
    MODULE_OPTIONS_TOKEN,
    type AuthModuleOptions,
} from './definitions/auth-module-definition'
import { makeSessionResolver, SessionResolver } from './orpc/session-resolver'
import {
    AuthCoreService,
    makeAuthCoreService,
    type AuthCoreServiceShape,
} from './services/auth-core.service'

import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

/**
 * Provides the Better Auth instance and the oRPC session services, to every module.
 *
 * There is NO authorization here: no guard, no decorator, no request hook — and no HTTP either. Better Auth's own routes
 * (sign-in/out, passkey, 2FA, API keys) are mounted by the HTTP edge (`betterAuthEdge`, `server/http-edge.ts`), which reads
 * the options this module provides. Every authorization decision on OUR endpoints is a declaration on the oRPC
 * procedure (`requireAuth()`, `access({ permission, scope })`), so a Nest guard would be a second gate that can disagree
 * with the first.
 *
 * It takes no options: the instance is always built from the global Postgres connection and the environment, the same way
 * in every app, so there is nothing for an app to configure and nothing to register with `forRoot`.
 */
export class AuthModule extends createGlobalModule(
    {
        imports: [EnvModule],
        providers: [
            {
                provide: MODULE_OPTIONS_TOKEN,
                useFactory: (
                    database: NodePgDatabase<Record<string, unknown>>,
                    env: EnvService
                ): AuthModuleOptions => ({
                    auth: createBetterAuth(database, env).auth,
                }),
                inject: [GLOBAL_DATABASE_CONNECTION, EnvService],
            },
            {
                provide: AuthCoreService,
                useFactory: (options: AuthModuleOptions) =>
                    makeAuthCoreService(options),
                inject: [MODULE_OPTIONS_TOKEN],
            },
            // Better Auth answers `getSession`; the oRPC auth plugin asks through this Effect service.
            {
                provide: SessionResolver,
                useFactory: (core: AuthCoreServiceShape) =>
                    makeSessionResolver(core.instance),
                inject: [AuthCoreService],
            },
            // How access is decided in this process: every access check depends on it, so an app cannot run unprotected by omission.
            { provide: AccessPolicy, useFactory: accessPolicy },
        ],
        exports: [
            MODULE_OPTIONS_TOKEN,
            AuthCoreService,
            SessionResolver,
            AccessPolicy,
        ],
    },
    AuthCoreService,
    SessionResolver
) {}
